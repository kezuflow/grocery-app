import type { AdminProductDetail, AdminProductPage, RpcResult } from "@freshmarkets/contracts";
import type { QueryClient } from "@tanstack/react-query";
import { adminProductDetailSchema } from "@freshmarkets/validation";
import { catalogResultSchema } from "../../components/admin/catalog-command-state";
import { readJson } from "../http/read-deadline";
import type { AdminProductScopeTarget } from "../admin/product-scope-target";

export function serializeProductScope(scope: AdminProductScopeTarget): string {
  return scope.kind === "GLOBAL" ? "GLOBAL" : `LOCATION:${scope.marketId}:${scope.locationId}`;
}

export function adminProductReadIdentity(productId: string, scope: AdminProductScopeTarget) {
  return JSON.stringify([productId, serializeProductScope(scope)]);
}

export function isAdminProductRecordCurrent(
  loadedIdentity: string | null,
  productId: string,
  scope: AdminProductScopeTarget | null,
) {
  return scope !== null && loadedIdentity === adminProductReadIdentity(productId, scope);
}

export function isAdminProductTransientCurrent(
  recordCurrent: boolean,
  ownerIdentity: string | null,
  readIdentity: string,
) {
  return recordCurrent && ownerIdentity === readIdentity;
}

function scopeParams(scope: AdminProductScopeTarget): URLSearchParams {
  const params = new URLSearchParams({ scopeKind: scope.kind });
  if (scope.kind === "LOCATION") {
    params.set("marketId", scope.marketId);
    params.set("locationId", scope.locationId);
  }
  return params;
}

export function adminProductListResource(query: string, status: string, cursor: string | null) {
  return JSON.stringify(["products", "list", query.trim(), status, cursor]);
}

export function adminProductDetailResource(productId: string) {
  return JSON.stringify(["products", "detail", productId]);
}

export function isAdminProductWorkspaceVisible(
  open: boolean,
  workspaceScope: string | null,
  currentScope: string,
) {
  return open && workspaceScope === currentScope;
}

export function invalidateAdminProductQueries(
  queryClient: QueryClient,
  productIds: ReadonlyArray<string> = [],
) {
  const details = new Set(productIds.map(adminProductDetailResource));
  return queryClient.invalidateQueries({
    predicate: ({ queryKey }) => {
      const [privacy, , area, , resource] = queryKey;
      return (
        privacy === "private" &&
        area === "admin" &&
        typeof resource === "string" &&
        (resource.startsWith('["products","list",') || details.has(resource))
      );
    },
  });
}

export async function fetchAdminProducts({
  scope,
  query,
  status,
  cursor,
  signal,
}: {
  scope: AdminProductScopeTarget;
  query: string;
  status: string;
  cursor: string | null;
  signal?: AbortSignal;
}): Promise<RpcResult<AdminProductPage>> {
  const params = scopeParams(scope);
  params.set("limit", "50");
  if (query.trim()) params.set("query", query.trim());
  if (status !== "all") params.set("status", status);
  if (cursor) params.set("cursor", cursor);
  return readJson(`/api/admin/catalog/products?${params}`, { signal });
}

export async function fetchAdminProductDetail({
  scope,
  productId,
  signal,
}: {
  scope: AdminProductScopeTarget;
  productId: string;
  signal?: AbortSignal;
}): Promise<RpcResult<AdminProductDetail>> {
  const params = scopeParams(scope);
  const payload = await readJson<unknown>(
    `/api/admin/catalog/products/${encodeURIComponent(productId)}?${params}`,
    {
      signal,
    },
  );
  return catalogResultSchema(adminProductDetailSchema).parse(payload);
}
