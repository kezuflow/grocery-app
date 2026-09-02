import type { AdminSelectedScope } from "@freshmarkets/contracts";

export type AdminProductScopeTarget =
  | Readonly<{ kind: "GLOBAL" }>
  | Readonly<{ kind: "LOCATION"; marketId: string; locationId: string }>;

export const ADMIN_PRODUCT_SCOPE_TARGET_COOKIE = "freshmarkets.admin.product-scope";

const MAX_SCOPE_ID_LENGTH = 200;

export function resolveAdminProductScopeTarget(
  selectedScope: AdminSelectedScope | null,
): AdminProductScopeTarget | null {
  if (selectedScope?.kind === "GLOBAL") return { kind: "GLOBAL" };
  if (selectedScope?.kind === "LOCATION") {
    return {
      kind: "LOCATION",
      marketId: selectedScope.marketId,
      locationId: selectedScope.locationId,
    };
  }
  return null;
}

export function serializeAdminProductScopeTarget(target: AdminProductScopeTarget): string {
  return encodeURIComponent(JSON.stringify(target));
}

export function parseAdminProductScopeTargetCookie(
  cookieHeader: string | null,
): AdminProductScopeTarget | null {
  const encoded = cookieHeader
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${ADMIN_PRODUCT_SCOPE_TARGET_COOKIE}=`))
    ?.slice(ADMIN_PRODUCT_SCOPE_TARGET_COOKIE.length + 1);
  if (!encoded) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(encoded)) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const value = parsed as Record<string, unknown>;
    if (value.kind === "GLOBAL") return { kind: "GLOBAL" };
    if (
      value.kind !== "LOCATION" ||
      typeof value.marketId !== "string" ||
      value.marketId.length === 0 ||
      value.marketId.length > MAX_SCOPE_ID_LENGTH ||
      typeof value.locationId !== "string" ||
      value.locationId.length === 0 ||
      value.locationId.length > MAX_SCOPE_ID_LENGTH
    ) {
      return null;
    }
    return { kind: "LOCATION", marketId: value.marketId, locationId: value.locationId };
  } catch {
    return null;
  }
}
