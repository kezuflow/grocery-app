"use client";

import type { AdminCategoryPage, AdminCategorySummary, RpcResult } from "@freshmarkets/contracts";
import { adminCategorySummarySchema } from "@freshmarkets/validation";
import {
  Clipboard,
  EllipsisVertical,
  ExternalLink,
  Eye,
  Pencil,
  Plus,
  PowerOff,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ConfirmCommandDialog } from "@/components/admin/admin-controls";
import { PageHeader } from "@/components/admin/admin-shell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AdminStatusPill } from "@/components/admin/admin-status-pill";
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
import {
  AdminCursorPagination,
  AdminIndexViews,
  useAdminUrlPagination,
} from "@/components/admin/admin-controls";
import { useAdminContext } from "../../admin-context-provider";
import { AdminMasterDetailWorkspace } from "@/components/admin/admin-master-detail-workspace";
import { NewCategoryWorkspace } from "./new/page";
import { useCatalogCommand } from "@/components/admin/catalog-command-state";

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
  const [categoryToDeactivate, setCategoryToDeactivate] = useState<AdminCategorySummary | null>(
    null,
  );
  const deactivationIntent = useCatalogCommand(adminCategorySummarySchema);
  const [commandResult, setCommandResult] = useState<{
    kind: "success" | "error";
    message: string;
    requestId?: string;
  } | null>(null);
  const [copiedCategoryId, setCopiedCategoryId] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<AdminCategorySummary | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelMode, setPanelMode] = useState<"create" | "detail">("detail");
  const [creatorState, setCreatorState] = useState({ dirty: false, locked: false });
  const [reloadId, setReloadId] = useState(0);
  const pagination = useAdminUrlPagination("/admin/catalog/categories");
  const adminContext = useAdminContext();
  const query = searchParams.get("query") ?? initialQuery;
  const status = searchParams.get("status") ?? initialStatus;
  const canManage =
    adminContext.state.phase === "ready" &&
    adminContext.state.selectedScope?.kind === "GLOBAL" &&
    adminContext.state.context.capabilities.includes("catalog.manage");
  function canLeaveCreator() {
    if (!panelOpen || panelMode !== "create") return true;
    if (creatorState.locked) return false;
    return !creatorState.dirty || window.confirm("Discard this unsaved category?");
  }

  useEffect(() => {
    let current = true;
    if (
      !pagination.cursor &&
      query === initialQuery &&
      status === initialStatus &&
      reloadId === 0
    ) {
      setPayload(initialPayload);
      return;
    }
    setPayload(null);
    const params = new URLSearchParams({ limit: "50" });
    if (pagination.cursor) params.set("cursor", pagination.cursor);
    if (query.trim()) params.set("query", query.trim());
    if (status !== "all") params.set("status", status);
    void fetch(`/api/admin/catalog/categories?${params}`)
      .then((response) => response.json() as Promise<RpcResult<AdminCategoryPage>>)
      .then((result) => {
        if (current) setPayload(result);
      })
      .catch(() => {
        if (current)
          setPayload({
            ok: false,
            error: {
              code: "INTERNAL_ERROR",
              message: "Network error loading Categories",
              requestId: "unavailable",
            },
          });
      });
    return () => {
      current = false;
    };
  }, [pagination.cursor, query, status, initialPayload, initialQuery, initialStatus, reloadId]);

  const items = payload?.ok ? payload.value.items : [];
  function setFilter(key: string, value: string) {
    if (!canLeaveCreator()) return;
    if (panelOpen && panelMode === "create") setPanelOpen(false);
    const next = new URLSearchParams(searchParams.toString());
    if (value && value !== "all") next.set(key, value);
    else next.delete(key);
    pagination.reset(next);
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
    if (!categoryToDeactivate || deactivationIntent.pending) return;
    setCommandResult(null);
    try {
      const result = await deactivationIntent.submit(
        `/api/admin/catalog/categories/${encodeURIComponent(categoryToDeactivate.categoryId)}/status`,
        { status: "inactive", reason, expectedVersion: categoryToDeactivate.version },
        "POST",
        { title: "Category deactivated", description: categoryToDeactivate.name },
      );
      if (!result) return;
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
      setSelectedCategory(null);
      setPanelOpen(false);
      setReloadId((current) => current + 1);
    } catch {
      setCommandResult({
        kind: "error",
        message: "Connection lost. Retry the saved Category request to confirm its outcome.",
      });
    }
  }

  function openCategory(item: AdminCategorySummary) {
    if (!canLeaveCreator()) return;
    setSelectedCategory(item);
    setPanelMode("detail");
    setPanelOpen(true);
  }

  function categoryActions(item: AdminCategorySummary) {
    return (
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
          <DropdownMenuItem onSelect={() => openCategory(item)}>
            <Eye aria-hidden="true" />
            View details
          </DropdownMenuItem>
          {canManage ? (
            <DropdownMenuItem
              asChild
              onSelect={(event) => {
                if (!canLeaveCreator()) event.preventDefault();
              }}
            >
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
                disabled={deactivationIntent.pending || deactivationIntent.uncertain}
                onSelect={() => setCategoryToDeactivate(item)}
              >
                <PowerOff aria-hidden="true" />
                Deactivate
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  const master = (
    <section className="space-y-6 p-5 sm:p-7" aria-labelledby="admin-page-title">
      <PageHeader
        title="Categories"
        description="Global catalog hierarchy and Product assignments."
        action={
          canManage ? (
            <Button
              type="button"
              size="sm"
              className="fm-admin-reference-primary"
              aria-expanded={panelOpen && panelMode === "create"}
              aria-controls="category-detail-panel"
              disabled={panelOpen && panelMode === "create" && creatorState.locked}
              onClick={() => {
                if (!canLeaveCreator()) return;
                setPanelMode("create");
                setPanelOpen((open) => (panelMode === "create" ? !open : true));
              }}
            >
              <Plus aria-hidden="true" />
              Add category
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
      {!payload ? (
        <p role="status" className="text-sm">
          Loading Categories…
        </p>
      ) : null}
      {payload?.ok ? (
        <section className="overflow-hidden rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-[var(--fm-admin-surface)]">
          <AdminIndexViews
            label="Category status views"
            views={
              [
                { label: "All", status: "all" },
                { label: "Active", status: "active" },
                { label: "Inactive", status: "inactive" },
              ] as const
            }
            value={status}
            onChange={(next) => setFilter("status", next)}
          />
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--fm-border)] p-4">
            <Input
              aria-label="Search categories"
              value={query}
              onChange={(event) => setFilter("query", event.target.value)}
              placeholder="Search categories"
              className="sm:max-w-xs"
            />
            <span className="text-xs text-[var(--fm-text-muted)]">
              {items.length} categor{items.length === 1 ? "y" : "ies"} shown
            </span>
          </div>
          <Table aria-label="Categories" className="hidden md:table">
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
                    <button
                      type="button"
                      aria-expanded={
                        panelOpen &&
                        panelMode === "detail" &&
                        selectedCategory?.categoryId === item.categoryId
                      }
                      aria-controls="category-detail-panel"
                      className="font-medium hover:underline"
                      onClick={() => openCategory(item)}
                    >
                      {item.name}
                    </button>
                    <span className="block text-xs text-[var(--fm-text-muted)]">{item.code}</span>
                  </TableCell>
                  <TableCell>{item.parentName ?? "Top level"}</TableCell>
                  <TableCell>
                    <AdminStatusPill
                      status={item.status}
                      tone={item.status === "active" ? "success" : "danger"}
                      label={item.status.charAt(0).toUpperCase() + item.status.slice(1)}
                    />
                  </TableCell>
                  <TableCell>{item.productCount}</TableCell>
                  <TableCell className="w-12 text-right">{categoryActions(item)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div
            className="divide-y divide-[var(--fm-border)] md:hidden"
            aria-label="Category records"
          >
            {items.map((item) => (
              <article key={item.categoryId} className="space-y-3 p-4">
                <div className="flex items-start justify-between gap-2">
                  <button
                    type="button"
                    className="min-w-0 text-left font-semibold hover:underline"
                    aria-expanded={
                      panelOpen &&
                      panelMode === "detail" &&
                      selectedCategory?.categoryId === item.categoryId
                    }
                    aria-controls="category-detail-panel"
                    onClick={() => openCategory(item)}
                  >
                    <span className="block truncate">{item.name}</span>
                    <span className="block text-xs font-normal text-[var(--fm-text-muted)]">
                      {item.code}
                    </span>
                  </button>
                  {categoryActions(item)}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--fm-text-muted)]">
                  <AdminStatusPill
                    status={item.status}
                    tone={item.status === "active" ? "success" : "danger"}
                    label={item.status.charAt(0).toUpperCase() + item.status.slice(1)}
                  />
                  <span>{item.parentName ?? "Top level"}</span>
                  <span>
                    {item.productCount} product{item.productCount === 1 ? "" : "s"}
                  </span>
                </div>
                <Link
                  href={`/admin/catalog/categories/${item.categoryId}${searchParams.size ? `?from=${encodeURIComponent(searchParams.toString())}` : ""}`}
                  prefetch={false}
                  className="inline-flex text-sm font-medium underline underline-offset-4"
                  onClick={(event) => {
                    if (!canLeaveCreator()) event.preventDefault();
                  }}
                >
                  Full details
                </Link>
              </article>
            ))}
          </div>
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
        resource={categoryToDeactivate?.name ?? "Category"}
        scope="Global Catalog"
        consequence="This Category leaves active catalog navigation. Existing Product assignments and historical references remain intact."
        confirmLabel={
          deactivationIntent.uncertain ? "Retry saved deactivation" : "Confirm deactivation"
        }
        cancelLabel="Cancel"
        pending={deactivationIntent.pending}
        cancelDisabled={deactivationIntent.uncertain}
        onCancel={() => {
          if (!deactivationIntent.uncertain) setCategoryToDeactivate(null);
        }}
        onConfirm={(reason) => void deactivateCategory(reason)}
      />
    </section>
  );

  const categoryDetail = selectedCategory ? (
    <>
      <div className="flex items-start justify-between gap-4 border-b border-[var(--fm-border)] px-5 py-5">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--fm-text-muted)]">
            Category details
          </p>
          <h2
            id="category-panel-title"
            className="mt-1 truncate text-xl font-bold tracking-[-0.03em]"
          >
            {selectedCategory.name}
          </h2>
          <p className="mt-1 truncate text-sm text-[var(--fm-text-muted)]">
            {selectedCategory.code}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Close category details"
          onClick={() => setPanelOpen(false)}
        >
          <X aria-hidden="true" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <div className="mb-5">
          <AdminStatusPill
            status={selectedCategory.status}
            tone={selectedCategory.status === "active" ? "success" : "danger"}
            label={selectedCategory.status}
          />
        </div>
        <dl className="divide-y divide-[var(--fm-border)] rounded-lg border border-[var(--fm-border)]">
          {[
            ["Parent", selectedCategory.parentName ?? "Top level"],
            ["Products", String(selectedCategory.productCount)],
            ["Category ID", selectedCategory.categoryId],
          ].map(([label, value]) => (
            <div key={label} className="flex items-start justify-between gap-4 px-3 py-3 text-sm">
              <dt className="text-[var(--fm-text-muted)]">{label}</dt>
              <dd className="max-w-64 break-all text-right font-medium">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-[var(--fm-border)] px-5 py-4">
        <Button type="button" variant="outline" onClick={() => setPanelOpen(false)}>
          Close
        </Button>
        <Button asChild variant="outline">
          <Link
            href={`/admin/catalog/categories/${selectedCategory.categoryId}${searchParams.size ? `?from=${encodeURIComponent(searchParams.toString())}` : ""}`}
            prefetch={false}
          >
            <ExternalLink aria-hidden="true" />
            Full details
          </Link>
        </Button>
        {canManage ? (
          <Button asChild>
            <Link
              href={`/admin/catalog/categories/${selectedCategory.categoryId}/edit${searchParams.size ? `?from=${encodeURIComponent(searchParams.toString())}` : ""}`}
              prefetch={false}
            >
              <Pencil aria-hidden="true" />
              Edit category
            </Link>
          </Button>
        ) : null}
      </div>
    </>
  ) : null;

  const createDetail = (
    <NewCategoryWorkspace
      embedded
      onEditorStateChange={setCreatorState}
      onCancel={() => setPanelOpen(false)}
      onCreated={() => {
        setPanelOpen(false);
        setReloadId((current) => current + 1);
      }}
    />
  );

  return (
    <AdminMasterDetailWorkspace
      open={panelOpen && (panelMode === "create" || selectedCategory !== null)}
      master={master}
      detail={panelMode === "create" ? createDetail : categoryDetail}
      detailKey={panelMode === "create" ? "create" : selectedCategory?.categoryId}
      panelId="category-detail-panel"
      labelledBy={panelMode === "create" ? "create-category-panel-title" : "category-panel-title"}
      resizeLabel="Resize category workspace"
    />
  );
}
