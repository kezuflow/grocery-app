import { eq } from "drizzle-orm";
import type {
  ApplicationContext,
  AuthContextRequest,
  Capability,
  RpcResult,
  Scope,
} from "@freshmarkets/contracts";
import { isAdminCapability } from "@freshmarkets/contracts";
import { iamSchema } from "../iam/schema";
import { traceOperation } from "../observability";
import type { AuthInstance } from "./service";

type Database = ReturnType<typeof import("drizzle-orm/d1").drizzle>;

export type ResolvedStaffIdentity = Readonly<{
  id: string;
  authUserId: string;
  displayName: string;
  status: string;
}>;

/** Internal immutable access result; the Staff record never crosses the public auth contract. */
export type ResolvedApplicationContext = Readonly<
  ApplicationContext & {
    staffIdentity: ResolvedStaffIdentity | null;
  }
>;

export async function applicationContext(
  auth: AuthInstance,
  database: Database,
  request: AuthContextRequest,
): Promise<RpcResult<ResolvedApplicationContext>> {
  const traceContext = { requestId: request.requestId };
  const session = await traceOperation("auth.session", traceContext, () =>
    auth.api.getSession({
      headers: new Headers(request.headers),
    }),
  );

  if (!session) {
    return {
      ok: true,
      value: {
        authenticated: false,
        principal: null,
        capabilities: [],
        scopes: [],
        staffIdentity: null,
      },
      requestId: request.requestId,
    };
  }

  return traceOperation("iam.resolve", traceContext, async () => {
    const accessRows = await traceOperation("iam.access", traceContext, () =>
      database
        .select({
          staffId: iamSchema.staffIdentity.id,
          staffAuthUserId: iamSchema.staffIdentity.authUserId,
          staffDisplayName: iamSchema.staffIdentity.displayName,
          staffStatus: iamSchema.staffIdentity.status,
          permissionCode: iamSchema.permission.code,
          scopeKind: iamSchema.staffScope.scopeKind,
          scopeMarketId: iamSchema.staffScope.marketId,
          scopeLocationId: iamSchema.staffScope.locationId,
        })
        .from(iamSchema.staffIdentity)
        .leftJoin(iamSchema.staffRole, eq(iamSchema.staffRole.staffId, iamSchema.staffIdentity.id))
        .leftJoin(
          iamSchema.rolePermission,
          eq(iamSchema.rolePermission.roleId, iamSchema.staffRole.roleId),
        )
        .leftJoin(
          iamSchema.permission,
          eq(iamSchema.permission.id, iamSchema.rolePermission.permissionId),
        )
        .leftJoin(
          iamSchema.staffScope,
          eq(iamSchema.staffScope.staffId, iamSchema.staffIdentity.id),
        )
        .where(eq(iamSchema.staffIdentity.authUserId, session.user.id)),
    );
    const firstAccessRow = accessRows[0];
    const staffRecord = firstAccessRow
      ? {
          id: firstAccessRow.staffId,
          authUserId: firstAccessRow.staffAuthUserId,
          displayName: firstAccessRow.staffDisplayName,
          status: firstAccessRow.staffStatus,
        }
      : null;
    const capabilities: Capability[] = [];
    const scopes: Scope[] = [];

    if (staffRecord?.status === "active") {
      for (const row of accessRows) {
        // Canonical dot-form capabilities only; historical colon-form rows are
        // unrecognized compatibility data.
        if (row.permissionCode && isAdminCapability(row.permissionCode)) {
          capabilities.push(row.permissionCode);
        }
        if (row.scopeKind === "global") scopes.push({ kind: "global" });
        else if (row.scopeKind === "market" && row.scopeMarketId)
          scopes.push({ kind: "market", marketId: row.scopeMarketId });
        else if (row.scopeKind === "location" && row.scopeLocationId)
          scopes.push({ kind: "location", locationId: row.scopeLocationId });
      }
    }

    return {
      ok: true,
      value: {
        authenticated: true,
        principal: {
          userId: session.user.id,
          email: session.user.email,
          name: session.user.name,
          emailVerified: session.user.emailVerified,
        },
        capabilities: [...new Set(capabilities)],
        scopes: [...new Set(scopes.map((scope) => JSON.stringify(scope)))].map(
          (scope) => JSON.parse(scope) as Scope,
        ),
        staffIdentity: staffRecord
          ? {
              id: staffRecord.id,
              authUserId: staffRecord.authUserId,
              displayName: staffRecord.displayName,
              status: staffRecord.status,
            }
          : null,
      },
      requestId: request.requestId,
    };
  });
}

export async function applicationContextForRequest(
  auth: AuthInstance,
  database: Database,
  request: AuthContextRequest,
  resolved?: ResolvedApplicationContext,
): Promise<RpcResult<ResolvedApplicationContext>> {
  if (resolved) return { ok: true, value: resolved, requestId: request.requestId };
  return applicationContext(auth, database, request);
}

/** Public auth DTO projection that deliberately strips internal Staff resolution evidence. */
export async function publicApplicationContext(
  auth: AuthInstance,
  database: Database,
  request: AuthContextRequest,
): Promise<RpcResult<ApplicationContext>> {
  const result = await applicationContextForRequest(auth, database, request);
  if (!result.ok) return result;
  const { staffIdentity: _staffIdentity, ...value } = result.value;
  return { ok: true, value, requestId: result.requestId };
}

export function can(capabilities: ReadonlyArray<Capability>, required: Capability): boolean {
  return capabilities.includes(required);
}

export function hasScope(scopes: ReadonlyArray<Scope>, required: Scope): boolean {
  return scopes.some(
    (scope) =>
      scope.kind === "global" ||
      (scope.kind === required.kind &&
        scope.kind === "market" &&
        required.kind === "market" &&
        scope.marketId === required.marketId) ||
      (scope.kind === required.kind &&
        scope.kind === "location" &&
        required.kind === "location" &&
        scope.locationId === required.locationId),
  );
}

export function hasOperationalScope(
  scopes: ReadonlyArray<Scope>,
  locationId: string,
  marketId?: string,
): boolean {
  return scopes.some(
    (scope) =>
      scope.kind === "global" ||
      (scope.kind === "location" && scope.locationId === locationId) ||
      (scope.kind === "market" && Boolean(marketId) && scope.marketId === marketId),
  );
}
