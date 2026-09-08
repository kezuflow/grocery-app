import { drizzle } from "drizzle-orm/d1";
import { z } from "@freshmarkets/validation";
import {
  adminCapabilityCodes,
  type AuthenticatedRequest,
  type CompleteInitialAdministratorSetupRequest,
  type InitialAdministratorSetupView,
  type RpcResult,
} from "@freshmarkets/contracts";
import type { AuthInstance } from "../../auth/service";
import { applicationContextForRequest } from "../../auth/authorization";
import { findIdempotencyRecord, requestHash } from "../../idempotency";
import { iamSchema } from "../schema";
import {
  completeInitialAdministratorRecord,
  initialAdministratorSetupAvailable,
  readInitialAdministratorSetup,
} from "../infrastructure/initial-administrator-repository";

type Dependencies = { auth: AuthInstance; db: D1Database; configuredEmail?: string };
const initialCapabilities = adminCapabilityCodes.filter((code) => !code.startsWith("memberships."));

async function setupIdentity(deps: Dependencies, request: AuthenticatedRequest) {
  const context = await applicationContextForRequest(
    deps.auth,
    drizzle(deps.db, { schema: iamSchema }),
    request,
  );
  if (!context.ok) return context;
  if (!context.value.authenticated || !context.value.principal)
    return {
      ok: false as const,
      error: {
        code: "UNAUTHENTICATED" as const,
        message: "Sign in to review administrator setup",
        requestId: request.requestId,
      },
    };
  const configured = z.string().trim().email().safeParse(deps.configuredEmail);
  const principal = context.value.principal;
  return {
    ok: true as const,
    value: {
      principal,
      configuredEmail: configured.success ? configured.data.toLowerCase() : null,
    },
    requestId: request.requestId,
  };
}

export async function getInitialAdministratorSetup(
  deps: Dependencies,
  request: AuthenticatedRequest,
): Promise<RpcResult<InitialAdministratorSetupView>> {
  const identity = await setupIdentity(deps, request);
  if (!identity.ok) return identity;
  const { principal, configuredEmail } = identity.value;
  const completed = await readInitialAdministratorSetup(deps.db, principal.userId);
  let value: InitialAdministratorSetupView = { state: "UNAVAILABLE" };
  if (completed) value = { state: "COMPLETED", staffId: completed.staffId };
  else if (
    configuredEmail &&
    configuredEmail === principal.email.trim().toLowerCase() &&
    (await initialAdministratorSetupAvailable(deps.db, principal.userId))
  ) {
    value = principal.emailVerified
      ? { state: "READY", expectedVersion: 0 }
      : { state: "VERIFY_EMAIL" };
  }
  return { ok: true, value, requestId: request.requestId };
}

export async function completeInitialAdministratorSetup(
  deps: Dependencies,
  request: CompleteInitialAdministratorSetupRequest,
): Promise<RpcResult<{ staffId: string }>> {
  const identity = await setupIdentity(deps, request);
  if (!identity.ok) return identity;
  const { principal, configuredEmail } = identity.value;
  const denied = (): RpcResult<never> => ({
    ok: false,
    error: {
      code: "FORBIDDEN",
      message: "Administrator setup is unavailable for this account",
      requestId: request.requestId,
    },
  });
  if (!principal.emailVerified) return denied();
  const hash = await requestHash({
    userId: principal.userId,
    expectedVersion: request.expectedVersion,
  });
  async function replay(): Promise<RpcResult<{ staffId: string }> | null> {
    const saved = await findIdempotencyRecord(
      deps.db,
      "iam.initialAdministrator",
      request.idempotencyKey,
    );
    if (!saved) return null;
    if (saved.requestHash !== hash)
      return {
        ok: false,
        error: {
          code: "IDEMPOTENCY_CONFLICT",
          message: "This request key belongs to another setup request",
          requestId: request.requestId,
        },
      };
    const completed = await readInitialAdministratorSetup(deps.db, principal.userId);
    if (saved.status === "SUCCEEDED" && completed?.staffId === saved.resultReference)
      return { ok: true, value: { staffId: completed.staffId }, requestId: request.requestId };
    return null;
  }
  const prior = await replay();
  if (prior) return prior;
  if (
    request.expectedVersion !== 0 ||
    !configuredEmail ||
    configuredEmail !== principal.email.trim().toLowerCase()
  )
    return denied();
  const staffId = crypto.randomUUID();
  try {
    await completeInitialAdministratorRecord(deps.db, {
      userId: principal.userId,
      configuredEmail,
      staffId,
      roleId: crypto.randomUUID(),
      capabilities: initialCapabilities,
      idempotencyKey: request.idempotencyKey,
      requestHash: hash,
      requestId: request.requestId,
      now: Date.now(),
    });
  } catch {
    const completed = await replay();
    if (completed) return completed;
    return {
      ok: false,
      error: {
        code: "CONFLICT",
        message:
          "Administrator setup changed or could not be completed. Refresh and retry the same request.",
        requestId: request.requestId,
      },
    };
  }
  return { ok: true, value: { staffId }, requestId: request.requestId };
}
