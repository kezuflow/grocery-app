"use client";

import type {
  AdminProductDetail,
  AdminProductPage,
  AdminProductSummary,
  RpcResult,
} from "@freshmarkets/contracts";
import { adminProductDetailSchema } from "@freshmarkets/validation";
import { Plus, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AdminCursorPagination, useAdminPagination } from "@/components/admin/admin-controls";
import {
  ProductListView,
  type BulkProductDeactivationResult,
  type BulkProductSelection,
} from "@/components/admin/product-list-view";
import { useAdminContext } from "../../admin-context-provider";
import { PageHeader } from "@/components/admin/admin-shell";
import { AdminMasterDetailWorkspace } from "@/components/admin/admin-master-detail-workspace";
import { ProductPreviewPanel } from "@/components/admin/product-preview-panel";
import { catalogResultSchema } from "@/components/admin/catalog-command-state";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { NewProductWorkspace } from "./new/page";
import {
  resolveAdminProductScopeTarget,
  type AdminProductScopeTarget,
} from "@/lib/admin/product-scope-target";

type ProductsPageClientProps = {
  initialPayload: RpcResult<AdminProductPage> | null;
  initialScopeTarget: AdminProductScopeTarget | null;
  initialQuery: string;
  initialStatus: string;
};

type ProductListItem = AdminProductPage["items"][number];
type ProductPreviewState =
  | { phase: "idle" | "loading" }
  | { phase: "error"; message: string; requestId: string | null }
  | { phase: "ready"; product: AdminProductDetail };

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
  const router = useRouter();
  const searchParams = useSearchParams();
  const query = searchParams.get("query") ?? initialQuery;
  const status = searchParams.get("status") ?? initialStatus;
  const [payload, setPayload] = useState<RpcResult<AdminProductPage> | null>(initialPayload);
  const [bulkPending, setBulkPending] = useState(false);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [selectedProduct, setSelectedProduct] = useState<ProductListItem | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelMode, setPanelMode] = useState<"create" | "detail">("detail");
  const [previewState, setPreviewState] = useState<ProductPreviewState>({ phase: "idle" });
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const pagination = useAdminPagination();
  const adminContext = useAdminContext();
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
  useEffect(() => {
    if (!scopeTarget) return;
    const filterNavigationPending = query !== initialQuery || status !== initialStatus;
    if (filterNavigationPending && !pagination.cursor && reloadVersion === 0) return;
    const serverPayloadMatches =
      initialPayload !== null &&
      !pagination.cursor &&
      reloadVersion === 0 &&
      sameScopeTarget(scopeTarget, initialScopeTarget);
    if (serverPayloadMatches) return;

    setPayload(null);
    const params = new URLSearchParams({ limit: "50" });
    params.set("scopeKind", scopeTarget.kind);
    if (scopeTarget.kind === "LOCATION") {
      params.set("marketId", scopeTarget.marketId);
      params.set("locationId", scopeTarget.locationId);
    }
    if (query.trim()) params.set("query", query.trim());
    if (status !== "all") params.set("status", status);
    if (pagination.cursor) params.set("cursor", pagination.cursor);
    void fetch(`/api/admin/catalog/products?${params}`)
      .then((response) => response.json() as Promise<RpcResult<AdminProductPage>>)
      .then(setPayload)
      .catch(() =>
        setPayload({
          ok: false,
          error: {
            code: "INTERNAL_ERROR",
            message: "Network error loading Products",
            requestId: "unavailable",
          },
        }),
      );
  }, [
    initialPayload,
    initialScopeTarget,
    initialQuery,
    initialStatus,
    pagination.cursor,
    scopeTarget,
    query,
    reloadVersion,
    status,
  ]);

  useEffect(() => {
    if (!panelOpen || panelMode !== "detail" || !selectedProduct) return;
    if (!scopeTarget) {
      setPreviewState({
        phase: "error",
        message: "Select a supported Admin scope to preview this product.",
        requestId: null,
      });
      return;
    }
    const controller = new AbortController();
    setPreviewState({ phase: "loading" });
    const params = new URLSearchParams({ scopeKind: scopeTarget.kind });
    if (scopeTarget.kind === "LOCATION") {
      params.set("marketId", scopeTarget.marketId);
      params.set("locationId", scopeTarget.locationId);
    }
    void fetch(
      `/api/admin/catalog/products/${encodeURIComponent(selectedProduct.productId)}?${params}`,
      { signal: controller.signal },
    )
      .then(async (response) =>
        catalogResultSchema(adminProductDetailSchema).parse(await response.json()),
      )
      .then((result) => {
        if (controller.signal.aborted) return;
        if (result.ok) setPreviewState({ phase: "ready", product: result.value });
        else
          setPreviewState({
            phase: "error",
            message: result.error.message,
            requestId: result.error.requestId,
          });
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setPreviewState({
          phase: "error",
          message: "Product preview could not be loaded.",
          requestId: null,
        });
      });
    return () => controller.abort();
  }, [panelMode, panelOpen, previewAttempt, scopeTarget, selectedProduct]);

  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (value && value !== "all") next.set(key, value);
    else next.delete(key);
    pagination.reset();
    router.replace(`/admin/catalog/products${next.size ? `?${next}` : ""}`);
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
      setReloadVersion((current) => current + 1);
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
              aria-expanded={panelOpen && panelMode === "create"}
              aria-controls="product-detail-panel"
              onClick={() => {
                setPanelMode("create");
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
            page={payload.value}
            fromQuery={searchParams.toString()}
            canManage={canManage}
            deactivationPending={bulkPending}
            onDeactivateSelected={deactivateProducts}
            onOpenProduct={(product) => {
              setSelectedProduct(product);
              setPanelMode("detail");
              setPanelOpen(true);
            }}
            openProductId={panelOpen && panelMode === "detail" ? selectedProduct?.productId : null}
            detailPanelId="product-detail-panel"
            activeFilterCount={Number(query.trim().length > 0) + Number(status !== "all")}
            filters={
              <>
                <label className="grid gap-1.5 text-sm font-medium">
                  Search
                  <Input
                    aria-label="Search products"
                    value={query}
                    onChange={(event) => setFilter("query", event.target.value)}
                    placeholder="Search products"
                  />
                </label>
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

  const productDetail = selectedProduct ? (
    previewState.phase === "ready" ? (
      <ProductPreviewPanel
        product={previewState.product}
        fromQuery={searchParams.toString()}
        onClose={() => setPanelOpen(false)}
      />
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
          {previewState.phase === "error" ? (
            <Alert variant="destructive">
              <AlertTitle>Product preview could not be loaded</AlertTitle>
              <AlertDescription>
                {previewState.message}
                {previewState.requestId ? ` Request reference: ${previewState.requestId}` : ""}
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
        {previewState.phase === "error" ? (
          <div className="flex shrink-0 justify-end gap-2 border-t border-[var(--fm-border)] px-5 py-4">
            <Button type="button" variant="outline" onClick={() => setPanelOpen(false)}>
              Close
            </Button>
            <Button type="button" onClick={() => setPreviewAttempt((attempt) => attempt + 1)}>
              Retry
            </Button>
          </div>
        ) : null}
      </>
    )
  ) : null;

  const createDetail = (
    <NewProductWorkspace
      embedded
      onCancel={() => setPanelOpen(false)}
      onCreated={() => {
        setPanelOpen(false);
        setReloadVersion((current) => current + 1);
      }}
    />
  );

  return (
    <AdminMasterDetailWorkspace
      open={panelOpen && (panelMode === "create" || selectedProduct !== null)}
      master={master}
      detail={panelMode === "create" ? createDetail : productDetail}
      panelId="product-detail-panel"
      labelledBy={panelMode === "create" ? "create-product-panel-title" : "product-panel-title"}
      resizeLabel="Resize product details"
    />
  );
}
