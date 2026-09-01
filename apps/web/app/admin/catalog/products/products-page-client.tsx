"use client";

import type { AdminProductPage, AdminProductSummary, RpcResult } from "@freshmarkets/contracts";
import Link from "next/link";
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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { WorkspaceNavigation } from "@/components/admin/workspace-navigation";
import {
  resolveAdminProductPricingTarget,
  type AdminProductPricingTarget,
} from "@/lib/admin/product-pricing-target";

type ProductsPageClientProps = {
  initialPayload: RpcResult<AdminProductPage> | null;
  initialPricingTarget: AdminProductPricingTarget | null;
  initialQuery: string;
  initialStatus: string;
};

function samePricingTarget(
  left: AdminProductPricingTarget | null,
  right: AdminProductPricingTarget | null,
): boolean {
  return left?.marketId === right?.marketId && left?.locationId === right?.locationId;
}

export function ProductsPageClient({
  initialPayload,
  initialPricingTarget,
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
  const pagination = useAdminPagination();
  const adminContext = useAdminContext();
  const pricingTarget = useMemo(
    () =>
      adminContext.state.phase === "ready"
        ? resolveAdminProductPricingTarget(
            adminContext.state.selectedScope,
            adminContext.state.scopes,
          )
        : null,
    [adminContext.state],
  );
  const canManage =
    adminContext.state.phase === "ready" &&
    adminContext.state.context.capabilities.includes("catalog.manage");

  useEffect(() => {
    if (!pricingTarget) return;
    const filterNavigationPending = query !== initialQuery || status !== initialStatus;
    if (filterNavigationPending && !pagination.cursor && reloadVersion === 0) return;
    const serverPayloadMatches =
      initialPayload !== null &&
      !pagination.cursor &&
      reloadVersion === 0 &&
      samePricingTarget(pricingTarget, initialPricingTarget);
    if (serverPayloadMatches) return;

    setPayload(null);
    const params = new URLSearchParams({ limit: "50" });
    params.set("marketId", pricingTarget.marketId);
    if (pricingTarget.locationId) params.set("locationId", pricingTarget.locationId);
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
    initialPricingTarget,
    initialQuery,
    initialStatus,
    pagination.cursor,
    pricingTarget,
    query,
    reloadVersion,
    status,
  ]);

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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Products"
        description="Manage global Product identity, customer details, variants, media, pricing, and availability."
        action={
          canManage ? (
            <Button asChild>
              <Link href="/admin/catalog/products/new" prefetch={false}>
                Add product
              </Link>
            </Button>
          ) : null
        }
      />
      <WorkspaceNavigation parentCode="products" label="Product administration" />
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
                    className="h-9 rounded-[var(--fm-radius-control)] border border-[var(--fm-border)] bg-white px-3 font-normal"
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
    </div>
  );
}
