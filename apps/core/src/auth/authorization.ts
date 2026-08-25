import { eq, inArray } from "drizzle-orm";
import type {
  ApplicationContext,
  AuthContextRequest,
  Capability,
  RpcResult,
  Scope,
} from "@freshmarkets/contracts";
import { authSchema } from "./schema";
import type { AuthInstance } from "./service";

type Database = ReturnType<typeof import("drizzle-orm/d1").drizzle>;

export async function applicationContext(
  auth: AuthInstance,
  database: Database,
  request: AuthContextRequest,
): Promise<RpcResult<ApplicationContext>> {
  const session = await auth.api.getSession({
    headers: new Headers(request.headers),
  });

  if (!session) {
    return {
      ok: true,
      value: { authenticated: false, principal: null, capabilities: [], scopes: [] },
      requestId: request.requestId,
    };
  }

  const staff = await database
    .select()
    .from(authSchema.staffIdentity)
    .where(eq(authSchema.staffIdentity.authUserId, session.user.id))
    .limit(1);
  const staffRecord = staff[0];
  const capabilities: Capability[] = [];
  const scopes: Scope[] = [];

  if (staffRecord?.status === "active") {
    const roles = await database
      .select({ roleId: authSchema.staffRole.roleId })
      .from(authSchema.staffRole)
      .where(eq(authSchema.staffRole.staffId, staffRecord.id));
    const roleIds = roles.map((item) => item.roleId);
    if (roleIds.length) {
      const permissions = await database
        .select({ code: authSchema.permission.code })
        .from(authSchema.rolePermission)
        .innerJoin(
          authSchema.permission,
          eq(authSchema.permission.id, authSchema.rolePermission.permissionId),
        )
        .where(inArray(authSchema.rolePermission.roleId, roleIds));
      for (const permission of permissions) {
        if (
          permission.code === "staff:read" ||
          permission.code === "staff:manage" ||
          permission.code === "rbac:read" ||
          permission.code === "rbac:manage" ||
          permission.code === "location:read" ||
          permission.code === "location:manage" ||
          permission.code === "order:manage" ||
          permission.code === "inventory:manage" ||
          permission.code === "procurement:manage" ||
          permission.code === "fulfillment:manage" ||
          permission.code === "delivery:manage"
        ) {
          capabilities.push(permission.code);
        }
      }
    }
    const staffScopes = await database
      .select()
      .from(authSchema.staffScope)
      .where(eq(authSchema.staffScope.staffId, staffRecord.id));
    for (const scope of staffScopes) {
      if (scope.scopeKind === "global") scopes.push({ kind: "global" });
      else if (scope.scopeKind === "market" && scope.marketId)
        scopes.push({ kind: "market", marketId: scope.marketId });
      else if (scope.scopeKind === "location" && scope.locationId)
        scopes.push({ kind: "location", locationId: scope.locationId });
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
    },
    requestId: request.requestId,
  };
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
