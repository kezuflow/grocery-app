import type { AdminScopeOptionView, AdminSelectedScope } from "@freshmarkets/contracts";

export type AdminProductPricingTarget = Readonly<{
  marketId: string;
  locationId: string | null;
}>;

export const ADMIN_PRODUCT_PRICING_TARGET_COOKIE = "freshmarkets.admin.product-pricing-target";

const MAX_SCOPE_ID_LENGTH = 200;

export function resolveAdminProductPricingTarget(
  selectedScope: AdminSelectedScope | null,
  scopes: ReadonlyArray<AdminScopeOptionView>,
): AdminProductPricingTarget | null {
  if (selectedScope?.kind === "LOCATION") {
    return { marketId: selectedScope.marketId, locationId: selectedScope.locationId };
  }
  if (selectedScope?.kind === "MARKET") {
    return { marketId: selectedScope.marketId, locationId: null };
  }
  if (selectedScope?.kind === "GLOBAL") {
    const option = scopes[0];
    return option ? { marketId: option.marketId, locationId: null } : null;
  }
  const option =
    scopes.find((candidate) => candidate.kind === "location") ??
    scopes.find((candidate) => candidate.kind === "market");
  return option
    ? {
        marketId: option.marketId,
        locationId: option.kind === "location" ? option.locationId : null,
      }
    : null;
}

export function serializeAdminProductPricingTarget(target: AdminProductPricingTarget): string {
  return encodeURIComponent(JSON.stringify(target));
}

export function parseAdminProductPricingTargetCookie(
  cookieHeader: string | null,
): AdminProductPricingTarget | null {
  const encoded = cookieHeader
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${ADMIN_PRODUCT_PRICING_TARGET_COOKIE}=`))
    ?.slice(ADMIN_PRODUCT_PRICING_TARGET_COOKIE.length + 1);
  if (!encoded) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(encoded)) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const value = parsed as Record<string, unknown>;
    if (
      typeof value.marketId !== "string" ||
      value.marketId.length === 0 ||
      value.marketId.length > MAX_SCOPE_ID_LENGTH ||
      !(
        value.locationId === null ||
        (typeof value.locationId === "string" &&
          value.locationId.length > 0 &&
          value.locationId.length <= MAX_SCOPE_ID_LENGTH)
      )
    ) {
      return null;
    }
    return { marketId: value.marketId, locationId: value.locationId as string | null };
  } catch {
    return null;
  }
}
