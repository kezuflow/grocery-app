"use client";

import type { AdminProductPage, AdminProductSummary, RpcResult } from "@freshmarkets/contracts";
import { Plus, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AdminCursorPagination, useAdminUrlPagination } from "@/components/admin/admin-controls";
import {
  ProductListView,
  type BulkProductDeactivationResult,
  type BulkProductSelection,
} from "@/components/admin/product-list-view";
import { useAdminContext } from "../../admin-context-provider";
import { PageHeader } from "@/components/admin/admin-shell";
import { AdminMasterDetailWorkspace } from "@/components/admin/admin-master-detail-workspace";
import { GlobalProductPreviewPanel } from "@/components/admin/product-preview-panel";
import { LocationProductPreviewPanel } from "@/components/admin/location-product-preview-panel";
import { ProductSearchInput } from "@/components/admin/product-search-input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { NewProductWorkspace } from "./new/page";
import {
  resolveAdminProductScopeTarget,
  type AdminProductScopeTarget,
} from "@/lib/admin/product-scope-target";
import { useQueryEpoch } from "@/components/query-provider";
import { queryKeys } from "@/lib/query/query-client";
import { notifyCommandSuccess } from "@/components/admin/admin-feedback";
import {
  adminProductDetailResource,
  adminProductListResource,
  fetchAdminProductDetail,
  fetchAdminProducts,
  invalidateAdminProductQueries,
  isAdminProductWorkspaceVisible,
  serializeProductScope,
} from "@/lib/query/admin-products";

type ProductsPageClientProps = {
  initialPayload: RpcResult<AdminProductPage> | null;
  initialScopeTarget: AdminProductScopeTarget | null;
  initialQuery: string;
  initialStatus: string;
};

type ProductListItem = AdminProductPage["items"][number];
function sameScopeTarget(
  left: AdminProductScopeTarget | null,
  right: AdminProductScopeTarget | null,
): boolean {
  if (left?.kind !== right?.kind) return false;
  if (left?.kind === "GLOBAL") return true;
  return (
    left?.kind === "LOCATION" &&
    right?.kind === "LOCATION" &&
    left.marketId === right.marketId &&
    left.locationId === right.locationId
  );
}

