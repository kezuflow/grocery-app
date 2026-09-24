"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
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
  Truck,
  X,
} from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import {
  type ManageableBenefitType,
  type AdminPromotionPage,
  type AdminPromotionSummary,
} from "@freshmarkets/contracts";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
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
  AdminIndexViews,
  AdminCursorPagination,
  useAdminUrlPagination,
} from "../../../components/admin/admin-controls";
import { AdminPageState } from "../../../components/admin/admin-page-state";
import { PageHeader, StatusBadge } from "../../../components/admin/admin-shell";
import { useAdminRouteGuard } from "../../../components/admin/use-admin-route-guard";
import { useAdminContext, useAdminScopeGuard } from "../admin-context-provider";
import {
  ADMIN_WORKSPACE_PANEL_DEFAULT_WIDTH,
  AdminWorkspaceResizeHandle,
} from "../../../components/admin/admin-workspace-resize-handle";

type LoadState =
  | { phase: "loading" }
  | { phase: "error"; message: string; requestId: string | null }
  | { phase: "ready" };

type PromotionListView = "all" | "active" | "draft";

const benefitOptions: ReadonlyArray<{
  type: ManageableBenefitType;
  label: string;
  description: string;
  icon: typeof BadgePercent;
}> = [
  {
    type: "ORDER_FIXED_DISCOUNT",
    label: "Amount off order",
    description: "Take a fixed peso amount off eligible full-price merchandise.",
    icon: CircleDollarSign,
  },
  {
    type: "ORDER_PERCENT_DISCOUNT",
    label: "Percentage off order",
    description: "Take a whole percentage off eligible full-price merchandise.",
    icon: BadgePercent,
  },
  {
    type: "DELIVERY_FEE_WAIVER",
    label: "Free delivery",
    description: "Waive the eligible delivery fee.",
    icon: Truck,
  },
  {
    type: "DELIVERY_FIXED_DISCOUNT",
    label: "Amount off delivery",
    description: "Take a fixed peso amount off the eligible delivery fee.",
    icon: CircleDollarSign,
  },
  {
    type: "DELIVERY_PERCENT_DISCOUNT",
    label: "Percentage off delivery",
    description: "Take a whole percentage off the eligible delivery fee.",
    icon: BadgePercent,
  },
];

function benefitOption(type: ManageableBenefitType) {
  return benefitOptions.find((option) => option.type === type) ?? benefitOptions[0];
}

function promotionListView(value: string | null): PromotionListView {
  return value === "active" || value === "draft" ? value : "all";
}

export default function PromotionsPage() {
  const admin = useAdminContext();
  if (admin.state.phase !== "ready") {
    return (
      <section className="space-y-6 p-5 sm:p-7" aria-labelledby="admin-page-title">
        <PageHeader title="Promotion Codes" />
        <AdminPageState state="loading" title="Loading promotion codes" />
      </section>
    );
  }

  const canRead =
    admin.state.selectedScope?.kind === "GLOBAL" &&
    admin.state.context.capabilities.includes("promotions.read");
  if (!canRead) {
    return (
      <section className="space-y-6 p-5 sm:p-7" aria-labelledby="admin-page-title">
        <PageHeader title="Promotion Codes" />
        <AdminPageState
          state="error"
          title="Promotion Codes are unavailable"
          message="Promotion code administration requires the promotions.read capability with a Global scope."
        />
      </section>
    );
  }

  const scopeKey = JSON.stringify(admin.state.selectedScope);
  return (
    <PromotionsWorkspace
      key={scopeKey}
      canManage={admin.state.context.capabilities.includes("promotions.manage")}
    />
  );
}

