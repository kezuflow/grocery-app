"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { EllipsisVertical, Eye, Info, Pencil, Percent, Plus, Search, X } from "lucide-react";
import {
  manageableBenefitTypes,
  type ManageableBenefitType,
  type AdminPromotionPage,
  type AdminPromotionSummary,
} from "@freshmarkets/contracts";
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
import { adminPromotionSummarySchema, adminPromotionPageSchema } from "@freshmarkets/validation";
import {
  AdminCursorPagination,
  useAdminPagination,
} from "../../../components/admin/admin-controls";
import {
  ADMIN_WORKSPACE_PANEL_DEFAULT_WIDTH,
  AdminWorkspaceResizeHandle,
} from "../../../components/admin/admin-workspace-resize-handle";

type LoadState =
  | { phase: "loading" }
  | { phase: "error"; message: string; requestId: string | null }
  | { phase: "ready" };

export default function PromotionsPage() {
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
  const [createOpen, setCreateOpen] = useState(false);
  const [panelMounted, setPanelMounted] = useState(false);
  const [panelWidth, setPanelWidth] = useState(ADMIN_WORKSPACE_PANEL_DEFAULT_WIDTH);
  const [panelResizing, setPanelResizing] = useState(false);
  const [selectedPromotion, setSelectedPromotion] = useState<AdminPromotionSummary | null>(null);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"all" | "active" | "draft">("all");
  const createIntent = useCatalogCommand(adminPromotionSummarySchema);
  const pagination = useAdminPagination();
  const closeTimer = useRef<number | null>(null);
  const openFrame = useRef<number | null>(null);

  function openPanel(promotion: AdminPromotionSummary | null = null): void {
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
                ? "Promotion administration requires the promotions.read capability with a global scope."
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
        setState({ phase: "error", message: "Network error loading promotions.", requestId: null });
      }
    })();
  }, []);

  useEffect(() => load(pagination.cursor), [load, pagination.cursor]);

  async function create(event: React.FormEvent) {
    event.preventDefault();
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
        setCode("");
        setName("");
        setDiscount("");
        setMinimum("");
        setEndsAt("");
        setGlobalLimit("");
        setPerCustomerLimit("");
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
        <div className="space-y-3 p-5 sm:p-7" role="status" aria-label="Loading promotions">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-72 w-full" />
        </div>
      ) : null}

      {state.phase === "error" ? (
        <Alert variant="destructive" className="m-5 w-auto sm:m-7">
          <AlertTitle>Promotions could not be loaded</AlertTitle>
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
                  Promo codes
                </h1>
                <p className="mt-1 text-sm text-[var(--fm-text-muted)]">
                  Create and manage promo codes for your store.
                </p>
              </div>
              <Button
                type="button"
                aria-expanded={createOpen}
                aria-controls="promotion-side-panel"
                onClick={() => (createOpen ? closePanel() : openPanel())}
                className="h-10 shrink-0 rounded-lg bg-[var(--fm-admin-accent)] px-4 font-semibold text-white shadow-sm hover:bg-[var(--fm-admin-accent-strong)] active:scale-[0.98]"
              >
                <Plus className="size-4" aria-hidden="true" />
                Create promo code
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
              <div className="flex items-center gap-6" role="tablist" aria-label="Promotion status">
                {(
                  [
                    ["all", "All codes", page?.items.length ?? 0],
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
                  aria-label="Search promo codes"
                  placeholder="Search promo codes…"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className="h-10 bg-[var(--fm-admin-surface)] pl-9 shadow-none"
                />
              </label>
            </div>

            <div className="mt-4 overflow-x-auto rounded-lg border border-[var(--fm-border)]">
              {visiblePromotions.length === 0 ? (
                <p className="p-6 text-sm text-[var(--fm-text-muted)]" role="status">
                  No promotions match this view.
                </p>
              ) : (
                <Table>
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
                            <PromotionStatusSwitch
                              promotion={promotion}
                              onApplied={(summary) =>
                                setPage((current) =>
                                  current && !summary.productTargets?.length
                                    ? {
                                        ...current,
                                        items: current.items.map((item) =>
                                          item.promotionId === summary.promotionId ? summary : item,
                                        ),
                                      }
                                    : current,
                                )
                              }
                            />
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
                                <DropdownMenuItem asChild>
                                  <Link
                                    href={`/admin/promotions/${promotion.promotionId}`}
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
                      );
                    })}
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
              id="promotion-side-panel"
              className={`fixed inset-0 z-50 flex h-svh min-h-0 overflow-hidden xl:sticky xl:inset-auto xl:top-0 xl:z-auto xl:h-[calc(100svh-4.5rem)] ${createOpen ? "" : "pointer-events-none"}`}
              aria-labelledby="create-promo-title"
            >
              <form
                className={`ml-auto flex h-full min-h-0 w-full flex-col bg-[var(--fm-admin-surface)] transition-[transform,opacity] [transition-duration:var(--fm-motion-panel)] [transition-timing-function:var(--fm-ease-drawer)] will-change-[transform,opacity] motion-reduce:transform-none motion-reduce:transition-[opacity] motion-reduce:[transition-duration:var(--fm-motion-fast)] motion-reduce:[transition-timing-function:var(--fm-ease-out)] xl:absolute xl:inset-y-0 xl:right-0 xl:w-[var(--fm-admin-workspace-panel-open-width)] xl:border-l xl:border-[var(--fm-border)] ${createOpen ? "translate-x-0 opacity-100" : "translate-x-full opacity-0 xl:translate-x-0"}`}
                onSubmit={create}
              >
                <AdminWorkspaceResizeHandle
                  label="Resize promotion workspace"
                  width={panelWidth}
                  onWidthChange={setPanelWidth}
                  onResizeStateChange={setPanelResizing}
                />
                <div className="flex items-center justify-between border-b border-[var(--fm-border)] px-5 py-5">
                  <h2 id="create-promo-title" className="text-xl font-bold tracking-[-0.03em]">
                    {selectedPromotion ? "Promotion details" : "Create promo code"}
                  </h2>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={closePanel}
                    disabled={createIntent.pending}
                    aria-label={
                      selectedPromotion ? "Close promotion details" : "Close create promo code"
                    }
                  >
                    <X aria-hidden="true" />
                  </Button>
                </div>
                {selectedPromotion ? (
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
                ) : (
                  <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
                    <div className="grid grid-cols-2 gap-3">
                      <label className="block text-sm font-semibold">
                        Promo code<span className="text-red-600"> *</span>
                        <Input
                          aria-label="Promotion code"
                          disabled={createIntent.pending || createIntent.uncertain}
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
                          disabled={createIntent.pending || createIntent.uncertain}
                          placeholder="Welcome to FreshMarkets"
                          value={name}
                          onChange={(event) => setName(event.target.value)}
                          className="mt-1.5 h-10"
                        />
                      </label>
                    </div>
                    <fieldset
                      disabled={createIntent.pending || createIntent.uncertain}
                      className="space-y-2"
                    >
                      <legend className="text-sm font-semibold">Benefit</legend>
                      <div className="grid grid-cols-2 gap-1 rounded-lg border border-[var(--fm-border)] p-1">
                        <button
                          type="button"
                          onClick={() => setBenefit("ORDER_PERCENT_DISCOUNT")}
                          className={`flex min-h-9 items-center justify-center gap-2 rounded-md px-2 text-xs font-semibold transition-colors ${benefit === "ORDER_PERCENT_DISCOUNT" ? "bg-[var(--fm-admin-accent)] text-white" : "text-[var(--fm-text-muted)] hover:bg-[var(--fm-hover)]"}`}
                        >
                          <Percent className="size-3.5" aria-hidden="true" />
                          Percentage off
                        </button>
                        <button
                          type="button"
                          onClick={() => setBenefit("ORDER_FIXED_DISCOUNT")}
                          className={`flex min-h-9 items-center justify-center gap-2 rounded-md px-2 text-xs font-semibold transition-colors ${benefit === "ORDER_FIXED_DISCOUNT" ? "bg-[var(--fm-admin-accent)] text-white" : "text-[var(--fm-text-muted)] hover:bg-[var(--fm-hover)]"}`}
                        >
                          ₱ Fixed amount off
                        </button>
                      </div>
                      <Select
                        value={benefit}
                        onValueChange={(value) => {
                          const choice = manageableBenefitTypes.find((type) => type === value);
                          if (choice) setBenefit(choice);
                        }}
                      >
                        <SelectTrigger className="sr-only" aria-label="Campaign benefit">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {manageableBenefitTypes.map((type) => (
                            <SelectItem key={type} value={type}>
                              {type}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </fieldset>
                    <div className="grid grid-cols-2 gap-3">
                      {benefit !== "DELIVERY_FEE_WAIVER" ? (
                        <label className="block text-sm font-semibold">
                          {benefit.endsWith("PERCENT_DISCOUNT")
                            ? "Discount percentage"
                            : "Discount amount"}
                          <span className="text-red-600"> *</span>
                          <div className="relative mt-1.5">
                            <Input
                              aria-label={
                                benefit.endsWith("PERCENT_DISCOUNT")
                                  ? "Discount percentage"
                                  : "Fixed discount in pesos"
                              }
                              disabled={createIntent.pending || createIntent.uncertain}
                              placeholder={benefit.endsWith("PERCENT_DISCOUNT") ? "10" : "100"}
                              value={discount}
                              onChange={(event) => setDiscount(event.target.value)}
                              className="h-10 pr-10"
                            />
                            {benefit.endsWith("PERCENT_DISCOUNT") ? (
                              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-[var(--fm-text-muted)]">
                                %
                              </span>
                            ) : null}
                          </div>
                        </label>
                      ) : (
                        <span />
                      )}
                      <label className="block text-sm font-semibold">
                        Minimum order subtotal
                        <div className="relative mt-1.5">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[var(--fm-text-muted)]">
                            ₱
                          </span>
                          <Input
                            aria-label="Minimum purchase in pesos"
                            disabled={createIntent.pending || createIntent.uncertain}
                            placeholder="500"
                            inputMode="decimal"
                            value={minimum}
                            onChange={(event) => setMinimum(event.target.value)}
                            className="h-10 pl-8"
                          />
                        </div>
                      </label>
                    </div>
                    <fieldset className="space-y-2">
                      <legend className="text-sm font-semibold">Eligibility</legend>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="flex items-center gap-2 text-sm">
                          <span
                            className="flex size-4 shrink-0 items-center justify-center rounded-full border-2 border-[var(--fm-admin-accent)]"
                            aria-hidden="true"
                          >
                            <span className="size-2 rounded-full bg-[var(--fm-admin-accent)]" />
                          </span>
                          <span className="font-medium">All products</span>
                        </div>
                        <div className="flex items-center gap-2 text-sm opacity-60">
                          <span
                            className="flex size-4 shrink-0 rounded-full border-2 border-[var(--fm-border)]"
                            aria-hidden="true"
                          />
                          <span className="font-medium">Selected products</span>
                        </div>
                      </div>
                    </fieldset>
                    <fieldset
                      disabled={createIntent.pending || createIntent.uncertain}
                      className="space-y-2"
                    >
                      <legend className="text-sm font-semibold">Validity period</legend>
                      <div className="grid grid-cols-2 gap-3">
                        <label className="text-xs font-semibold">
                          Start date
                          <Input
                            aria-label="Start date"
                            type="date"
                            title="Start date (empty = today)"
                            value={startsAt}
                            max={endsAt || undefined}
                            onChange={(event) => setStartsAt(event.target.value)}
                            className="mt-1.5 h-10 text-xs"
                          />
                        </label>
                        <label className="text-xs font-semibold">
                          End date
                          <Input
                            aria-label="End date"
                            type="date"
                            title="End date (empty = no end)"
                            value={endsAt}
                            min={startsAt || undefined}
                            onChange={(event) => setEndsAt(event.target.value)}
                            className="mt-1.5 h-10 text-xs"
                          />
                        </label>
                      </div>
                    </fieldset>
                    <fieldset
                      disabled={createIntent.pending || createIntent.uncertain}
                      className="space-y-2"
                    >
                      <legend className="text-sm font-semibold">
                        Usage limits{" "}
                        <span className="font-normal text-[var(--fm-text-muted)]">(optional)</span>
                      </legend>
                      <span className="block text-xs text-[var(--fm-text-muted)]">
                        Leave blank for no limits.
                      </span>
                      <div className="grid grid-cols-2 gap-3">
                        <label className="block text-xs font-semibold">
                          Maximum total uses
                          <Input
                            aria-label="Total usage limit"
                            placeholder="No limit"
                            inputMode="numeric"
                            value={globalLimit}
                            onChange={(event) => setGlobalLimit(event.target.value)}
                            className="mt-1.5 h-10 text-sm font-normal"
                          />
                        </label>
                        <label className="block text-xs font-semibold">
                          Maximum uses per customer
                          <Input
                            aria-label="Per-customer usage limit"
                            placeholder="No limit"
                            inputMode="numeric"
                            value={perCustomerLimit}
                            onChange={(event) => setPerCustomerLimit(event.target.value)}
                            className="mt-1.5 h-10 text-sm font-normal"
                          />
                        </label>
                      </div>
                    </fieldset>
                    <p className="flex gap-2 text-xs text-[var(--fm-text-muted)]">
                      <Info className="mt-0.5 size-3.5 shrink-0 text-blue-500" aria-hidden="true" />
                      Discounts from Inventory sales are applied automatically and can be combined
                      with this promo code.
                    </p>
                  </div>
                )}
                <div className="flex shrink-0 justify-end gap-2 border-t border-[var(--fm-border)] bg-[var(--fm-admin-surface)] px-5 py-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={closePanel}
                    disabled={createIntent.pending}
                  >
                    {selectedPromotion ? "Close" : "Cancel"}
                  </Button>
                  {!selectedPromotion ? (
                    <Button
                      type="submit"
                      disabled={createIntent.pending}
                      className="bg-[var(--fm-admin-accent)] text-white hover:bg-[var(--fm-admin-accent-strong)]"
                    >
                      {createIntent.pending ? "Creating…" : "Create draft"}
                    </Button>
                  ) : null}
                </div>
              </form>
            </aside>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
