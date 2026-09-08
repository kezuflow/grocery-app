import type {
  AppErrorCode,
  AuthenticatedRequest,
  CustomerProfileView,
  RpcResult,
} from "@freshmarkets/contracts";
import { z } from "@freshmarkets/validation";
import { auditEventStatement } from "../audit/application/append-audit-event";
import { findIdempotencyRecord, requestHash } from "../idempotency";
import type { SessionUser } from "./principal";

export const customerProfileSchema = z.object({
  customerId: z.string().min(1),
  preferredLanguage: z.string().trim().min(1).max(80).nullable(),
  promotionalEmails: z.boolean(),
  version: z.number().int().positive(),
});
export const customerProfileUpdateSchema = z
  .object({
    preferredLanguage: z.string().trim().min(1).max(80).nullable(),
    promotionalEmails: z.boolean(),
    expectedVersion: z.number().int().positive(),
    idempotencyKey: z.string().trim().min(1).max(200),
  })
  .strict();
type ProfilePorts = {
  database: D1Database;
  session: (request: AuthenticatedRequest) => Promise<SessionUser | null>;
  now: () => number;
};
const scope = "customer.profile.update";
const required = (db: D1Database) =>
  db.prepare("INSERT INTO commitment_abort(id) SELECT -36 WHERE changes()!=1");

export async function readCustomerProfile(
  db: D1Database,
  customerId: string,
): Promise<CustomerProfileView | null> {
  const row = await db
    .prepare("SELECT id,preferred_language,promotional_emails,version FROM customer WHERE id=?")
    .bind(customerId)
    .first<{
      id: string;
      preferred_language: string | null;
      promotional_emails: number;
      version: number;
    }>();
  return row
    ? {
        customerId: row.id,
        preferredLanguage: row.preferred_language,
        promotionalEmails: row.promotional_emails === 1,
        version: row.version,
      }
    : null;
}

/** A rejected mutation cannot provision a Customer as a side effect. */
export async function updateMyCustomerProfile(
  ports: ProfilePorts,
  request: AuthenticatedRequest,
  input: unknown,
): Promise<RpcResult<CustomerProfileView>> {
  const parsed = customerProfileUpdateSchema.safeParse(input);
  if (!parsed.success)
    return failure(
      "VALIDATION_FAILED",
      "Supply valid profile preferences and a current version",
      request.requestId,
    );
  const user = await ports.session(request);
  if (!user)
    return failure("UNAUTHENTICATED", "Sign in to update your preferences", request.requestId);
  const command = parsed.data;
  const db = ports.database;
  const key = `${user.id}:${command.idempotencyKey}`;
  const hash = await requestHash({
    preferredLanguage: command.preferredLanguage,
    promotionalEmails: command.promotionalEmails,
    expectedVersion: command.expectedVersion,
  });
  async function replay(): Promise<RpcResult<CustomerProfileView> | null> {
    const saved = await findIdempotencyRecord(db, scope, key);
    if (!saved) return null;
    if (saved.requestHash !== hash)
      return failure(
        "IDEMPOTENCY_CONFLICT",
        "This request key was used for different preferences",
        request.requestId,
      );
    if (saved.status !== "SUCCEEDED") return null;
    let value: unknown;
    try {
      value = JSON.parse(saved.resultReference ?? "null");
    } catch {
      value = null;
    }
    const receipt = customerProfileSchema.safeParse(value);
    return receipt.success
      ? { ok: true, value: receipt.data, requestId: request.requestId }
      : failure("INTERNAL_ERROR", "Saved preferences result is unavailable", request.requestId);
  }
  const previous = await replay();
  if (previous) return previous;
  const target = await db
    .prepare(
      "SELECT c.id,c.version FROM customer c JOIN customer_principal cp ON cp.id=c.principal_id AND cp.auth_user_id=c.auth_user_id WHERE c.auth_user_id=? AND c.status='active' AND cp.status='active'",
    )
    .bind(user.id)
    .first<{ id: string; version: number }>();
  if (!target)
    return failure(
      "FORBIDDEN",
      "Load an active customer profile before updating preferences",
      request.requestId,
    );
  if (target.version !== command.expectedVersion)
    return failure(
      "STALE_VERSION",
      "Your account changed; reload before saving",
      request.requestId,
    );
  const now = ports.now();
  const result: CustomerProfileView = {
    customerId: target.id,
    preferredLanguage: command.preferredLanguage,
    promotionalEmails: command.promotionalEmails,
    version: target.version + 1,
  };
  try {
    await db.batch([
      db
        .prepare(
          "INSERT INTO idempotency_records(scope,idempotency_key,request_hash,status,result_type,created_at,updated_at) VALUES (?,?,?,'PROCESSING','customer_profile_snapshot',?,?) ON CONFLICT(scope,idempotency_key) DO UPDATE SET status='PROCESSING',updated_at=excluded.updated_at WHERE idempotency_records.request_hash=excluded.request_hash AND idempotency_records.status IN ('PROCESSING','FAILED')",
        )
        .bind(scope, key, hash, now, now),
      required(db),
      db
        .prepare(
          "UPDATE customer SET preferred_language=?,promotional_emails=?,version=version+1,updated_at=? WHERE id=? AND auth_user_id=? AND version=? AND status='active' AND EXISTS(SELECT 1 FROM customer_principal cp WHERE cp.id=customer.principal_id AND cp.auth_user_id=customer.auth_user_id AND cp.status='active')",
        )
        .bind(
          command.preferredLanguage,
          command.promotionalEmails ? 1 : 0,
          now,
          target.id,
          user.id,
          command.expectedVersion,
        ),
      required(db),
      auditEventStatement(db, {
        actorUserId: user.id,
        action: "CUSTOMER.PREFERENCES_UPDATED",
        resourceType: "customer",
        resourceId: target.id,
        details: { version: result.version },
        correlationId: request.requestId,
        idempotencyKey: `${scope}:${key}`,
        occurredAt: now,
      }),
      required(db),
      db
        .prepare(
          "UPDATE idempotency_records SET status='SUCCEEDED',result_reference=?,updated_at=? WHERE scope=? AND idempotency_key=? AND request_hash=? AND status='PROCESSING'",
        )
        .bind(JSON.stringify(result), now, scope, key, hash),
      required(db),
    ]);
    return { ok: true, value: result, requestId: request.requestId };
  } catch {
    return (
      (await replay()) ??
      failure("CONFLICT", "Your account changed; reload and retry", request.requestId)
    );
  }
}
function failure(code: AppErrorCode, message: string, requestId: string) {
  return { ok: false as const, error: { code, message, requestId } };
}
