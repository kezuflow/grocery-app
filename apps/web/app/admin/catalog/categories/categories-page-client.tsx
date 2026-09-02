"use client";

import type { AdminCategoryPage, AdminCategorySummary, RpcResult } from "@freshmarkets/contracts";
import { Clipboard, EllipsisVertical, Eye, Pencil, Plus, PowerOff } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ConfirmCommandDialog } from "@/components/admin/admin-controls";
import { PageHeader } from "@/components/admin/admin-shell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AdminCursorPagination, useAdminPagination } from "@/components/admin/admin-controls";
import { useAdminContext } from "../../admin-context-provider";

type CategoriesPageClientProps = {
  initialPayload: RpcResult<AdminCategoryPage>;
  initialQuery: string;
  initialStatus: string;
};

export function CategoriesPageClient({
  initialPayload,
  initialQuery,
  initialStatus,
}: CategoriesPageClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [payload, setPayload] = useState<RpcResult<AdminCategoryPage> | null>(initialPayload);
  const [categoryToDeactivate, setCategoryToDeactivate] = useState<{
    item: AdminCategorySummary;
    idempotencyKey: string;
  } | null>(null);
  const [deactivationPending, setDeactivationPending] = useState(false);
  const [commandResult, setCommandResult] = useState<{
    kind: "success" | "error";
    message: string;
    requestId?: string;
  } | null>(null);
  const [copiedCategoryId, setCopiedCategoryId] = useState<string | null>(null);
  const pagination = useAdminPagination();
  const adminContext = useAdminContext();
  const query = searchParams.get("query") ?? initialQuery;
  const status = searchParams.get("status") ?? initialStatus;
  const canManage =
    adminContext.state.phase === "ready" &&
    adminContext.state.context.capabilities.includes("catalog.manage");

  useEffect(() => {
    if (!pagination.cursor) return;
    setPayload(null);
    const params = new URLSearchParams({ limit: "50", cursor: pagination.cursor });
    if (query.trim()) params.set("query", query.trim());
    if (status !== "all") params.set("status", status);
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

  async function copyCategoryId(categoryId: string) {
    await navigator.clipboard.writeText(categoryId);
    setCopiedCategoryId(categoryId);
    window.setTimeout(() => {
      setCopiedCategoryId((current) => (current === categoryId ? null : current));
    }, 2_000);
  }

  async function deactivateCategory(reason: string) {
    if (!categoryToDeactivate || deactivationPending) return;
    setDeactivationPending(true);
    setCommandResult(null);
    try {
      const response = await fetch(
        `/api/admin/catalog/categories/${encodeURIComponent(categoryToDeactivate.item.categoryId)}/status`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": categoryToDeactivate.idempotencyKey,
          },
          body: JSON.stringify({
            status: "inactive",
            reason,
            expectedVersion: categoryToDeactivate.item.version,
          }),
        },
      );
      const result = (await response.json()) as RpcResult<AdminCategorySummary>;
      if (!result.ok) {
        setCommandResult({
          kind: "error",
          message: result.error.message,
          requestId: result.error.requestId,
        });
        setCategoryToDeactivate(null);
        return;
      }
      setPayload((current) =>
        current?.ok
          ? {
              ...current,
              value: {
                ...current.value,
                items: current.value.items.map((item) =>
                  item.categoryId === result.value.categoryId ? result.value : item,
                ),
              },
            }
          : current,
      );
      setCommandResult({ kind: "success", message: `${result.value.name} deactivated.` });
      setCategoryToDeactivate(null);
    } catch {
      setCommandResult({ kind: "error", message: "Network error while deactivating category." });
      setCategoryToDeactivate(null);
    } finally {
      setDeactivationPending(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Categories"
        action={
          canManage ? (
            <Button asChild size="sm" className="fm-admin-reference-primary">
              <Link href="/admin/catalog/categories/new" prefetch={false}>
                <Plus aria-hidden="true" />
                Add category
              </Link>
            </Button>
          ) : null
        }
      />
      {commandResult ? (
        commandResult.kind === "error" ? (
          <Alert variant="destructive">
            <AlertTitle>Category could not be deactivated</AlertTitle>
            <AlertDescription>
              {commandResult.message}
              {commandResult.requestId ? ` Request reference: ${commandResult.requestId}` : ""}
            </AlertDescription>
          </Alert>
        ) : (
          <p className="text-sm" role="status">
            {commandResult.message}
          </p>
        )
      ) : null}
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
                <TableHead className="w-12 text-right">
                  <span className="sr-only">Actions</span>
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
                    <Badge
                      className={`h-5 rounded-full px-2 py-0.5 font-medium capitalize whitespace-nowrap ${
                        item.status === "active"
                          ? "fm-product-status-active"
                          : "fm-product-status-inactive"
                      }`}
                      variant="secondary"
                    >
                      {item.status}
                    </Badge>
                  </TableCell>
                  <TableCell>{item.productCount}</TableCell>
                  <TableCell className="w-12 text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Open actions for ${item.name}`}
                          className="size-7 rounded-md"
                        >
                          <EllipsisVertical aria-hidden="true" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem asChild>
                          <a
                            href={`/admin/catalog/categories/${item.categoryId}${searchParams.size ? `?from=${encodeURIComponent(searchParams.toString())}` : ""}`}
                          >
                            <Eye aria-hidden="true" />
                            View details
                          </a>
                        </DropdownMenuItem>
                        {canManage ? (
                          <DropdownMenuItem asChild>
                            <a
                              href={`/admin/catalog/categories/${item.categoryId}/edit${searchParams.size ? `?from=${encodeURIComponent(searchParams.toString())}` : ""}`}
                            >
                              <Pencil aria-hidden="true" />
                              Edit category
                            </a>
                          </DropdownMenuItem>
                        ) : null}
                        <DropdownMenuItem onSelect={() => void copyCategoryId(item.categoryId)}>
                          <Clipboard aria-hidden="true" />
                          {copiedCategoryId === item.categoryId ? "ID copied" : "Copy ID"}
                        </DropdownMenuItem>
                        {canManage && item.status === "active" ? (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-[var(--fm-destructive)] focus:bg-[var(--fm-danger-soft)] focus:text-[var(--fm-destructive)]"
                              disabled={deactivationPending}
                              onSelect={() =>
                                setCategoryToDeactivate({
                                  item,
                                  idempotencyKey: crypto.randomUUID(),
                                })
                              }
                            >
                              <PowerOff aria-hidden="true" />
                              Deactivate
                            </DropdownMenuItem>
                          </>
                        ) : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {items.length === 0 ? (
            <p role="status" className="p-6 text-sm text-[var(--fm-text-muted)]">
              {query.trim() || status !== "all"
                ? "No categories match these filters."
                : "No categories have been created."}
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
      <ConfirmCommandDialog
        open={categoryToDeactivate !== null}
        title="Deactivate category?"
        resource={categoryToDeactivate?.item.name ?? "Category"}
        scope="Global Catalog"
        consequence="This Category leaves active catalog navigation. Existing Product assignments and historical references remain intact."
        confirmLabel="Confirm deactivation"
        cancelLabel="Cancel"
        pending={deactivationPending}
        onCancel={() => setCategoryToDeactivate(null)}
        onConfirm={(reason) => void deactivateCategory(reason)}
      />
    </div>
  );
}
