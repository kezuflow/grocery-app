"use client";

import type { AdminCategoryPage, RpcResult } from "@freshmarkets/contracts";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
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
import { PageHeader, StatusBadge } from "@/components/admin/admin-shell";
import { AdminCursorPagination, useAdminPagination } from "@/components/admin/admin-controls";
import { useAdminContext } from "../../admin-context-provider";

export default function CategoriesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [payload, setPayload] = useState<RpcResult<AdminCategoryPage> | null>(null);
  const pagination = useAdminPagination();
  const adminContext = useAdminContext();
  const query = searchParams.get("query") ?? "";
  const status = searchParams.get("status") ?? "all";
  const canManage =
    adminContext.state.phase === "ready" &&
    adminContext.state.context.capabilities.includes("catalog.manage");
  useEffect(() => {
    setPayload(null);
    const params = new URLSearchParams({ limit: "50" });
    if (query.trim()) params.set("query", query.trim());
    if (status !== "all") params.set("status", status);
    if (pagination.cursor) params.set("cursor", pagination.cursor);
    void fetch(`/api/admin/catalog/categories?${params}`)
      .then((response) => response.json() as Promise<RpcResult<AdminCategoryPage>>)
      .then(setPayload)
      .catch(() =>
        setPayload({
          ok: false,
          error: {
            code: "INTERNAL_ERROR",
            message: "Network error loading Categories",
            requestId: "unavailable",
          },
        }),
      );
  }, [pagination.cursor, query, status]);
  const items = payload?.ok ? payload.value.items : [];
  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (value && value !== "all") next.set(key, value);
    else next.delete(key);
    pagination.reset();
    router.replace(`/admin/catalog/categories${next.size ? `?${next}` : ""}`);
  }
  return (
    <div className="space-y-6">
      <PageHeader
        title="Categories"
        description="Manage the global customer-facing hierarchy and contained products."
        action={
          canManage ? (
            <Button asChild>
              <Link href="/admin/catalog/categories/new">Add category</Link>
            </Button>
          ) : null
        }
      />
      {!payload ? <Skeleton className="h-64 w-full" /> : null}
      {payload && !payload.ok ? (
        <Alert variant="destructive">
          <AlertTitle>Categories could not be loaded</AlertTitle>
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
              aria-label="Search categories"
              value={query}
              onChange={(event) => setFilter("query", event.target.value)}
              placeholder="Search categories"
              className="sm:max-w-xs"
            />
            <select
              aria-label="Category status"
              value={status}
              onChange={(event) => setFilter("status", event.target.value)}
              className="h-9 rounded-[var(--fm-radius-control)] border border-[var(--fm-border)] bg-white px-3"
            >
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
          <Table aria-label="Categories">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Parent</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Products</TableHead>
                <TableHead>
                  <span className="sr-only">Open</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.categoryId}>
                  <TableCell>
                    <span className="font-medium">{item.name}</span>
                    <span className="block text-xs text-[var(--fm-text-muted)]">{item.code}</span>
                  </TableCell>
                  <TableCell>{item.parentName ?? "Top level"}</TableCell>
                  <TableCell>
                    <StatusBadge tone={item.status === "active" ? "success" : "neutral"}>
                      {item.status}
                    </StatusBadge>
                  </TableCell>
                  <TableCell>{item.productCount}</TableCell>
                  <TableCell>
                    <Link
                      className="font-medium text-[var(--fm-info)] underline"
                      href={`/admin/catalog/categories/${item.categoryId}${searchParams.size ? `?from=${encodeURIComponent(searchParams.toString())}` : ""}`}
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
                  ? "No categories match these filters."
                  : "No categories have been created."
                : "No categories match these filters."}
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
