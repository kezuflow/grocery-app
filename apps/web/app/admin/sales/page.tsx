"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
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
import { PageHeader, ListPageSection, StatusBadge } from "../../../components/admin/admin-shell";
import { useCatalogCommand, catalogResultSchema } from "@/components/admin/catalog-command-state";
import { adminPromotionSummarySchema, adminPromotionPageSchema } from "@freshmarkets/validation";
import {
  PromotionProductTargetsEditor,
  type SaleTargetSelection,
} from "@/components/admin/promotion-product-targets-editor";
import {
  AdminCursorPagination,
  useAdminPagination,
} from "../../../components/admin/admin-controls";

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
  const createIntent = useCatalogCommand(adminPromotionSummarySchema);
  const pagination = useAdminPagination();

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
      // generated per attempt to satisfy the shared promotion contract.
      const code = `SALE_${crypto
        .randomUUID()
        .replace(/[^A-Z0-9]/gi, "")
        .slice(0, 8)}`;
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
    <div className="mx-auto max-w-[1280px] space-y-6">
      <PageHeader
        title="Inventory sales"
        description="Automatic strike-through sale prices on selected products. Promo codes live in Promotions."
      />

      {state.phase === "loading" ? (
        <div className="space-y-3" role="status" aria-label="Loading inventory sales">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : null}

      {state.phase === "error" ? (
        <Alert variant="destructive">
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
        <>
          {notice ? (
            <p
              role="status"
              className="rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-white p-3 text-sm"
            >
              {notice}
            </p>
          ) : null}

          <ListPageSection
            title="Create an inventory sale"
            description="Created as DRAFT; activate when ready. The sale price shows automatically on the storefront."
          >
            <form className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3" onSubmit={create}>
              <Input
                aria-label="Sale name"
                disabled={createIntent.pending || createIntent.uncertain}
                placeholder="Sale name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="sm:w-56"
              />
              <Select
                value={benefit}
                disabled={createIntent.pending || createIntent.uncertain}
                onValueChange={(value) => {
                  const choice =
                    value === "ORDER_FIXED_DISCOUNT" ? value : "ORDER_PERCENT_DISCOUNT";
                  setBenefit(choice);
                }}
              >
                <SelectTrigger aria-label="Sale discount type">
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
              <Input
                aria-label={
                  benefit === "ORDER_PERCENT_DISCOUNT"
                    ? "Discount percentage"
                    : "Amount off in pesos"
                }
                disabled={createIntent.pending || createIntent.uncertain}
                placeholder={benefit === "ORDER_PERCENT_DISCOUNT" ? "percentage" : "amount off PHP"}
                value={discount}
                onChange={(event) => setDiscount(event.target.value)}
              />
              <PromotionProductTargetsEditor
                enabled
                onEnabledChange={() => {}}
                alwaysOn
                value={productTargets}
                onChange={setProductTargets}
                disabled={createIntent.pending || createIntent.uncertain}
              />
              <Button type="submit" size="sm" disabled={createIntent.pending}>
                {createIntent.pending ? "Creating…" : "Create draft"}
              </Button>
            </form>
          </ListPageSection>

          <ListPageSection title="Sales">
            {page === null || page.items.length === 0 ? (
              <p className="p-5 text-sm text-[var(--fm-text-muted)]" role="status">
                No inventory sales defined yet.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Sale</TableHead>
                    <TableHead>Products</TableHead>
                    <TableHead>Allowance</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Benefit</TableHead>
                    <TableHead>
                      <span className="sr-only">Detail link</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {page.items.map((promotion) => (
                    <TableRow key={promotion.promotionId}>
                      <TableCell className="font-medium">{promotion.name}</TableCell>
                      <TableCell className="max-w-72 truncate text-xs text-[var(--fm-text-muted)]">
                        {saleTargetsLabel(promotion)}
                      </TableCell>
                      <TableCell className="text-xs">{saleAllowance(promotion)}</TableCell>
                      <TableCell>
                        <StatusBadge
                          tone={
                            promotion.status === "ACTIVE"
                              ? "success"
                              : promotion.status === "ARCHIVED"
                                ? "neutral"
                                : "info"
                          }
                        >
                          {promotion.status}
                        </StatusBadge>
                      </TableCell>
                      <TableCell className="text-xs text-[var(--fm-text-muted)]">
                        {saleDiscountLabel(promotion)}
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
