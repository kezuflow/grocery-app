"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  manageableBenefitTypes,
  type ManageableBenefitType,
  type AdminPromotionPage,
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../components/ui/table";
import { PageHeader, ListPageSection } from "../../../components/admin/admin-shell";
import { PromotionStatusSwitch } from "../../../components/admin/promotion-status-switch";
import { useCatalogCommand, catalogResultSchema } from "@/components/admin/catalog-command-state";
import { adminPromotionSummarySchema, adminPromotionPageSchema } from "@freshmarkets/validation";
import {
  AdminCursorPagination,
  useAdminPagination,
} from "../../../components/admin/admin-controls";

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
  const createIntent = useCatalogCommand(adminPromotionSummarySchema);
  const pagination = useAdminPagination();

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
        setNotice("Start date could not be read. Use the date-time picker value.");
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
    <div className="mx-auto max-w-[1280px] space-y-6">
      <PageHeader
        title="Promotions"
        description="Create and manage promo codes customers enter at checkout. Product sales live in Inventory sales."
      />

      {state.phase === "loading" ? (
        <div className="space-y-3" role="status" aria-label="Loading promotions">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : null}

      {state.phase === "error" ? (
        <Alert variant="destructive">
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
        <>
          {notice ? (
            <p
              role="status"
              className="rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-[var(--fm-admin-surface)] p-3 text-sm"
            >
              {notice}
            </p>
          ) : null}

          <ListPageSection
            title="Create a promotion"
            description="Created as DRAFT; activate when ready."
          >
            <form className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3" onSubmit={create}>
              <Input
                aria-label="Promotion code"
                disabled={createIntent.pending || createIntent.uncertain}
                placeholder="CODE"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                className="sm:w-44"
              />
              <Input
                aria-label="Promotion name"
                disabled={createIntent.pending || createIntent.uncertain}
                placeholder="name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="sm:w-56"
              />
              <Select
                value={benefit}
                disabled={createIntent.pending || createIntent.uncertain}
                onValueChange={(value) => {
                  const choice = manageableBenefitTypes.find((type) => type === value);
                  if (choice) setBenefit(choice);
                }}
              >
                <SelectTrigger aria-label="Campaign benefit">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {manageableBenefitTypes.map((type) => (
                    <SelectItem key={type} value={type}>
                      {
                        {
                          ORDER_FIXED_DISCOUNT: "Merchandise amount off",
                          ORDER_PERCENT_DISCOUNT: "Merchandise percentage off",
                          DELIVERY_FEE_WAIVER: "Free delivery",
                          DELIVERY_PERCENT_DISCOUNT: "Delivery percentage off",
                          DELIVERY_FIXED_DISCOUNT: "Delivery amount off",
                        }[type]
                      }
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {benefit !== "DELIVERY_FEE_WAIVER" ? (
                <Input
                  aria-label={
                    benefit.endsWith("PERCENT_DISCOUNT")
                      ? "Discount percentage"
                      : "Fixed discount in pesos"
                  }
                  disabled={createIntent.pending || createIntent.uncertain}
                  placeholder={benefit.endsWith("PERCENT_DISCOUNT") ? "percentage" : "discount PHP"}
                  value={discount}
                  onChange={(event) => setDiscount(event.target.value)}
                />
              ) : null}
              <Button type="submit" size="sm" disabled={createIntent.pending}>
                {createIntent.pending ? "Creating…" : "Create draft"}
              </Button>
              <fieldset
                disabled={createIntent.pending || createIntent.uncertain}
                className="grid gap-3 rounded-lg border p-3 sm:col-span-2 lg:col-span-3 sm:grid-cols-2 lg:grid-cols-5"
              >
                <legend className="px-1 text-sm font-semibold">Rules (optional)</legend>
                <Input
                  aria-label="Minimum purchase in pesos"
                  placeholder="Min. purchase PHP"
                  inputMode="decimal"
                  value={minimum}
                  onChange={(event) => setMinimum(event.target.value)}
                />
                <Input
                  aria-label="Start date and time"
                  type="datetime-local"
                  title="Start (empty = now)"
                  value={startsAt}
                  onChange={(event) => setStartsAt(event.target.value)}
                />
                <Input
                  aria-label="End date and time"
                  type="datetime-local"
                  title="End (empty = no end)"
                  value={endsAt}
                  onChange={(event) => setEndsAt(event.target.value)}
                />
                <Input
                  aria-label="Total usage limit"
                  placeholder="Total uses"
                  inputMode="numeric"
                  value={globalLimit}
                  onChange={(event) => setGlobalLimit(event.target.value)}
                />
                <Input
                  aria-label="Per-customer usage limit"
                  placeholder="Uses per customer"
                  inputMode="numeric"
                  value={perCustomerLimit}
                  onChange={(event) => setPerCustomerLimit(event.target.value)}
                />
              </fieldset>
            </form>
          </ListPageSection>

          <ListPageSection title="Definitions">
            {page === null || page.items.length === 0 ? (
              <p className="p-5 text-sm text-[var(--fm-text-muted)]" role="status">
                No promotions defined yet.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Benefit</TableHead>
                    <TableHead>Window</TableHead>
                    <TableHead>Limits</TableHead>
                    <TableHead>
                      <span className="sr-only">Detail link</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {page.items.map((promotion) => (
                    <TableRow key={promotion.promotionId}>
                      <TableCell className="font-mono text-xs">{promotion.code}</TableCell>
                      <TableCell className="font-medium">{promotion.name}</TableCell>
                      <TableCell>
                        <PromotionStatusSwitch
                          promotion={promotion}
                          onApplied={(summary) =>
                            setPage((current) => {
                              if (!current || summary.productTargets?.length) return current;
                              return {
                                ...current,
                                items: current.items.map((item) =>
                                  item.promotionId === summary.promotionId ? summary : item,
                                ),
                              };
                            })
                          }
                        />
                      </TableCell>
                      <TableCell className="text-xs text-[var(--fm-text-muted)]">
                        {promotion.benefitType.endsWith("PERCENT_DISCOUNT")
                          ? `${promotion.percent}% off`
                          : promotion.benefitType === "DELIVERY_FEE_WAIVER"
                            ? "Free delivery"
                            : `PHP ${((promotion.discountMinor ?? 0) / 100).toFixed(2)} off`}
                        {promotion.minimumMinor > 0
                          ? ` · min ₱${(promotion.minimumMinor / 100).toFixed(2)}`
                          : ""}
                      </TableCell>
                      <TableCell className="text-xs text-[var(--fm-text-muted)]">
                        {new Date(promotion.startsAt).toLocaleDateString()} →{" "}
                        {promotion.endsAt
                          ? new Date(promotion.endsAt).toLocaleDateString()
                          : "no end"}
                      </TableCell>
                      <TableCell className="text-xs text-[var(--fm-text-muted)]">
                        {promotion.globalUsageLimit === null &&
                        promotion.perCustomerUsageLimit === null
                          ? "Unlimited"
                          : [
                              promotion.perCustomerUsageLimit !== null
                                ? `${promotion.perCustomerUsageLimit}/customer`
                                : null,
                              promotion.globalUsageLimit !== null
                                ? `${promotion.globalUsageLimit} total`
                                : null,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/admin/promotions/${promotion.promotionId}`}
                          prefetch={false}
                          className="text-xs font-medium text-[var(--fm-info)] underline"
                        >
                          Manage
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            <AdminCursorPagination
              pageNumber={pagination.pageNumber}
              nextCursor={page?.nextCursor ?? null}
              onPrevious={pagination.previous}
              onNext={pagination.next}
            />
          </ListPageSection>
        </>
      ) : null}
    </div>
  );
}
