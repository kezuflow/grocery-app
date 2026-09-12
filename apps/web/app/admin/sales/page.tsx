"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { EllipsisVertical, Eye, Info, Pencil, Plus, Search, X } from "lucide-react";
import type { AdminPromotionPage, AdminPromotionSummary } from "@freshmarkets/contracts";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Skeleton } from "../../../components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "../../../components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../components/ui/table";
import { PromotionStatusSwitch } from "../../../components/admin/promotion-status-switch";
import { useCatalogCommand, catalogResultSchema } from "@/components/admin/catalog-command-state";
import { adminPromotionSummarySchema, adminPromotionPageSchema } from "@freshmarkets/validation";
import {
  SaleTargetsPicker,
  type SaleTargetSelection,
} from "@/components/admin/sale-targets-picker";
import {
  AdminCursorPagination,
  useAdminPagination,
} from "../../../components/admin/admin-controls";
import {
  ADMIN_WORKSPACE_PANEL_DEFAULT_WIDTH,
  AdminWorkspaceResizeHandle,
} from "../../../components/admin/admin-workspace-resize-handle";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";

type LoadState =
  | { phase: "loading" }
  | { phase: "error"; message: string; requestId: string | null }
  | { phase: "ready" };

type SaleBenefitType = "ORDER_PERCENT_DISCOUNT" | "ORDER_FIXED_DISCOUNT";

const saleBenefitLabels: Record<SaleBenefitType, string> = {
  ORDER_PERCENT_DISCOUNT: "Percentage off each unit",
  ORDER_FIXED_DISCOUNT: "Amount off each unit",
};

function isInventorySale(promotion: AdminPromotionSummary): boolean {
  return Boolean(promotion.productTargets?.length);
}

function saleAllowance(promotion: AdminPromotionSummary): string {
  const targets = promotion.productTargets ?? [];
  const limited = targets.filter((target) => target.quantityLimit !== null);
  if (!limited.length) return "Whole stock";
  const remaining = limited.reduce((sum, target) => sum + (target.remainingQuantity ?? 0), 0);
  const limit = limited.reduce((sum, target) => sum + (target.quantityLimit ?? 0), 0);
  return `${limit - remaining}/${limit} pcs`;
}

function saleTargetsLabel(promotion: AdminPromotionSummary): string {
  const targets = promotion.productTargets ?? [];
  if (!targets.length) return "—";
  const first = targets[0];
  const head = [first.productName, first.skuName, first.locationName].filter(Boolean).join(" · ");
  return targets.length > 1 ? `${head} +${targets.length - 1} more` : head;
}

function saleDiscountLabel(promotion: AdminPromotionSummary): string {
  if (promotion.benefitType === "ORDER_PERCENT_DISCOUNT") return `${promotion.percent}% off`;
  return `PHP ${((promotion.discountMinor ?? 0) / 100).toFixed(2)} off`;
}