function PromotionsWorkspace({ canManage }: { canManage: boolean }) {
  const requestVersion = useRef(0);
  const searchParams = useSearchParams();
  const appliedQuery = searchParams.get("query") ?? "";
  const appliedView = promotionListView(searchParams.get("status"));
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const [page, setPage] = useState<AdminPromotionPage | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [benefit, setBenefit] = useState<ManageableBenefitType>("ORDER_FIXED_DISCOUNT");
  const [discount, setDiscount] = useState("");
  const [minimum, setMinimum] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [globalLimit, setGlobalLimit] = useState("");
  const [perCustomerLimit, setPerCustomerLimit] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [chooserOpen, setChooserOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [panelMounted, setPanelMounted] = useState(false);
  const [panelWidth, setPanelWidth] = useState(ADMIN_WORKSPACE_PANEL_DEFAULT_WIDTH);
  const [panelResizing, setPanelResizing] = useState(false);
  const [selectedPromotion, setSelectedPromotion] = useState<AdminPromotionSummary | null>(null);
  const [query, setQuery] = useState(appliedQuery);
  const [tab, setTab] = useState<PromotionListView>(appliedView);
  const createIntent = useCatalogCommand(adminPromotionSummarySchema);
  const pagination = useAdminUrlPagination("/admin/promotions");
  const closeTimer = useRef<number | null>(null);
  const openFrame = useRef<number | null>(null);

  const createDirty =
    benefit !== "ORDER_FIXED_DISCOUNT" ||
    [code, name, discount, minimum, startsAt, endsAt, globalLimit, perCustomerLimit].some(
      (value) => value.trim() !== "",
    );
  const createLocked = createIntent.pending || createIntent.uncertain;

  function resetCreateDraft(): void {
    setCode("");
    setName("");
    setBenefit("ORDER_FIXED_DISCOUNT");
    setDiscount("");
    setMinimum("");
    setStartsAt("");
    setEndsAt("");
    setGlobalLimit("");
    setPerCustomerLimit("");
    setChooserOpen(false);
    setEditorOpen(false);
  }

  useAdminScopeGuard(canManage && createDirty, canManage && createLocked, () => {
    resetCreateDraft();
    setCreateOpen(false);
    setPanelMounted(false);
    setSelectedPromotion(null);
  });
  useAdminRouteGuard(canManage && createDirty, canManage && createLocked);

  function chooseBenefit(type: ManageableBenefitType): void {
    if (type !== benefit) setDiscount("");
    setBenefit(type);
    setChooserOpen(false);
    setEditorOpen(true);
    setNotice(null);
  }

  function discardCreateDraft(): void {
    if (createLocked) return;
    if (createDirty && !window.confirm("Discard this promotion draft?")) return;
    resetCreateDraft();
    setNotice(null);
  }

  useEffect(() => {
    setQuery(appliedQuery);
    setTab(appliedView);
  }, [appliedQuery, appliedView]);

  function updateListFilters(nextQuery: string, nextView: PromotionListView): void {
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
      `/admin/promotions${next.size ? `?${next}` : ""}`,
    );
  }

  function openPanel(promotion: AdminPromotionSummary): void {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setSelectedPromotion(promotion);
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
      setSelectedPromotion(null);
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

  const visiblePromotions = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return (page?.items ?? []).filter((promotion) => {
      const matchesTab =
        tab === "all" ||
        (tab === "active" && promotion.status === "ACTIVE") ||
        (tab === "draft" && promotion.status === "DRAFT");
      if (!matchesTab) return false;
      if (!normalized) return true;
      return [promotion.code, promotion.name, promotion.benefitType]
        .join(" ")
        .toLocaleLowerCase()
        .includes(normalized);
    });
  }, [page?.items, query, tab]);

  function parsePesoMinor(value: string): number | null {
    const trimmed = value.trim();
    if (!trimmed) return 0;
    if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
    const [whole, fraction = ""] = trimmed.split(".");
    const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
    return Number.isSafeInteger(minor) ? minor : null;
  }

  function parsePositiveInt(value: string): number | null {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : null;
  }

  function parseLocalDateTime(value: string): string | null {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const instant = new Date(trimmed);
    return Number.isNaN(instant.getTime()) ? null : instant.toISOString();
  }

  const createSummary = useMemo(() => {
    const option = benefitOption(benefit);
    const amountMinor = parsePesoMinor(discount);
    const minimumMinor = parsePesoMinor(minimum);
    const parsedStart = parseLocalDateTime(startsAt);
    const parsedEnd = parseLocalDateTime(endsAt);
    const percent = Number(discount);
    const validPercent = Number.isInteger(percent) && percent >= 1 && percent <= 100;
    const value =
      benefit === "DELIVERY_FEE_WAIVER"
        ? "Free delivery"
        : benefit.endsWith("PERCENT_DISCOUNT")
          ? discount.trim() && validPercent
            ? `${percent}% off ${benefit.startsWith("ORDER_") ? "the order" : "delivery"}`
            : `Percentage off ${benefit.startsWith("ORDER_") ? "the order" : "delivery"}`
          : amountMinor !== null && amountMinor >= 1 && discount.trim()
            ? `₱${(amountMinor / 100).toFixed(2)} off ${benefit.startsWith("ORDER_") ? "the order" : "delivery"}`
            : `Amount off ${benefit.startsWith("ORDER_") ? "the order" : "delivery"}`;
    const perCustomer = parsePositiveInt(perCustomerLimit);
    const total = parsePositiveInt(globalLimit);
    const invalidLimit =
      (perCustomerLimit.trim() && perCustomer === null) || (globalLimit.trim() && total === null);
    const limits = [
      perCustomer !== null ? `${perCustomer} per customer` : null,
      total !== null ? `${total} total` : null,
    ].filter(Boolean);

    return {
      type: option.label,
      value,
      minimum:
        minimum.trim() && minimumMinor === null
          ? "Enter a valid minimum order subtotal"
          : minimumMinor !== null && minimumMinor > 0
            ? `Minimum order subtotal of ₱${(minimumMinor / 100).toFixed(2)}`
            : "No minimum order subtotal",
      period: `${parsedStart ? `Starts ${new Date(parsedStart).toLocaleDateString()}` : "Starts when saved"}${
        parsedEnd ? ` · Ends ${new Date(parsedEnd).toLocaleDateString()}` : " · No end date"
      }`,
      limits: invalidLimit
        ? "Enter valid whole-number usage limits"
        : limits.length
          ? limits.join(" · ")
          : "No usage limits",
    };
  }, [benefit, discount, endsAt, globalLimit, minimum, perCustomerLimit, startsAt]);

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
              ? "Promotion code administration requires the promotions.read capability with a Global scope."
              : payload.error.message,
          requestId: payload.error.requestId,
        });
        return;
      }
      setPage({
        ...payload.value,
        items: payload.value.items.filter((item) => !item.productTargets?.length),
      });
      setState({ phase: "ready" });
    } catch {
      if (version !== requestVersion.current) return;
      setState({
        phase: "error",
        message: "Network error loading promotion codes.",
        requestId: null,
      });
    }
  }, []);

  useEffect(() => {
    void load(pagination.cursor);
    return () => {
      requestVersion.current += 1;
    };
  }, [load, pagination.cursor]);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (!canManage) return;
    if (code.trim() === "" || name.trim() === "" || Number.isNaN(Number(discount))) {
      setNotice("A code, name, and numeric discount are required.");
      return;
    }
    const [whole, fraction = ""] = discount.trim().split(".");
    const amount = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
    if (
      benefit.endsWith("FIXED_DISCOUNT") &&
      (!/^\d+(\.\d{1,2})?$/.test(discount.trim()) || !Number.isSafeInteger(amount) || amount < 1)
    ) {
      setNotice("Enter a positive discount with at most two decimal places.");
      return;
    }
    if (
      benefit.endsWith("PERCENT_DISCOUNT") &&
      (!Number.isInteger(Number(discount)) || Number(discount) < 1 || Number(discount) > 100)
    ) {
      setNotice("Enter a whole percentage from 1 to 100.");
      return;
    }
    const minimumMinor = parsePesoMinor(minimum);
    if (minimumMinor === null) {
      setNotice("Minimum purchase must be a positive amount with at most two decimal places.");
      return;
    }
    let startInstant: string = new Date().toISOString();
    if (startsAt.trim()) {
      const parsed = parseLocalDateTime(startsAt);
      if (parsed === null) {
        setNotice("Start date could not be read. Use the date picker value.");
        return;
      }
      startInstant = parsed;
    }
    const endInstant = parseLocalDateTime(endsAt);
    if (endsAt.trim() && (endInstant === null || endInstant <= startInstant)) {
      setNotice("End date must be after the start date.");
      return;
    }
    const globalUsageLimit = parsePositiveInt(globalLimit);
    const perCustomerUsageLimit = parsePositiveInt(perCustomerLimit);
    if (globalLimit.trim() && globalUsageLimit === null) {
      setNotice("Total usage limit must be a positive whole number.");
      return;
    }
    if (perCustomerLimit.trim() && perCustomerUsageLimit === null) {
      setNotice("Per-customer limit must be a positive whole number.");
      return;
    }
    try {
      const payload = await createIntent
        .submit("/api/admin/promotions", {
          code: code.trim().toUpperCase(),
          name: name.trim(),
          description: "",
          benefitType: benefit,
          ...(benefit.endsWith("FIXED_DISCOUNT")
            ? { discountMinor: amount }
            : benefit.endsWith("PERCENT_DISCOUNT")
              ? { percent: Number(discount) }
              : {}),
          minimumMinor,
          startsAt: startInstant,
          ...(endInstant ? { endsAt: endInstant } : {}),
          ...(globalUsageLimit !== null ? { globalUsageLimit } : {}),
          ...(perCustomerUsageLimit !== null ? { perCustomerUsageLimit } : {}),
        })
        .catch(() => createIntent.retry());
      if (!payload) return;
      setNotice(payload.ok ? "Promotion created as DRAFT." : payload.error.message);
      if (payload.ok) {
        notifyCommandSuccess("Promotion created", "Saved as draft.");
        resetCreateDraft();
        const next = new URLSearchParams(searchParams.toString());
        pagination.reset(next);
        window.history.replaceState(
          window.history.state,
          "",
          `/admin/promotions${next.size ? `?${next}` : ""}`,
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
                    Select promotion type
                  </DialogPrimitive.Title>
                  <DialogPrimitive.Description className="mt-1 text-sm text-[var(--fm-text-muted)]">
                    Choose one of the promotion benefits FreshMarkets supports.
                  </DialogPrimitive.Description>
                </div>
                <DialogPrimitive.Close asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Close promotion type chooser"
                  >
                    <X aria-hidden="true" />
                  </Button>
                </DialogPrimitive.Close>
              </div>
              <div className="divide-y divide-[var(--fm-border)] p-2">
                {benefitOptions.map((option) => {
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
          <PageHeader title="Promotion Codes" />
          <AdminPageState state="loading" title="Loading promotion codes" />
        </section>
      ) : null}

      {state.phase === "error" ? (
        <section className="space-y-6 p-5 sm:p-7" aria-labelledby="admin-page-title">
          <PageHeader title="Promotion Codes" />
          <AdminPageState
            state="error"
            title="Promotion Codes could not be loaded"
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
                  aria-label="Discard promotion and return to promotion codes"
                  onClick={discardCreateDraft}
                  disabled={createLocked}
                >
                  <ArrowLeft aria-hidden="true" />
                </Button>
                <div className="min-w-0">
                  <p className="text-xs font-medium text-[var(--fm-text-muted)]">Promotion Codes</p>
                  <h1
                    id="admin-page-title"
                    className="truncate text-xl font-bold tracking-[-0.03em]"
                  >
                    Create promo code
                  </h1>
                </div>
              </div>
              <p className="hidden text-sm text-[var(--fm-text-muted)] sm:block">
                Saved promotions begin as drafts.
              </p>
            </div>
          </header>

          <div className="mx-auto grid w-full max-w-6xl gap-5 p-5 sm:p-7 lg:grid-cols-[minmax(0,1.65fr)_minmax(18rem,0.8fr)] lg:items-start">
            <div className="space-y-5">
              <section
                className="rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-[var(--fm-admin-surface)] p-5 shadow-[var(--fm-shadow-card)]"
                aria-labelledby="promotion-details-heading"
              >
                <h2 id="promotion-details-heading" className="text-base font-semibold">
                  Promotion details
                </h2>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <label className="block text-sm font-semibold">
                    Promo code<span className="text-red-600"> *</span>
                    <Input
                      aria-label="Promotion code"
                      disabled={createLocked}
                      placeholder="WELCOME10"
                      value={code}
                      onChange={(event) => setCode(event.target.value.toUpperCase())}
                      className="mt-1.5 h-10"
                    />
                  </label>
                  <label className="block text-sm font-semibold">
                    Campaign name<span className="text-red-600"> *</span>
                    <Input
                      aria-label="Promotion name"
                      disabled={createLocked}
                      placeholder="Welcome to FreshMarkets"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      className="mt-1.5 h-10"
                    />
                  </label>
                </div>
              </section>

              <section
                className="rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-[var(--fm-admin-surface)] p-5 shadow-[var(--fm-shadow-card)]"
                aria-labelledby="promotion-benefit-heading"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 id="promotion-benefit-heading" className="text-base font-semibold">
                      Benefit
                    </h2>
                    <p className="mt-1 text-sm text-[var(--fm-text-muted)]">
                      {benefitOption(benefit).label}
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
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  {benefit !== "DELIVERY_FEE_WAIVER" ? (
                    <label className="block text-sm font-semibold">
                      {benefit.endsWith("PERCENT_DISCOUNT")
                        ? "Discount percentage"
                        : "Discount amount"}
                      <span className="text-red-600"> *</span>
                      <div className="relative mt-1.5">
                        {benefit.endsWith("FIXED_DISCOUNT") ? (
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[var(--fm-text-muted)]">
                            ₱
                          </span>
                        ) : null}
                        <Input
                          aria-label={
                            benefit.endsWith("PERCENT_DISCOUNT")
                              ? "Discount percentage"
                              : "Fixed discount in pesos"
                          }
                          disabled={createLocked}
                          placeholder={benefit.endsWith("PERCENT_DISCOUNT") ? "10" : "100.00"}
                          inputMode="decimal"
                          value={discount}
                          onChange={(event) => setDiscount(event.target.value)}
                          className={`h-10 ${benefit.endsWith("PERCENT_DISCOUNT") ? "pr-10" : "pl-8"}`}
                        />
                        {benefit.endsWith("PERCENT_DISCOUNT") ? (
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-[var(--fm-text-muted)]">
                            %
                          </span>
                        ) : null}
                      </div>
                    </label>
                  ) : (
                    <div className="rounded-lg border border-[var(--fm-border)] bg-[var(--fm-admin-surface-muted)] p-3 text-sm">
                      The eligible delivery fee is waived.
                    </div>
                  )}
                  <label className="block text-sm font-semibold">
                    Minimum order subtotal
                    <div className="relative mt-1.5">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[var(--fm-text-muted)]">
                        ₱
                      </span>
                      <Input
                        aria-label="Minimum purchase in pesos"
                        disabled={createLocked}
                        placeholder="No minimum"
                        inputMode="decimal"
                        value={minimum}
                        onChange={(event) => setMinimum(event.target.value)}
                        className="h-10 pl-8"
                      />
                    </div>
                  </label>
                </div>
                <p className="mt-4 text-sm text-[var(--fm-text-muted)]">
                  {benefit.startsWith("ORDER_")
                    ? "Applies to eligible full-price merchandise in the order."
                    : "Applies to the eligible delivery fee."}
                </p>
              </section>

              <section
                className="rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-[var(--fm-admin-surface)] p-5 shadow-[var(--fm-shadow-card)]"
                aria-labelledby="promotion-dates-heading"
              >
                <h2 id="promotion-dates-heading" className="text-base font-semibold">
                  Active dates
                </h2>
                <p className="mt-1 text-sm text-[var(--fm-text-muted)]">
                  Leave the start blank to begin when the draft is saved. Leave the end blank for no
                  end date.
                </p>
                <fieldset disabled={createLocked} className="mt-4 grid gap-4 sm:grid-cols-2">
                  <label className="text-sm font-semibold">
                    Start date
                    <Input
                      aria-label="Start date"
                      type="date"
                      title="Start date (empty = now)"
                      value={startsAt}
                      max={endsAt || undefined}
                      onChange={(event) => setStartsAt(event.target.value)}
                      className="mt-1.5 h-10"
                    />
                  </label>
                  <label className="text-sm font-semibold">
                    End date
                    <Input
                      aria-label="End date"
                      type="date"
                      title="End date (empty = no end)"
                      value={endsAt}
                      min={startsAt || undefined}
                      onChange={(event) => setEndsAt(event.target.value)}
                      className="mt-1.5 h-10"
                    />
                  </label>
                </fieldset>
              </section>

              <section
                className="rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-[var(--fm-admin-surface)] p-5 shadow-[var(--fm-shadow-card)]"
                aria-labelledby="promotion-limits-heading"
              >
                <h2 id="promotion-limits-heading" className="text-base font-semibold">
                  Usage limits
                </h2>
                <p className="mt-1 text-sm text-[var(--fm-text-muted)]">
                  Leave either value blank when that limit does not apply.
                </p>
                <fieldset disabled={createLocked} className="mt-4 grid gap-4 sm:grid-cols-2">
                  <label className="block text-sm font-semibold">
                    Maximum total uses
                    <Input
                      aria-label="Total usage limit"
                      placeholder="No limit"
                      inputMode="numeric"
                      value={globalLimit}
                      onChange={(event) => setGlobalLimit(event.target.value)}
                      className="mt-1.5 h-10 font-normal"
                    />
                  </label>
                  <label className="block text-sm font-semibold">
                    Maximum uses per customer
                    <Input
                      aria-label="Per-customer usage limit"
                      placeholder="No limit"
                      inputMode="numeric"
                      value={perCustomerLimit}
                      onChange={(event) => setPerCustomerLimit(event.target.value)}
                      className="mt-1.5 h-10 font-normal"
                    />
                  </label>
                </fieldset>
              </section>
            </div>

            <aside
              className="space-y-4 lg:sticky lg:top-5"
              aria-labelledby="promotion-summary-heading"
            >
              <section className="rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-[var(--fm-admin-surface)] p-5 shadow-[var(--fm-shadow-card)]">
                <h2 id="promotion-summary-heading" className="text-base font-semibold">
                  Summary
                </h2>
                <p className="mt-1 break-all text-sm text-[var(--fm-text-muted)]">
                  {code.trim() ? code.trim().toUpperCase() : "Promotion code not entered"}
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
                    <dt className="text-xs font-medium text-[var(--fm-text-muted)]">Requirement</dt>
                    <dd className="mt-1">{createSummary.minimum}</dd>
                  </div>
                  <div className="py-3">
                    <dt className="text-xs font-medium text-[var(--fm-text-muted)]">
                      Active dates
                    </dt>
                    <dd className="mt-1">{createSummary.period}</dd>
                  </div>
                  <div className="py-3 last:pb-0">
                    <dt className="text-xs font-medium text-[var(--fm-text-muted)]">Usage</dt>
                    <dd className="mt-1">{createSummary.limits}</dd>
                  </div>
                </dl>
              </section>
              <p className="flex gap-2 px-1 text-xs leading-5 text-[var(--fm-text-muted)]">
                <Info
                  className="mt-0.5 size-3.5 shrink-0 text-[var(--fm-info)]"
                  aria-hidden="true"
                />
                Promotion Sale discounts are applied automatically. This code remains a separate
                checkout benefit.
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
                    : "Complete the promotion details to save a draft."}
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
        <div
          data-admin-workspace
          style={{ "--fm-admin-workspace-panel-open-width": `${panelWidth}px` } as CSSProperties}
          className={`grid min-h-[calc(100svh-3.5rem)] md:min-h-[calc(100svh-4.5rem)] xl:[grid-template-columns:minmax(0,1fr)_var(--fm-admin-workspace-panel-width)] motion-reduce:transition-none ${panelResizing ? "xl:transition-none" : "xl:transition-[grid-template-columns] xl:duration-200 xl:ease-linear"} ${createOpen ? "xl:[--fm-admin-workspace-panel-width:var(--fm-admin-workspace-panel-open-width)]" : "xl:[--fm-admin-workspace-panel-width:0px]"}`}
        >
          <section className="flex min-w-0 flex-col p-5 sm:p-7" aria-labelledby="admin-page-title">
            <PageHeader
              title="Promotion Codes"
              description="Discount codes customers enter at checkout."
              action={
                canManage ? (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => setChooserOpen(true)}
                    className="fm-admin-reference-primary"
                  >
                    <Plus className="size-4" aria-hidden="true" />
                    Create promo code
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
              <h2 className="sr-only">Promotion code list</h2>
              <AdminIndexViews
                label="Promotion code views"
                views={[
                  { label: "All codes", status: "all" },
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
                  Showing {visiblePromotions.length} of {page?.items.length ?? 0} promotion codes on
                  this page. Search and status filter this page only.
                </p>
                <label className="relative block sm:w-72">
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--fm-text-muted)]"
                    aria-hidden="true"
                  />
                  <Input
                    aria-label="Search promo codes on this page"
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
                {visiblePromotions.length === 0 ? (
                  <p className="p-6 text-sm text-[var(--fm-text-muted)]" role="status">
                    No promotion codes match this view on the current page. Other promotion codes
                    may appear on later pages.
                  </p>
                ) : (
                  <Table aria-label="Promotion code list">
                    <TableHeader>
                      <TableRow className="bg-[var(--fm-admin-surface-muted)] hover:bg-[var(--fm-admin-surface-muted)]">
                        <TableHead>Code</TableHead>
                        <TableHead>Campaign name</TableHead>
                        <TableHead>Benefit</TableHead>
                        <TableHead>Minimum subtotal</TableHead>
                        <TableHead>Period</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>
                          <span className="sr-only">Manage</span>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visiblePromotions.map((promotion) => {
                        const detailsOpen =
                          createOpen && selectedPromotion?.promotionId === promotion.promotionId;
                        const toggleDetails = () =>
                          detailsOpen ? closePanel() : openPanel(promotion);

                        return (
                          <TableRow
                            key={promotion.promotionId}
                            className="cursor-pointer align-top transition-colors hover:bg-[var(--fm-hover)] focus-visible:bg-[var(--fm-hover)]"
                            tabIndex={0}
                            aria-expanded={detailsOpen}
                            onClick={toggleDetails}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                toggleDetails();
                              }
                            }}
                          >
                            <TableCell className="whitespace-nowrap font-semibold text-[var(--fm-text)]">
                              {promotion.code}
                            </TableCell>
                            <TableCell className="min-w-32 max-w-48 text-[var(--fm-text)]">
                              {promotion.name}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-sm text-[var(--fm-text-muted)]">
                              {promotion.benefitType.endsWith("PERCENT_DISCOUNT")
                                ? `${promotion.percent}% off`
                                : promotion.benefitType === "DELIVERY_FEE_WAIVER"
                                  ? "Free delivery"
                                  : `₱${((promotion.discountMinor ?? 0) / 100).toFixed(2)} off`}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-sm text-[var(--fm-text-muted)]">
                              {promotion.minimumMinor > 0
                                ? `₱${(promotion.minimumMinor / 100).toFixed(2)}`
                                : "None"}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-sm text-[var(--fm-text-muted)]">
                              <span>{new Date(promotion.startsAt).toLocaleDateString()}</span>
                              <span className="block">
                                {promotion.endsAt
                                  ? new Date(promotion.endsAt).toLocaleDateString()
                                  : "No end date"}
                              </span>
                            </TableCell>
                            <TableCell
                              onClick={(event) => event.stopPropagation()}
                              onKeyDown={(event) => event.stopPropagation()}
                            >
                              {canManage ? (
                                <PromotionStatusSwitch
                                  promotion={promotion}
                                  onApplied={(summary) =>
                                    setPage((current) =>
                                      current && !summary.productTargets?.length
                                        ? {
                                            ...current,
                                            items: current.items.map((item) =>
                                              item.promotionId === summary.promotionId
                                                ? summary
                                                : item,
                                            ),
                                          }
                                        : current,
                                    )
                                  }
                                />
                              ) : (
                                <StatusBadge
                                  tone={promotion.status === "ACTIVE" ? "success" : "neutral"}
                                >
                                  {promotion.status === "ACTIVE" ? "Active" : promotion.status}
                                </StatusBadge>
                              )}
                            </TableCell>
                            <TableCell
                              onClick={(event) => event.stopPropagation()}
                              onKeyDown={(event) => event.stopPropagation()}
                            >
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label={`Open actions for ${promotion.code}`}
                                    className="size-8 rounded-md"
                                  >
                                    <EllipsisVertical aria-hidden="true" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem asChild>
                                    <Link
                                      href={`/admin/promotions/${promotion.promotionId}`}
                                      prefetch={false}
                                    >
                                      <Eye aria-hidden="true" />
                                      View details
                                    </Link>
                                  </DropdownMenuItem>
                                  {canManage ? (
                                    <DropdownMenuItem asChild>
                                      <Link
                                        href={`/admin/promotions/${promotion.promotionId}`}
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
                        );
                      })}
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

          {panelMounted && selectedPromotion ? (
            <aside
              id="promotion-side-panel"
              className={`fixed inset-0 z-50 flex h-svh min-h-0 overflow-hidden xl:sticky xl:inset-auto xl:top-0 xl:z-auto xl:h-[calc(100svh-4.5rem)] ${createOpen ? "" : "pointer-events-none"}`}
              aria-labelledby="create-promo-title"
            >
              <div
                className={`ml-auto flex h-full min-h-0 w-full flex-col bg-[var(--fm-admin-surface)] transition-[transform,opacity] [transition-duration:var(--fm-motion-panel)] [transition-timing-function:var(--fm-ease-drawer)] will-change-[transform,opacity] motion-reduce:transform-none motion-reduce:transition-[opacity] motion-reduce:[transition-duration:var(--fm-motion-fast)] motion-reduce:[transition-timing-function:var(--fm-ease-out)] xl:absolute xl:inset-y-0 xl:right-0 xl:w-[var(--fm-admin-workspace-panel-open-width)] xl:border-l xl:border-[var(--fm-border)] ${createOpen ? "translate-x-0 opacity-100" : "translate-x-full opacity-0 xl:translate-x-0"}`}
              >
                <AdminWorkspaceResizeHandle
                  label="Resize promotion workspace"
                  width={panelWidth}
                  onWidthChange={setPanelWidth}
                  onResizeStateChange={setPanelResizing}
                />
                <div className="flex items-center justify-between border-b border-[var(--fm-border)] px-5 py-5">
                  <h2 id="create-promo-title" className="text-xl font-bold tracking-[-0.03em]">
                    Promotion details
                  </h2>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={closePanel}
                    disabled={createIntent.pending}
                    aria-label="Close promotion details"
                  >
                    <X aria-hidden="true" />
                  </Button>
                </div>
                <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-[var(--fm-text-muted)]">
                      Promo code
                    </p>
                    <p className="mt-1 text-lg font-semibold">{selectedPromotion.code}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-[var(--fm-text-muted)]">
                      Campaign name
                    </p>
                    <p className="mt-1 text-sm font-medium">{selectedPromotion.name}</p>
                  </div>
                  <dl className="divide-y divide-[var(--fm-border)] rounded-lg border border-[var(--fm-border)]">
                    <div className="flex items-center justify-between gap-4 px-3 py-3 text-sm">
                      <dt className="text-[var(--fm-text-muted)]">Status</dt>
                      <dd className="font-medium">{selectedPromotion.status}</dd>
                    </div>
                    <div className="flex items-start justify-between gap-4 px-3 py-3 text-sm">
                      <dt className="text-[var(--fm-text-muted)]">Promotion ID</dt>
                      <dd className="max-w-48 break-all text-right font-mono text-xs font-medium">
                        {selectedPromotion.promotionId}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-4 px-3 py-3 text-sm">
                      <dt className="text-[var(--fm-text-muted)]">Benefit</dt>
                      <dd className="text-right font-medium">
                        {selectedPromotion.benefitType.endsWith("PERCENT_DISCOUNT")
                          ? `${selectedPromotion.percent}% off`
                          : selectedPromotion.benefitType === "DELIVERY_FEE_WAIVER"
                            ? "Free delivery"
                            : `₱${((selectedPromotion.discountMinor ?? 0) / 100).toFixed(2)} off`}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-4 px-3 py-3 text-sm">
                      <dt className="text-[var(--fm-text-muted)]">Minimum subtotal</dt>
                      <dd className="font-medium">
                        {selectedPromotion.minimumMinor > 0
                          ? `₱${(selectedPromotion.minimumMinor / 100).toFixed(2)}`
                          : "None"}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-4 px-3 py-3 text-sm">
                      <dt className="text-[var(--fm-text-muted)]">Valid period</dt>
                      <dd className="text-right font-medium">
                        {new Date(selectedPromotion.startsAt).toLocaleDateString()}
                        <br />
                        {selectedPromotion.endsAt
                          ? new Date(selectedPromotion.endsAt).toLocaleDateString()
                          : "No end date"}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-4 px-3 py-3 text-sm">
                      <dt className="text-[var(--fm-text-muted)]">Usage limits</dt>
                      <dd className="text-right font-medium">
                        {selectedPromotion.globalUsageLimit === null &&
                        selectedPromotion.perCustomerUsageLimit === null
                          ? "Unlimited"
                          : [
                              selectedPromotion.perCustomerUsageLimit !== null
                                ? `${selectedPromotion.perCustomerUsageLimit}/customer`
                                : null,
                              selectedPromotion.globalUsageLimit !== null
                                ? `${selectedPromotion.globalUsageLimit} total`
                                : null,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                      </dd>
                    </div>
                  </dl>
                  <Link
                    href={`/admin/promotions/${selectedPromotion.promotionId}`}
                    prefetch={false}
                    className="inline-flex text-sm font-semibold text-[var(--fm-info)] underline underline-offset-4"
                  >
                    Open full promotion details
                  </Link>
                </div>
                <div className="flex shrink-0 justify-end gap-2 border-t border-[var(--fm-border)] bg-[var(--fm-admin-surface)] px-5 py-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={closePanel}
                    disabled={createIntent.pending}
                  >
                    Close
                  </Button>
                </div>
              </div>
            </aside>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
