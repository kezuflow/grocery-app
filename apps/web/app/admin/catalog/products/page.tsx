"use client";

import type { AdminProductPage, RpcResult } from "@freshmarkets/contracts";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AdminCursorPagination, useAdminPagination } from "@/components/admin/admin-controls";
import { useAdminContext } from "../../admin-context-provider";
import { PageHeader, StatusBadge } from "@/components/admin/admin-shell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default function ProductsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const query = searchParams.get("query") ?? "";
  const status = searchParams.get("status") ?? "all";
  const [payload, setPayload] = useState<RpcResult<AdminProductPage> | null>(null);
  const pagination = useAdminPagination();
  const adminContext = useAdminContext();
  const pricingTarget =
    adminContext.state.phase === "ready"
      ? adminContext.state.selectedScope?.kind === "LOCATION"
        ? {
            marketId: adminContext.state.selectedScope.marketId,
            locationId: adminContext.state.selectedScope.locationId,
          }
        : adminContext.state.selectedScope?.kind === "MARKET"
          ? { marketId: adminContext.state.selectedScope.marketId, locationId: null }
          : (() => {
              const option =
                adminContext.state.scopes.find((candidate) => candidate.kind === "location") ??
                adminContext.state.scopes.find((candidate) => candidate.kind === "market");
              return option
                ? {
                    marketId: option.marketId,
                    locationId: option.kind === "location" ? option.locationId : null,
                  }
                : null;
            })()
      : null;
  const canManage =
    adminContext.state.phase === "ready" &&
    adminContext.state.context.capabilities.includes("catalog.manage");
  useEffect(() => {
    if (!pricingTarget) return;
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
  }, [pagination.cursor, pricingTarget?.locationId, pricingTarget?.marketId, query, status]);
  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (value && value !== "all") next.set(key, value);
    else next.delete(key);
    pagination.reset();
    router.replace(`/admin/catalog/products${next.size ? `?${next}` : ""}`);
  }
  const items = payload?.ok ? payload.value.items : [];
  return (
    <div className="space-y-6">
      <PageHeader
        title="Products"
        description="Manage global Product identity, customer details, variants, media, pricing, and availability."
        action={
          canManage ? (
            <Button asChild>
              <Link href="/admin/catalog/products/new">Add product</Link>
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
        <section className="overflow-hidden rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-white">
          <div className="flex flex-col gap-3 border-b border-[var(--fm-border)] p-4 sm:flex-row">
            <Input
              aria-label="Search products"
              value={query}
              onChange={(event) => setFilter("query", event.target.value)}
              placeholder="Search products"
              className="sm:max-w-xs"
            />
            <select
              aria-label="Product status"
              value={status}
              onChange={(event) => setFilter("status", event.target.value)}
              className="h-9 rounded-[var(--fm-radius-control)] border border-[var(--fm-border)] bg-white px-3"
            >
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
          <Table aria-label="Products">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>SKUs</TableHead>
                <TableHead>
                  <span className="sr-only">Open</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((product) => (
                <TableRow key={product.productId}>
                  <TableCell>
                    <span className="font-medium">{product.name}</span>
                    <span className="block text-xs text-[var(--fm-text-muted)]">
                      {product.slug}
                    </span>
                  </TableCell>
                  <TableCell>{product.categoryCode}</TableCell>
                  <TableCell>
                    <StatusBadge tone={product.status === "active" ? "success" : "neutral"}>
                      {product.status}
                    </StatusBadge>
                  </TableCell>
                  <TableCell>{product.skuCount}</TableCell>
                  <TableCell>
                    <Link
                      className="font-medium text-[var(--fm-info)] underline"
                      href={`/admin/catalog/products/${product.productId}${searchParams.size ? `?from=${encodeURIComponent(searchParams.toString())}` : ""}`}
                    >
                      View
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {items.length === 0 ? (
            <p role="status" className="p-6 text-sm text-[var(--fm-text-muted)]">
              {payload.value.items.length === 0
                ? query.trim() || status !== "all"
                  ? "No products match these filters."
                  : "No products have been created."
                : "No products match these filters."}
            </p>
          ) : null}
          <AdminCursorPagination
            pageNumber={pagination.pageNumber}
            nextCursor={payload.value.nextCursor}
            onPrevious={pagination.previous}
            onNext={pagination.next}
          />
        </section>
      ) : null}
    </div>
  );
}