export function ProductsPageClient({
  initialPayload,
  initialScopeTarget,
  initialQuery,
  initialStatus,
}: ProductsPageClientProps) {
  const searchParams = useSearchParams();
  const query = searchParams.get("query") ?? "";
  const status = searchParams.get("status") ?? "all";
  const [bulkPending, setBulkPending] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<ProductListItem | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelMode, setPanelMode] = useState<"create" | "detail">("detail");
  const [priceRecoveryActive, setPriceRecoveryActive] = useState(false);
  const [workspaceScopeKey, setWorkspaceScopeKey] = useState<string | null>(null);
  const pagination = useAdminUrlPagination("/admin/catalog/products");
  const adminContext = useAdminContext();
  const epoch = useQueryEpoch();
  const queryClient = useQueryClient();
  const scopeTarget = useMemo(
    () =>
      adminContext.state.phase === "ready"
        ? resolveAdminProductScopeTarget(adminContext.state.selectedScope)
        : null,
    [adminContext.state],
  );
  const canManage =
    adminContext.state.phase === "ready" &&
    adminContext.state.selectedScope?.kind === "GLOBAL" &&
    adminContext.state.context.capabilities.includes("catalog.manage");
  const canManageLocationPrices =
    adminContext.state.phase === "ready" &&
    adminContext.state.selectedScope?.kind === "LOCATION" &&
    adminContext.state.context.capabilities.includes("prices.manage");
  const scopeKey = scopeTarget ? serializeProductScope(scopeTarget) : "unresolved";
  const serverPayloadMatches =
    initialPayload !== null &&
    !pagination.cursor &&
    query === initialQuery &&
    status === initialStatus &&
    sameScopeTarget(scopeTarget, initialScopeTarget) &&
    epoch === 0;
  const listQuery = useQuery({
    queryKey: queryKeys.admin(
      epoch,
      scopeKey,
      adminProductListResource(query, status, pagination.cursor),
    ),
    queryFn: ({ signal }) => {
      if (!scopeTarget) throw new Error("Select an Admin Product scope");
      return fetchAdminProducts({
        scope: scopeTarget,
        query,
        status,
        cursor: pagination.cursor,
        signal,
      });
    },
    enabled: scopeTarget !== null,
    initialData: serverPayloadMatches ? initialPayload : undefined,
  });
  const payload: RpcResult<AdminProductPage> | null =
    listQuery.data ??
    (listQuery.isError
      ? {
          ok: false,
          error: {
            code: "INTERNAL_ERROR",
            message: "Network error loading Products",
            requestId: "unavailable",
          },
        }
      : null);
  const previewQuery = useQuery({
    queryKey: queryKeys.admin(
      epoch,
      scopeKey,
      adminProductDetailResource(selectedProduct?.productId ?? "none"),
    ),
    queryFn: ({ signal }) => {
      if (!scopeTarget || !selectedProduct) throw new Error("Select a product and Admin scope");
      return fetchAdminProductDetail({
        scope: scopeTarget,
        productId: selectedProduct.productId,
        signal,
      });
    },
    enabled:
      panelOpen &&
      workspaceScopeKey === scopeKey &&
      panelMode === "detail" &&
      scopeTarget !== null &&
      selectedProduct !== null,
  });
  const panelVisible = isAdminProductWorkspaceVisible(panelOpen, workspaceScopeKey, scopeKey);

  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (value && value !== "all") next.set(key, value);
    else next.delete(key);
    pagination.reset(next);
    window.history.replaceState(null, "", `/admin/catalog/products${next.size ? `?${next}` : ""}`);
  }

  async function deactivateProducts(
    products: ReadonlyArray<BulkProductSelection>,
    reason: string,
  ): Promise<BulkProductDeactivationResult> {
    if (bulkPending) return { succeeded: [], failed: [] };
    setBulkPending(true);
    const outcome: {
      succeeded: Array<{ productId: string; name: string }>;
      failed: Array<{
        productId: string;
        name: string;
        message: string;
        requestId: string | null;
      }>;
    } = { succeeded: [], failed: [] };
    try {
      for (const product of products) {
        try {
          const response = await fetch(
            `/api/admin/catalog/products/${encodeURIComponent(product.productId)}/status`,
            {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "idempotency-key": product.idempotencyKey,
              },
              body: JSON.stringify({
                status: "inactive",
                reason,
                expectedVersion: product.version,
              }),
            },
          );
          const result = (await response.json()) as RpcResult<AdminProductSummary>;
          if (result.ok) {
            outcome.succeeded.push({ productId: product.productId, name: product.name });
          } else {
            outcome.failed.push({
              productId: product.productId,
              name: product.name,
              message: result.error.message,
              requestId: result.error.requestId,
            });
          }
        } catch {
          outcome.failed.push({
            productId: product.productId,
            name: product.name,
            message: "Network error while deactivating this product.",
            requestId: null,
          });
        }
      }
      await invalidateAdminProductQueries(
        queryClient,
        outcome.succeeded.map((product) => product.productId),
      );
      if (outcome.succeeded.length > 0 && outcome.failed.length === 0) {
        notifyCommandSuccess(
          outcome.succeeded.length === 1 ? "Product deactivated" : "Products deactivated",
          `${outcome.succeeded.length} ${outcome.succeeded.length === 1 ? "product" : "products"} updated.`,
        );
      }
      return outcome;
    } finally {
      setBulkPending(false);
    }
  }

  const master = (
    <section className="space-y-6 p-5 sm:p-7" aria-labelledby="admin-page-title">
      <PageHeader
        title="Products"
        action={
          canManage ? (
            <Button
              type="button"
              size="sm"
              className="fm-admin-reference-primary"
              aria-expanded={panelVisible && panelMode === "create"}
              aria-controls="product-detail-panel"
              onClick={() => {
                setPanelMode("create");
                setWorkspaceScopeKey(scopeKey);
                setPanelOpen((open) => (panelMode === "create" ? !open : true));
              }}
            >
              <Plus aria-hidden="true" />
              Add product
            </Button>
          ) : null
        }
      />
      {!payload ? <Skeleton className="h-64 w-full" /> : null}
      {listQuery.data && listQuery.isFetching ? (
        <p role="status" className="text-sm text-[var(--fm-text-muted)]">
          Refreshing products…
        </p>
      ) : null}
      {listQuery.data && listQuery.isError ? (
        <Alert variant="destructive">
          <AlertTitle>Products could not be refreshed</AlertTitle>
          <AlertDescription>
            The previous authorized results remain visible. Try refreshing this list again.
          </AlertDescription>
        </Alert>
      ) : null}
      {payload && !payload.ok ? (
        <Alert variant="destructive">
          <AlertTitle>Products could not be loaded</AlertTitle>
          <AlertDescription>
            {payload.error.message}
            <br />
            <span className="font-mono text-xs">Request reference: {payload.error.requestId}</span>
          </AlertDescription>
        </Alert>
      ) : null}
      {payload?.ok ? (
        <>
          <ProductListView
            key={scopeKey}
            page={payload.value}
            fromQuery={searchParams.toString()}
            canManage={canManage}
            deactivationPending={bulkPending}
            onDeactivateSelected={deactivateProducts}
            onOpenProduct={(product) => {
              if (priceRecoveryActive) return;
              setSelectedProduct(product);
              setPanelMode("detail");
              setWorkspaceScopeKey(scopeKey);
              setPanelOpen(true);
            }}
            openProductId={
              panelVisible && panelMode === "detail" ? selectedProduct?.productId : null
            }
            detailPanelId="product-detail-panel"
            activeFilterCount={Number(query.trim().length > 0) + Number(status !== "all")}
            filters={
              <>
                <ProductSearchInput query={query} onSearch={(value) => setFilter("query", value)} />
                <label className="grid gap-1.5 text-sm font-medium">
                  Status
                  <select
                    aria-label="Product status"
                    value={status}
                    onChange={(event) => setFilter("status", event.target.value)}
                    className="h-9 rounded-[var(--fm-radius-control)] border border-[var(--fm-border)] bg-[var(--fm-admin-surface)] px-3 font-normal"
                  >
                    <option value="all">All statuses</option>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </label>
              </>
            }
          />
          <AdminCursorPagination
            pageNumber={pagination.pageNumber}
            nextCursor={payload.value.nextCursor}
            onPrevious={pagination.previous}
            onNext={pagination.next}
          />
        </>
      ) : null}
    </section>
  );

  const previewResult = previewQuery.data;
  const productDetail = selectedProduct ? (
    previewResult?.ok ? (
      previewResult.value.scope.kind === "LOCATION" ? (
        <LocationProductPreviewPanel
          product={previewResult.value}
          fromQuery={searchParams.toString()}
          canManagePrices={canManageLocationPrices}
          onClose={() => {
            if (!priceRecoveryActive) setPanelOpen(false);
          }}
          onPriceSaved={() => {
            void invalidateAdminProductQueries(queryClient, [previewResult.value.productId]);
          }}
          onRecoveryStateChange={setPriceRecoveryActive}
        />
      ) : (
        <GlobalProductPreviewPanel
          product={previewResult.value}
          fromQuery={searchParams.toString()}
          onClose={() => setPanelOpen(false)}
          onSaved={async () => {
            await invalidateAdminProductQueries(queryClient, [previewResult.value.productId]);
            await previewQuery.refetch();
          }}
        />
      )
    ) : (
      <>
        <div className="flex items-start justify-between gap-4 border-b border-[var(--fm-border)] px-5 py-5">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--fm-text-muted)]">
              Product preview
            </p>
            <h2
              id="product-panel-title"
              className="mt-1 truncate text-xl font-bold tracking-[-0.03em]"
            >
              {selectedProduct.name}
            </h2>
            <p className="mt-1 truncate text-sm text-[var(--fm-text-muted)]">
              {selectedProduct.slug}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Close product details"
            onClick={() => setPanelOpen(false)}
          >
            <X aria-hidden="true" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 px-5 py-5">
          {previewQuery.isError || (previewResult && !previewResult.ok) ? (
            <Alert variant="destructive">
              <AlertTitle>Product preview could not be loaded</AlertTitle>
              <AlertDescription>
                {previewResult && !previewResult.ok
                  ? previewResult.error.message
                  : "Product preview could not be loaded."}
                {previewResult && !previewResult.ok
                  ? ` Request reference: ${previewResult.error.requestId}`
                  : ""}
              </AlertDescription>
            </Alert>
          ) : (
            <div role="status" aria-label="Loading product preview" className="space-y-3">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-11 w-full" />
              <Skeleton className="h-56 w-full" />
            </div>
          )}
        </div>
        {previewQuery.isError || (previewResult && !previewResult.ok) ? (
          <div className="flex shrink-0 justify-end gap-2 border-t border-[var(--fm-border)] px-5 py-4">
            <Button type="button" variant="outline" onClick={() => setPanelOpen(false)}>
              Close
            </Button>
            <Button type="button" onClick={() => void previewQuery.refetch()}>
              Retry
            </Button>
          </div>
        ) : null}
      </>
    )
  ) : null;

  const createDetail = (
    <NewProductWorkspace
      key={scopeKey}
      embedded
      onCancel={() => setPanelOpen(false)}
      onCreated={() => {
        setPanelOpen(false);
        void invalidateAdminProductQueries(queryClient);
      }}
    />
  );

  return (
    <AdminMasterDetailWorkspace
      open={panelVisible && (panelMode === "create" || selectedProduct !== null)}
      master={master}
      detail={panelVisible ? (panelMode === "create" ? createDetail : productDetail) : null}
      panelId="product-detail-panel"
      labelledBy={panelMode === "create" ? "create-product-panel-title" : "product-panel-title"}
      resizeLabel="Resize product details"
    />
  );
}