export default function InventorySalesPage() {
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const [page, setPage] = useState<AdminPromotionPage | null>(null);
  const [name, setName] = useState("");
  const [benefit, setBenefit] = useState<SaleBenefitType>("ORDER_PERCENT_DISCOUNT");
  const [discount, setDiscount] = useState("");
  const [productTargets, setProductTargets] = useState<SaleTargetSelection[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [panelMounted, setPanelMounted] = useState(false);
  const [panelWidth, setPanelWidth] = useState(ADMIN_WORKSPACE_PANEL_DEFAULT_WIDTH);
  const [panelResizing, setPanelResizing] = useState(false);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"all" | "active" | "draft">("all");
  const createIntent = useCatalogCommand(adminPromotionSummarySchema);
  const pagination = useAdminPagination();
  const closeTimer = useRef<number | null>(null);
  const openFrame = useRef<number | null>(null);

  function openPanel(): void {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    if (panelMounted) {
      setCreateOpen(true);
      return;
    }
    setPanelMounted(true);
    openFrame.current = window.requestAnimationFrame(() => {
      openFrame.current = window.requestAnimationFrame(() => {
        setCreateOpen(true);
        openFrame.current = null;
      });
    });
  }

  function closePanel(): void {
    if (openFrame.current !== null) {
      window.cancelAnimationFrame(openFrame.current);
      openFrame.current = null;
    }
    setCreateOpen(false);
    closeTimer.current = window.setTimeout(() => {
      setPanelMounted(false);
      closeTimer.current = null;
    }, 260);
  }

  useEffect(
    () => () => {
      if (openFrame.current !== null) window.cancelAnimationFrame(openFrame.current);
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    },
    [],
  );

  const load = useCallback((cursor: string | null) => {
    setState({ phase: "loading" });
    void (async () => {
      try {
        const params = new URLSearchParams({ limit: "50" });
        if (cursor) params.set("cursor", cursor);
        const response = await fetch(`/api/admin/promotions?${params}`);
        const payload = catalogResultSchema(adminPromotionPageSchema).parse(await response.json());
        if (!payload.ok) {
          setState({
            phase: "error",
            message:
              payload.error.code === "FORBIDDEN"
                ? "Inventory sales require the promotions.read capability with a global scope."
                : payload.error.message,
            requestId: payload.error.requestId,
          });
          return;
        }
        setPage({ ...payload.value, items: payload.value.items.filter(isInventorySale) });
        setState({ phase: "ready" });
      } catch {
        setState({ phase: "error", message: "Network error loading sales.", requestId: null });
      }
    })();
  }, []);

  useEffect(() => load(pagination.cursor), [load, pagination.cursor]);

  const discountPreview = (() => {
    const trimmed = discount.trim();
    if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
    if (benefit === "ORDER_PERCENT_DISCOUNT") {
      const percent = Number(trimmed);
      return Number.isInteger(percent) && percent >= 1 && percent <= 100
        ? { mode: "PERCENT" as const, value: percent }
        : null;
    }
    const amount = Number(trimmed);
    return amount >= 0.01 ? { mode: "FIXED" as const, value: amount } : null;
  })();

  const activeSaleTargetKeys = new Set(
    (page?.items ?? [])
      .filter((promotion) => promotion.status === "ACTIVE")
      .flatMap((promotion) =>
        (promotion.productTargets ?? []).map((target) => `${target.skuId}:${target.locationId}`),
      ),
  );

  const visibleSales = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return (page?.items ?? []).filter((sale) => {
      const matchesTab =
        tab === "all" ||
        (tab === "active" && sale.status === "ACTIVE") ||
        (tab === "draft" && sale.status === "DRAFT");
      if (!matchesTab) return false;
      if (!normalized) return true;
      return [sale.name, saleTargetsLabel(sale), saleDiscountLabel(sale)]
        .join(" ")
        .toLocaleLowerCase()
        .includes(normalized);
    });
  }, [page?.items, query, tab]);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (!productTargets.length) {
      setNotice("Add at least one selling option to the sale.");
      return;
    }
    if (name.trim() === "" || Number.isNaN(Number(discount))) {
      setNotice("A sale name and numeric discount are required.");
      return;
    }
    const [whole, fraction = ""] = discount.trim().split(".");
    const amount = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
    if (
      benefit === "ORDER_FIXED_DISCOUNT" &&
      (!/^\d+(\.\d{1,2})?$/.test(discount.trim()) || !Number.isSafeInteger(amount) || amount < 1)
    ) {
      setNotice("Enter a positive amount off with at most two decimal places.");
      return;
    }
    if (
      benefit === "ORDER_PERCENT_DISCOUNT" &&
      (!Number.isInteger(Number(discount)) || Number(discount) < 1 || Number(discount) > 100)
    ) {
      setNotice("Enter a whole percentage from 1 to 100.");
      return;
    }
    try {
      // Sales are automatic; the code never surfaces to customers, so it is
      // generated per attempt to satisfy the shared promotion contract. The
      // contract only accepts uppercase codes.
      const code = `SALE_${crypto
        .randomUUID()
        .replace(/[^A-Z0-9]/gi, "")
        .slice(0, 8)
        .toUpperCase()}`;
      const payload = await createIntent
        .submit("/api/admin/promotions", {
          code,
          name: name.trim(),
          description: "",
          benefitType: benefit,
          ...(benefit === "ORDER_FIXED_DISCOUNT"
            ? { discountMinor: amount }
            : { percent: Number(discount) }),
          minimumMinor: 0,
          productTargets: productTargets.map(({ skuId, locationId, quantityLimit }) => ({
            skuId,
            locationId,
            quantityLimit,
          })),
          automatic: true,
          startsAt: new Date().toISOString(),
        })
        .catch(() => createIntent.retry());
      if (!payload) return;
      setNotice(payload.ok ? "Sale created as DRAFT." : payload.error.message);
      if (payload.ok) {
        setName("");
        setDiscount("");
        setProductTargets([]);
        pagination.reset();
        load(null);
      }
    } catch {
      setNotice(
        "Creation could not be confirmed. Try Create draft again to check the same change.",
      );
    }
  }

  return (
    <div className="w-full">
      {state.phase === "loading" ? (
        <div className="space-y-3 p-5 sm:p-7" role="status" aria-label="Loading inventory sales">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-72 w-full" />
        </div>
      ) : null}

      {state.phase === "error" ? (
        <Alert variant="destructive" className="m-5 w-auto sm:m-7">
          <AlertTitle>Inventory sales could not be loaded</AlertTitle>
          <AlertDescription>
            {state.message}
            {state.requestId ? (
              <>
                <br />
                <span className="font-mono text-xs">Request reference: {state.requestId}</span>
              </>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      {state.phase === "ready" ? (
        <div
          data-admin-workspace
          style={{ "--fm-admin-workspace-panel-open-width": `${panelWidth}px` } as CSSProperties}
          className={`grid min-h-[calc(100svh-3.5rem)] md:min-h-[calc(100svh-4.5rem)] xl:[grid-template-columns:minmax(0,1fr)_var(--fm-admin-workspace-panel-width)] motion-reduce:transition-none ${panelResizing ? "xl:transition-none" : "xl:transition-[grid-template-columns] xl:duration-200 xl:ease-linear"} ${createOpen ? "xl:[--fm-admin-workspace-panel-width:var(--fm-admin-workspace-panel-open-width)]" : "xl:[--fm-admin-workspace-panel-width:0px]"}`}
        >
          <section className="flex min-w-0 flex-col p-5 sm:p-7" aria-labelledby="admin-page-title">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h1
                  id="admin-page-title"
                  className="text-[2rem] font-bold tracking-[-0.04em] text-[var(--fm-text)]"
                >
                  Inventory sales
                </h1>
                <p className="mt-1 text-sm text-[var(--fm-text-muted)]">
                  Automatic sale prices on selected products.
                </p>
              </div>
              <Button
                type="button"
                aria-expanded={createOpen}
                aria-controls="inventory-sale-panel"
                onClick={() => (createOpen ? closePanel() : openPanel())}
                className="h-10 shrink-0 rounded-lg bg-[var(--fm-admin-accent)] px-4 font-semibold text-white shadow-sm hover:bg-[var(--fm-admin-accent-strong)] active:scale-[0.98]"
              >
                <Plus className="size-4" aria-hidden="true" />
                New sale
              </Button>
            </div>

            {notice ? (
              <p
                role="status"
                className="mt-5 rounded-lg border border-[var(--fm-border)] bg-[var(--fm-admin-surface-muted)] p-3 text-sm"
              >
                {notice}
              </p>
            ) : null}

            <div className="mt-8 flex flex-col gap-3 border-b border-[var(--fm-border)] pb-3 sm:flex-row sm:items-end sm:justify-between">
              <div
                className="flex items-center gap-6"
                role="tablist"
                aria-label="Inventory sale status"
              >
                {(
                  [
                    ["all", "All sales", page?.items.length ?? 0],
                    [
                      "active",
                      "Active",
                      page?.items.filter((item) => item.status === "ACTIVE").length ?? 0,
                    ],
                    [
                      "draft",
                      "Draft",
                      page?.items.filter((item) => item.status === "DRAFT").length ?? 0,
                    ],
                  ] as const
                ).map(([value, label, count]) => (
                  <button
                    key={value}
                    type="button"
                    role="tab"
                    aria-selected={tab === value}
                    onClick={() => setTab(value)}
                    className={`relative flex items-center gap-2 pb-2 text-sm font-semibold transition-colors ${tab === value ? "text-[var(--fm-text)] after:absolute after:inset-x-0 after:-bottom-[13px] after:h-0.5 after:bg-[var(--fm-admin-accent)]" : "text-[var(--fm-text-muted)] hover:text-[var(--fm-text)]"}`}
                  >
                    {label}
                    <span className="rounded-full bg-[var(--fm-admin-surface-muted)] px-2 py-0.5 text-xs font-medium text-[var(--fm-text-muted)]">
                      {count}
                    </span>
                  </button>
                ))}
              </div>
              <label className="relative block sm:w-64">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--fm-text-muted)]"
                  aria-hidden="true"
                />
                <Input
                  aria-label="Search inventory sales"
                  placeholder="Search sales…"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className="h-10 bg-[var(--fm-admin-surface)] pl-9 shadow-none"
                />
              </label>
            </div>

            <div className="mt-4 overflow-x-auto rounded-lg border border-[var(--fm-border)]">
              {visibleSales.length === 0 ? (
                <p className="p-6 text-sm text-[var(--fm-text-muted)]" role="status">
                  No inventory sales match this view.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="bg-[var(--fm-admin-surface-muted)] hover:bg-[var(--fm-admin-surface-muted)]">
                      <TableHead>Sale</TableHead>
                      <TableHead>Products</TableHead>
                      <TableHead>Discount</TableHead>
                      <TableHead>Allowance</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>
                        <span className="sr-only">Manage</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleSales.map((promotion) => (
                      <TableRow key={promotion.promotionId} className="align-top">
                        <TableCell className="min-w-40 font-semibold text-[var(--fm-text)]">
                          {promotion.name}
                        </TableCell>
                        <TableCell className="min-w-48 max-w-72 text-sm text-[var(--fm-text-muted)]">
                          {saleTargetsLabel(promotion)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm text-[var(--fm-text-muted)]">
                          {saleDiscountLabel(promotion)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm text-[var(--fm-text-muted)]">
                          {saleAllowance(promotion)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <div className="flex items-center gap-3">
                            <PromotionStatusSwitch
                              promotion={promotion}
                              onApplied={(summary) =>
                                setPage((current) => {
                                  if (!current || !summary.productTargets?.length) return current;
                                  return {
                                    ...current,
                                    items: current.items.map((item) =>
                                      item.promotionId === summary.promotionId ? summary : item,
                                    ),
                                  };
                                })
                              }
                            />
                          </div>
                        </TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                aria-label={`Open actions for ${promotion.name}`}
                                className="size-8 rounded-md"
                              >
                                <EllipsisVertical aria-hidden="true" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem asChild>
                                <Link
                                  href={`/admin/sales/${promotion.promotionId}`}
                                  prefetch={false}
                                >
                                  <Eye aria-hidden="true" />
                                  View details
                                </Link>
                              </DropdownMenuItem>
                              <DropdownMenuItem asChild>
                                <Link
                                  href={`/admin/sales/${promotion.promotionId}?edit=1`}
                                  prefetch={false}
                                >
                                  <Pencil aria-hidden="true" />
                                  Edit details
                                </Link>
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>

            <div className="mt-auto flex items-center justify-between pt-6 text-sm text-[var(--fm-text-muted)]">
              <span>Page {pagination.pageNumber}</span>
              <AdminCursorPagination
                pageNumber={pagination.pageNumber}
                nextCursor={page?.nextCursor ?? null}
                onPrevious={pagination.previous}
                onNext={pagination.next}
              />
            </div>
          </section>

          {panelMounted ? (
            <aside
              id="inventory-sale-panel"
              className={`fixed inset-0 z-50 flex h-svh min-h-0 overflow-hidden xl:sticky xl:inset-auto xl:top-0 xl:z-auto xl:h-[calc(100svh-4.5rem)] ${createOpen ? "" : "pointer-events-none"}`}
              aria-labelledby="new-sale-title"
            >
              <form
                className={`ml-auto flex h-full min-h-0 w-full flex-col bg-[var(--fm-admin-surface)] transition-[transform,opacity] [transition-duration:var(--fm-motion-panel)] [transition-timing-function:var(--fm-ease-drawer)] will-change-[transform,opacity] motion-reduce:transform-none motion-reduce:transition-[opacity] motion-reduce:[transition-duration:var(--fm-motion-fast)] motion-reduce:[transition-timing-function:var(--fm-ease-out)] xl:absolute xl:inset-y-0 xl:right-0 xl:w-[var(--fm-admin-workspace-panel-open-width)] xl:border-l xl:border-[var(--fm-border)] ${createOpen ? "translate-x-0 opacity-100" : "translate-x-full opacity-0 xl:translate-x-0"}`}
                onSubmit={create}
              >
                <AdminWorkspaceResizeHandle
                  label="Resize inventory sale workspace"
                  width={panelWidth}
                  onWidthChange={setPanelWidth}
                  onResizeStateChange={setPanelResizing}
                />
                <div className="flex items-start justify-between gap-4 border-b border-[var(--fm-border)] px-5 py-5">
                  <div>
                    <h2 id="new-sale-title" className="text-xl font-bold tracking-[-0.03em]">
                      New inventory sale
                    </h2>
                    <p className="mt-1 text-sm text-[var(--fm-text-muted)]">
                      Create a draft sale and choose the products it applies to.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={closePanel}
                    disabled={createIntent.pending}
                    aria-label="Close new inventory sale"
                  >
                    <X aria-hidden="true" />
                  </Button>
                </div>
                <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
                  <label className="block text-sm font-semibold">
                    Sale name
                    <Input
                      aria-label="Sale name"
                      disabled={createIntent.pending || createIntent.uncertain}
                      placeholder="Weekend vegetables"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      className="mt-1.5 h-10"
                    />
                  </label>
                  <fieldset
                    disabled={createIntent.pending || createIntent.uncertain}
                    className="space-y-2"
                  >
                    <legend className="text-sm font-semibold">Discount type</legend>
                    <div className="grid grid-cols-2 gap-1 rounded-lg border border-[var(--fm-border)] p-1">
                      <button
                        type="button"
                        onClick={() => setBenefit("ORDER_PERCENT_DISCOUNT")}
                        className={`flex min-h-9 items-center justify-center gap-2 rounded-md px-2 text-xs font-semibold transition-colors ${benefit === "ORDER_PERCENT_DISCOUNT" ? "bg-[var(--fm-admin-accent)] text-white" : "text-[var(--fm-text-muted)] hover:bg-[var(--fm-hover)]"}`}
                      >
                        % off
                      </button>
                      <button
                        type="button"
                        onClick={() => setBenefit("ORDER_FIXED_DISCOUNT")}
                        className={`flex min-h-9 items-center justify-center gap-2 rounded-md px-2 text-xs font-semibold transition-colors ${benefit === "ORDER_FIXED_DISCOUNT" ? "bg-[var(--fm-admin-accent)] text-white" : "text-[var(--fm-text-muted)] hover:bg-[var(--fm-hover)]"}`}
                      >
                        ₱ off
                      </button>
                    </div>
                    <Select
                      value={benefit}
                      onValueChange={(value) =>
                        setBenefit(
                          value === "ORDER_FIXED_DISCOUNT" ? value : "ORDER_PERCENT_DISCOUNT",
                        )
                      }
                    >
                      <SelectTrigger className="sr-only" aria-label="Sale discount type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(saleBenefitLabels) as SaleBenefitType[]).map((type) => (
                          <SelectItem key={type} value={type}>
                            {saleBenefitLabels[type]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </fieldset>
                  <label className="block text-sm font-semibold">
                    {benefit === "ORDER_PERCENT_DISCOUNT" ? "Percentage" : "Amount off"}
                    <div className="relative mt-1.5">
                      <Input
                        aria-label={
                          benefit === "ORDER_PERCENT_DISCOUNT"
                            ? "Discount percentage"
                            : "Amount off in pesos"
                        }
                        disabled={createIntent.pending || createIntent.uncertain}
                        placeholder={benefit === "ORDER_PERCENT_DISCOUNT" ? "15" : "50"}
                        value={discount}
                        onChange={(event) => setDiscount(event.target.value)}
                        className="h-10 pr-10"
                      />
                      {benefit === "ORDER_PERCENT_DISCOUNT" ? (
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-[var(--fm-text-muted)]">
                          %
                        </span>
                      ) : null}
                    </div>
                  </label>
                  <SaleTargetsPicker
                    value={productTargets}
                    onChange={setProductTargets}
                    disabled={createIntent.pending || createIntent.uncertain}
                    preview={discountPreview}
                    activeOverlaps={activeSaleTargetKeys}
                  />
                  <p className="flex gap-2 text-xs text-[var(--fm-text-muted)]">
                    <Info className="mt-0.5 size-3.5 shrink-0 text-blue-500" aria-hidden="true" />
                    Sale prices apply automatically to the selected products when the sale is
                    active.
                  </p>
                </div>
                <div className="flex shrink-0 justify-end gap-2 border-t border-[var(--fm-border)] bg-[var(--fm-admin-surface)] px-5 py-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={closePanel}
                    disabled={createIntent.pending}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={createIntent.pending}
                    className="bg-[var(--fm-admin-accent)] text-white hover:bg-[var(--fm-admin-accent-strong)]"
                  >
                    {createIntent.pending ? "Creating…" : "Create draft"}
                  </Button>
                </div>
              </form>
            </aside>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
