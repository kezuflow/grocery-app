"use client";

import type { AdminProductPage, RpcResult } from "@freshmarkets/contracts";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
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
  useEffect(() => {
    const params = new URLSearchParams({ limit: "100" });
    if (query.trim()) params.set("query", query.trim());
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
  }, [query]);
  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (value && value !== "all") next.set(key, value);
    else next.delete(key);
    router.replace(`/admin/catalog/products${next.size ? `?${next}` : ""}`);
  }
  const items = payload?.ok
    ? payload.value.items.filter((item) => status === "all" || item.status === status)
    : [];
  return (
    <div className="space-y-6">
      <PageHeader
        title="Products"
        description="Manage global Product identity, customer details, variants, media, pricing, and availability."
        action={
          <Button asChild>
            <Link href="/admin/catalog/products/new">Add product</Link>
          </Button>
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
                ? "No products have been created."
                : "No products match these filters."}
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
