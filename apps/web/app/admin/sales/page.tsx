"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  BadgePercent,
  CircleDollarSign,
  EllipsisVertical,
  Eye,
  Info,
  Pencil,
  Plus,
  Search,
  X,
} from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import type { AdminPromotionPage, AdminPromotionSummary } from "@freshmarkets/contracts";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
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
import { notifyCommandSuccess } from "@/components/admin/admin-feedback";
import { adminPromotionSummarySchema, adminPromotionPageSchema } from "@freshmarkets/validation";
import {
  SaleTargetsPicker,
  type SaleTargetSelection,
} from "@/components/admin/sale-targets-picker";
import {
  AdminIndexViews,
  AdminCursorPagination,
  useAdminUrlPagination,
} from "../../../components/admin/admin-controls";
import { AdminPageState } from "../../../components/admin/admin-page-state";
import { PageHeader, StatusBadge } from "../../../components/admin/admin-shell";
import { useAdminRouteGuard } from "../../../components/admin/use-admin-route-guard";
import { useAdminContext, useAdminScopeGuard } from "../admin-context-provider";
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

const saleBenefitOptions: ReadonlyArray<{
  type: SaleBenefitType;
  label: string;
  description: string;
  icon: typeof BadgePercent;
}> = [
  {
    type: "ORDER_PERCENT_DISCOUNT",
    label: "Percentage off each unit",
    description: "Reduce every selected selling unit by a whole percentage.",
    icon: BadgePercent,
  },
  {
    type: "ORDER_FIXED_DISCOUNT",
    label: "Amount off each unit",
    description: "Reduce every selected selling unit by a fixed peso amount.",
    icon: CircleDollarSign,
  },
];

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

function saleProductsLabel(promotion: AdminPromotionSummary): string {
  const targets = promotion.productTargets ?? [];
  if (!targets.length) return "—";
  const first = targets[0];
  const head = [first.productName, first.skuName].filter(Boolean).join(" · ");
  return targets.length > 1 ? `${head} +${targets.length - 1} more` : head;
}

function saleLocationsLabel(promotion: AdminPromotionSummary): string {
  const locations = [
    ...new Map(
      (promotion.productTargets ?? [])
        .filter((target) => target.locationName)
        .map((target) => [target.locationId, target.locationName]),
    ).values(),
  ];
  if (!locations.length) return "—";
  return locations.length > 1 ? `${locations[0]} +${locations.length - 1} more` : locations[0]!;
}

function saleDiscountLabel(promotion: AdminPromotionSummary): string {
  if (promotion.benefitType === "ORDER_PERCENT_DISCOUNT") return `${promotion.percent}% off`;
  return `PHP ${((promotion.discountMinor ?? 0) / 100).toFixed(2)} off`;
}

type SaleListView = "all" | "active" | "draft";

function saleListView(value: string | null): SaleListView {
  return value === "active" || value === "draft" ? value : "all";
}

export default function InventorySalesPage() {
  const admin = useAdminContext();
  if (admin.state.phase !== "ready") {
    return (
      <section className="space-y-6 p-5 sm:p-7" aria-labelledby="admin-page-title">
        <PageHeader title="Promotion Sale" />
        <AdminPageState state="loading" title="Loading Promotion Sale" />
      </section>
    );
  }

  const canRead =
    admin.state.selectedScope?.kind === "GLOBAL" &&
    admin.state.context.capabilities.includes("promotions.read");
  if (!canRead) {
    return (
      <section className="space-y-6 p-5 sm:p-7" aria-labelledby="admin-page-title">
        <PageHeader title="Promotion Sale" />
        <AdminPageState
          state="error"
          title="Promotion Sale is unavailable"
          message="Promotion Sale requires the promotions.read capability with a Global scope."
        />
      </section>
    );
  }

  const scopeKey = JSON.stringify(admin.state.selectedScope);
  return (
    <InventorySalesWorkspace
      key={scopeKey}
      canManage={admin.state.context.capabilities.includes("promotions.manage")}
    />
  );
}

