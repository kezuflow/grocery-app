import { eq, inArray } from "drizzle-orm";
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

export async function applicationContext(
  auth: AuthInstance,
  database: Database,
  request: AuthContextRequest,
): Promise<RpcResult<ApplicationContext>> {
  const traceContext = { requestId: request.requestId };
  const session = await traceOperation("auth.session", traceContext, () =>
    auth.api.getSession({
      headers: new Headers(request.headers),
    }),
  );

  if (!session) {
    return {
      ok: true,
      value: { authenticated: false, principal: null, capabilities: [], scopes: [] },
      requestId: request.requestId,
    };
  }

  return traceOperation("iam.resolve", traceContext, async () => {
    const staff = await traceOperation("iam.staff", traceContext, () =>
      database
        .select()
        .from(iamSchema.staffIdentity)
        .where(eq(iamSchema.staffIdentity.authUserId, session.user.id))
        .limit(1),
    );
    const staffRecord = staff[0];
    const capabilities: Capability[] = [];
    const scopes: Scope[] = [];

    if (staffRecord?.status === "active") {
      const roles = await traceOperation("iam.roles", traceContext, () =>
        database
          .select({ roleId: iamSchema.staffRole.roleId })
          .from(iamSchema.staffRole)
          .where(eq(iamSchema.staffRole.staffId, staffRecord.id)),
      );
      const roleIds = roles.map((item) => item.roleId);
      if (roleIds.length) {
        const permissions = await traceOperation("iam.permissions", traceContext, () =>
          database
            .select({ code: iamSchema.permission.code })
            .from(iamSchema.rolePermission)
            .innerJoin(
              iamSchema.permission,
              eq(iamSchema.permission.id, iamSchema.rolePermission.permissionId),
            )
            .where(inArray(iamSchema.rolePermission.roleId, roleIds)),
        );
        for (const permission of permissions) {
          // Canonical dot-form capabilities only; historical colon-form rows are
          // unrecognized compatibility data.
          if (isAdminCapability(permission.code)) {
            capabilities.push(permission.code);
          }
        }
      }
      const staffScopes = await traceOperation("iam.scopes", traceContext, () =>
        database
          .select()
          .from(iamSchema.staffScope)
          .where(eq(iamSchema.staffScope.staffId, staffRecord.id)),
      );
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
  });
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