function InventorySalesWorkspace({ canManage }: { canManage: boolean }) {
  const requestVersion = useRef(0);
  const searchParams = useSearchParams();
  const appliedQuery = searchParams.get("query") ?? "";
  const appliedView = saleListView(searchParams.get("status"));
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const [page, setPage] = useState<AdminPromotionPage | null>(null);
  const [name, setName] = useState("");
  const [benefit, setBenefit] = useState<SaleBenefitType>("ORDER_PERCENT_DISCOUNT");
  const [discount, setDiscount] = useState("");
  const [productTargets, setProductTargets] = useState<SaleTargetSelection[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [chooserOpen, setChooserOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [query, setQuery] = useState(appliedQuery);
  const [tab, setTab] = useState<SaleListView>(appliedView);
  const createIntent = useCatalogCommand(adminPromotionSummarySchema);
  const pagination = useAdminUrlPagination("/admin/sales");

  const createDirty =
    benefit !== "ORDER_PERCENT_DISCOUNT" ||
    name.trim() !== "" ||
    discount.trim() !== "" ||
    productTargets.length > 0;
  const createLocked = createIntent.pending || createIntent.uncertain;

  function resetCreateDraft(): void {
    setName("");
    setBenefit("ORDER_PERCENT_DISCOUNT");
    setDiscount("");
    setProductTargets([]);
    setChooserOpen(false);
    setEditorOpen(false);
  }

  useAdminScopeGuard(canManage && createDirty, canManage && createLocked, () => {
    resetCreateDraft();
  });
  useAdminRouteGuard(canManage && createDirty, canManage && createLocked);

  function chooseBenefit(type: SaleBenefitType): void {
    if (type !== benefit) setDiscount("");
    setBenefit(type);
    setChooserOpen(false);
    setEditorOpen(true);
    setNotice(null);
  }

  function discardCreateDraft(): void {
    if (createLocked) return;
    if (createDirty && !window.confirm("Discard this sale draft?")) return;
    resetCreateDraft();
    setNotice(null);
  }

  useEffect(() => {
    setQuery(appliedQuery);
    setTab(appliedView);
  }, [appliedQuery, appliedView]);

  function updateListFilters(nextQuery: string, nextView: SaleListView): void {
    const next = new URLSearchParams(searchParams.toString());
    const normalized = nextQuery.trim();
    if (normalized) next.set("query", normalized);
    else next.delete("query");
    if (nextView === "all") next.delete("status");
    else next.set("status", nextView);
    pagination.reset(next);
    window.history.replaceState(
      window.history.state,
      "",
      `/admin/sales${next.size ? `?${next}` : ""}`,
    );
  }

  const load = useCallback(async (cursor: string | null) => {
    const version = ++requestVersion.current;
    setState({ phase: "loading" });
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (cursor) params.set("cursor", cursor);
      const response = await fetch(`/api/admin/promotions?${params}`);
      const payload = catalogResultSchema(adminPromotionPageSchema).parse(await response.json());
      if (version !== requestVersion.current) return;
      if (!payload.ok) {
        setState({
          phase: "error",
          message:
            payload.error.code === "FORBIDDEN"
              ? "Promotion Sale requires the promotions.read capability with a Global scope."
              : payload.error.message,
          requestId: payload.error.requestId,
        });
        return;
      }
      setPage({ ...payload.value, items: payload.value.items.filter(isInventorySale) });
      setState({ phase: "ready" });
    } catch {
      if (version !== requestVersion.current) return;
      setState({ phase: "error", message: "Network error loading sales.", requestId: null });
    }
  }, []);

  useEffect(() => {
    void load(pagination.cursor);
    return () => {
      requestVersion.current += 1;
    };
  }, [load, pagination.cursor]);

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

  const createSummary = useMemo(() => {
    const trimmedDiscount = discount.trim();
    const [whole = "", fraction = ""] = trimmedDiscount.split(".");
    const amountMinor =
      /^\d+(\.\d{1,2})?$/.test(trimmedDiscount) && trimmedDiscount
        ? Number(whole) * 100 + Number(fraction.padEnd(2, "0"))
        : null;
    const percent = Number(trimmedDiscount);
    const validPercent =
      trimmedDiscount !== "" && Number.isInteger(percent) && percent >= 1 && percent <= 100;
    const value =
      benefit === "ORDER_PERCENT_DISCOUNT"
        ? validPercent
          ? `${percent}% off each unit`
          : "Percentage off each unit"
        : amountMinor !== null && Number.isSafeInteger(amountMinor) && amountMinor >= 1
          ? `₱${(amountMinor / 100).toFixed(2)} off each unit`
          : "Amount off each unit";
    const fixedTargets = productTargets.filter((target) => target.quantityLimit !== null);
    const wholeStockTargets = productTargets.length - fixedTargets.length;
    const fixedUnits = fixedTargets.reduce((sum, target) => sum + (target.quantityLimit ?? 0), 0);
    const allowance = [
      wholeStockTargets > 0
        ? `${wholeStockTargets} whole-stock ${wholeStockTargets === 1 ? "target" : "targets"}`
        : null,
      fixedTargets.length > 0
        ? `${fixedUnits} fixed sale ${fixedUnits === 1 ? "unit" : "units"} across ${fixedTargets.length} ${fixedTargets.length === 1 ? "target" : "targets"}`
        : null,
    ].filter(Boolean);

    return {
      type: saleBenefitLabels[benefit],
      value,
      targets:
        productTargets.length > 0
          ? `${productTargets.length} selling ${productTargets.length === 1 ? "option" : "options"} selected`
          : "No selling options selected",
      allowance: allowance.length > 0 ? allowance.join(" · ") : "No sale quantity selected",
    };
  }, [benefit, discount, productTargets]);

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
      return [sale.name, saleProductsLabel(sale), saleLocationsLabel(sale), saleDiscountLabel(sale)]
        .join(" ")
        .toLocaleLowerCase()
        .includes(normalized);
    });
  }, [page?.items, query, tab]);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (!canManage) return;
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
        notifyCommandSuccess("Sale created", "Saved as draft.");
        resetCreateDraft();
        const next = new URLSearchParams(searchParams.toString());
        pagination.reset(next);
        window.history.replaceState(
          window.history.state,
          "",
          `/admin/sales${next.size ? `?${next}` : ""}`,
        );
        void load(null);
      }
    } catch {
      setNotice(
        "Creation could not be confirmed. Check the same save again to resolve its outcome.",
      );
    }
  }

  return (
    <div className="w-full">
      <DialogPrimitive.Root
        open={chooserOpen}
        onOpenChange={(open) => {
          if (!open && !createLocked) setChooserOpen(false);
        }}
      >
        <DialogPrimitive.Portal>
          <div className="fm-admin contents">
            <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[rgb(15_23_42_/_0.42)]" />
            <DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-[var(--fm-radius-overlay)] border border-[var(--fm-border)] bg-[var(--fm-admin-surface)] text-[var(--fm-text)] shadow-[var(--fm-shadow-overlay)] focus:outline-none">
              <div className="flex items-start justify-between gap-4 border-b border-[var(--fm-border)] px-5 py-4">
                <div>
                  <DialogPrimitive.Title className="text-lg font-semibold tracking-[-0.02em]">
                    Select sale type
                  </DialogPrimitive.Title>
                  <DialogPrimitive.Description className="mt-1 text-sm text-[var(--fm-text-muted)]">
                    Choose how the sale reduces each selected selling unit.
                  </DialogPrimitive.Description>
                </div>
                <DialogPrimitive.Close asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Close sale type chooser"
                  >
                    <X aria-hidden="true" />
                  </Button>
                </DialogPrimitive.Close>
              </div>
              <div className="divide-y divide-[var(--fm-border)] p-2">
                {saleBenefitOptions.map((option) => {
                  const Icon = option.icon;
                  return (
                    <button
                      key={option.type}
                      type="button"
                      onClick={() => chooseBenefit(option.type)}
                      className="flex w-full items-center gap-3 rounded-[var(--fm-radius-control)] px-3 py-3 text-left transition-colors hover:bg-[var(--fm-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fm-focus)]"
                    >
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-[var(--fm-border)] bg-[var(--fm-admin-surface-muted)]">
                        <Icon className="size-4" aria-hidden="true" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold">{option.label}</span>
                        <span className="mt-0.5 block text-xs leading-5 text-[var(--fm-text-muted)]">
                          {option.description}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="flex justify-end border-t border-[var(--fm-border)] px-5 py-3">
                <DialogPrimitive.Close asChild>
                  <Button type="button" variant="outline">
                    Cancel
                  </Button>
                </DialogPrimitive.Close>
              </div>
            </DialogPrimitive.Content>
          </div>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      {state.phase === "loading" ? (
        <section className="space-y-6 p-5 sm:p-7" aria-labelledby="admin-page-title">
          <PageHeader title="Promotion Sale" />
          <AdminPageState state="loading" title="Loading Promotion Sale" />
        </section>
      ) : null}

      {state.phase === "error" ? (
        <section className="space-y-6 p-5 sm:p-7" aria-labelledby="admin-page-title">
          <PageHeader title="Promotion Sale" />
          <AdminPageState
            state="error"
            title="Promotion Sale could not be loaded"
            message={state.message}
            requestId={state.requestId ?? undefined}
            onRetry={() => void load(pagination.cursor)}
          />
        </section>
      ) : null}

      {state.phase === "ready" && editorOpen ? (
        <form
          onSubmit={create}
          aria-labelledby="admin-page-title"
          className="min-h-[calc(100svh-3.5rem)] md:min-h-[calc(100svh-4.5rem)]"
        >
          <header className="border-b border-[var(--fm-border)] bg-[var(--fm-admin-surface)] px-5 py-4 sm:px-7">
            <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4">
              <div className="flex min-w-0 items-center gap-3">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Discard sale and return to Promotion Sale"
                  onClick={discardCreateDraft}
                  disabled={createLocked}
                >
                  <ArrowLeft aria-hidden="true" />
                </Button>
                <div className="min-w-0">
                  <p className="text-xs font-medium text-[var(--fm-text-muted)]">Promotion Sale</p>
                  <h1
                    id="admin-page-title"
                    className="truncate text-xl font-bold tracking-[-0.03em]"
                  >
                    Create sale
                  </h1>
                </div>
              </div>
              <p className="hidden text-sm text-[var(--fm-text-muted)] sm:block">
                Saved sales begin as drafts.
              </p>
            </div>
          </header>

          <div className="mx-auto grid w-full max-w-6xl gap-5 p-5 sm:p-7 lg:grid-cols-[minmax(0,1.65fr)_minmax(18rem,0.8fr)] lg:items-start">
            <div className="space-y-5">
              <section
                className="rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-[var(--fm-admin-surface)] p-5 shadow-[var(--fm-shadow-card)]"
                aria-labelledby="sale-details-heading"
              >
                <h2 id="sale-details-heading" className="text-base font-semibold">
                  Sale details
                </h2>
                <label className="mt-4 block text-sm font-semibold">
                  Sale name<span className="text-red-600"> *</span>
                  <Input
                    aria-label="Sale name"
                    disabled={createLocked}
                    placeholder="Weekend vegetables"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    className="mt-1.5 h-10"
                  />
                </label>
              </section>

              <section
                className="rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-[var(--fm-admin-surface)] p-5 shadow-[var(--fm-shadow-card)]"
                aria-labelledby="sale-discount-heading"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 id="sale-discount-heading" className="text-base font-semibold">
                      Discount
                    </h2>
                    <p className="mt-1 text-sm text-[var(--fm-text-muted)]">
                      {saleBenefitLabels[benefit]}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setChooserOpen(true)}
                    disabled={createLocked}
                  >
                    Change type
                  </Button>
                </div>
                <label className="mt-4 block text-sm font-semibold sm:max-w-sm">
                  {benefit === "ORDER_PERCENT_DISCOUNT" ? "Discount percentage" : "Discount amount"}
                  <span className="text-red-600"> *</span>
                  <div className="relative mt-1.5">
                    {benefit === "ORDER_FIXED_DISCOUNT" ? (
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[var(--fm-text-muted)]">
                        ₱
                      </span>
                    ) : null}
                    <Input
                      aria-label={
                        benefit === "ORDER_PERCENT_DISCOUNT"
                          ? "Discount percentage"
                          : "Amount off in pesos"
                      }
                      disabled={createLocked}
                      placeholder={benefit === "ORDER_PERCENT_DISCOUNT" ? "15" : "50.00"}
                      inputMode="decimal"
                      value={discount}
                      onChange={(event) => setDiscount(event.target.value)}
                      className={`h-10 ${benefit === "ORDER_PERCENT_DISCOUNT" ? "pr-10" : "pl-8"}`}
                    />
                    {benefit === "ORDER_PERCENT_DISCOUNT" ? (
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-[var(--fm-text-muted)]">
                        %
                      </span>
                    ) : null}
                  </div>
                </label>
                <p className="mt-4 text-sm text-[var(--fm-text-muted)]">
                  The discount applies to each selected selling unit while the sale is active.
                </p>
              </section>

              <section
                className="rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-[var(--fm-admin-surface)] p-5 shadow-[var(--fm-shadow-card)]"
                aria-labelledby="sale-targets-heading"
              >
                <h2 id="sale-targets-heading" className="text-base font-semibold">
                  Products and quantities
                </h2>
                <p className="mt-1 text-sm text-[var(--fm-text-muted)]">
                  Select the location and selling options this sale covers. Each option can use
                  whole stock or a fixed clearance pool.
                </p>
                <div className="mt-4">
                  <SaleTargetsPicker
                    value={productTargets}
                    onChange={setProductTargets}
                    disabled={createLocked}
                    preview={discountPreview}
                    activeOverlaps={activeSaleTargetKeys}
                  />
                </div>
              </section>
            </div>

            <aside className="space-y-4 lg:sticky lg:top-5" aria-labelledby="sale-summary-heading">
              <section className="rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-[var(--fm-admin-surface)] p-5 shadow-[var(--fm-shadow-card)]">
                <h2 id="sale-summary-heading" className="text-base font-semibold">
                  Summary
                </h2>
                <p className="mt-1 break-words text-sm text-[var(--fm-text-muted)]">
                  {name.trim() || "Sale name not entered"}
                </p>
                <dl className="mt-4 divide-y divide-[var(--fm-border)] text-sm" aria-live="polite">
                  <div className="py-3 first:pt-0">
                    <dt className="text-xs font-medium text-[var(--fm-text-muted)]">Type</dt>
                    <dd className="mt-1 font-medium">{createSummary.type}</dd>
                  </div>
                  <div className="py-3">
                    <dt className="text-xs font-medium text-[var(--fm-text-muted)]">Value</dt>
                    <dd className="mt-1 font-medium">{createSummary.value}</dd>
                  </div>
                  <div className="py-3">
                    <dt className="text-xs font-medium text-[var(--fm-text-muted)]">Targets</dt>
                    <dd className="mt-1">{createSummary.targets}</dd>
                  </div>
                  <div className="py-3 last:pb-0">
                    <dt className="text-xs font-medium text-[var(--fm-text-muted)]">Allowance</dt>
                    <dd className="mt-1">{createSummary.allowance}</dd>
                  </div>
                </dl>
              </section>
              <p className="flex gap-2 px-1 text-xs leading-5 text-[var(--fm-text-muted)]">
                <Info
                  className="mt-0.5 size-3.5 shrink-0 text-[var(--fm-info)]"
                  aria-hidden="true"
                />
                Sale prices apply automatically to selected products after this draft is activated.
              </p>
            </aside>
          </div>

          {notice ? (
            <p
              role={createIntent.uncertain ? "alert" : "status"}
              className="mx-auto mb-4 w-[calc(100%-2.5rem)] max-w-6xl rounded-lg border border-[var(--fm-border)] bg-[var(--fm-admin-surface)] p-3 text-sm sm:w-[calc(100%-3.5rem)]"
            >
              {notice}
            </p>
          ) : null}

          <div className="sticky bottom-0 z-10 border-t border-[var(--fm-border)] bg-[var(--fm-admin-surface)] px-5 py-3 shadow-[0_-8px_24px_rgb(15_23_42_/_0.08)] sm:px-7">
            <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4">
              <p className="text-sm text-[var(--fm-text-muted)]" aria-live="polite">
                {createIntent.uncertain
                  ? "Save outcome unknown. Keep this editor open and check the same save."
                  : createDirty
                    ? "Unsaved changes"
                    : "Complete the sale details to save a draft."}
              </p>
              <div className="flex shrink-0 gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={discardCreateDraft}
                  disabled={createLocked}
                >
                  Discard
                </Button>
                <Button
                  type="submit"
                  disabled={createIntent.pending}
                  className="bg-[var(--fm-admin-accent)] text-white hover:bg-[var(--fm-admin-accent-strong)]"
                >
                  {createIntent.pending
                    ? "Saving…"
                    : createIntent.uncertain
                      ? "Check save status"
                      : "Save draft"}
                </Button>
              </div>
            </div>
          </div>
        </form>
      ) : null}

      {state.phase === "ready" && !editorOpen ? (
        <section className="flex min-w-0 flex-col p-5 sm:p-7" aria-labelledby="admin-page-title">
          <PageHeader
            title="Promotion Sale"
            description="Automatic discounts for selected products and locations."
            action={
              canManage ? (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => setChooserOpen(true)}
                  className="fm-admin-reference-primary"
                >
                  <Plus className="size-4" aria-hidden="true" />
                  New sale
                </Button>
              ) : undefined
            }
          />

          {notice ? (
            <p
              role="status"
              className="mt-5 rounded-lg border border-[var(--fm-border)] bg-[var(--fm-admin-surface-muted)] p-3 text-sm"
            >
              {notice}
            </p>
          ) : null}

          <section className="mt-8 overflow-hidden rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-[var(--fm-admin-surface)] shadow-[var(--fm-shadow-card)]">
            <h2 className="sr-only">Promotion Sale list</h2>
            <AdminIndexViews
              label="Promotion Sale views"
              views={[
                { label: "All sales", status: "all" },
                { label: "Active", status: "active" },
                { label: "Draft", status: "draft" },
              ]}
              value={tab}
              onChange={(nextView) => {
                if (createDirty || createLocked) return;
                setTab(nextView);
                updateListFilters(query, nextView);
              }}
            />
            <div className="flex flex-col gap-3 border-b border-[var(--fm-border)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-[var(--fm-text-muted)]" aria-live="polite">
                Showing {visibleSales.length} of {page?.items.length ?? 0} sales on this page.
                Search and status filter this page only.
              </p>
              <label className="relative block sm:w-72">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--fm-text-muted)]"
                  aria-hidden="true"
                />
                <Input
                  aria-label="Search inventory sales on this page"
                  placeholder="Search this page"
                  value={query}
                  disabled={createDirty || createLocked}
                  onChange={(event) => {
                    const nextQuery = event.target.value;
                    setQuery(nextQuery);
                    updateListFilters(nextQuery, tab);
                  }}
                  className="h-9 bg-[var(--fm-admin-surface)] pl-9 shadow-none"
                />
              </label>
            </div>

            <div className="overflow-x-auto">
              {visibleSales.length === 0 ? (
                <p className="p-6 text-sm text-[var(--fm-text-muted)]" role="status">
                  No inventory sales match this view on the current page. Other sales may appear on
                  later pages.
                </p>
              ) : (
                <Table aria-label="Promotion Sale list">
                  <TableHeader>
                    <TableRow className="bg-[var(--fm-admin-surface-muted)] hover:bg-[var(--fm-admin-surface-muted)]">
                      <TableHead>Sale</TableHead>
                      <TableHead>Products</TableHead>
                      <TableHead>Location</TableHead>
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
                          {saleProductsLabel(promotion)}
                        </TableCell>
                        <TableCell className="min-w-36 whitespace-nowrap text-sm text-[var(--fm-text-muted)]">
                          {saleLocationsLabel(promotion)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm text-[var(--fm-text-muted)]">
                          {saleDiscountLabel(promotion)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm text-[var(--fm-text-muted)]">
                          {saleAllowance(promotion)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <div className="flex items-center gap-3">
                            {canManage ? (
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
                            ) : (
                              <StatusBadge
                                tone={promotion.status === "ACTIVE" ? "success" : "neutral"}
                              >
                                {promotion.status === "ACTIVE" ? "Active" : promotion.status}
                              </StatusBadge>
                            )}
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
                              {canManage ? (
                                <DropdownMenuItem asChild>
                                  <Link
                                    href={`/admin/sales/${promotion.promotionId}?edit=1`}
                                    prefetch={false}
                                  >
                                    <Pencil aria-hidden="true" />
                                    Edit details
                                  </Link>
                                </DropdownMenuItem>
                              ) : null}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
            <AdminCursorPagination
              pageNumber={pagination.pageNumber}
              nextCursor={page?.nextCursor ?? null}
              pending={createDirty || createLocked}
              onPrevious={pagination.previous}
              onNext={pagination.next}
            />
          </section>
        </section>
      ) : null}
    </div>
  );
}
