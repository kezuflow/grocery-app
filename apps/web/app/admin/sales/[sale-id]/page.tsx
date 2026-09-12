"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useState, type ComponentProps } from "react";
import { ArrowLeft, ChevronDown } from "lucide-react";
import type { AdminPromotionDetail } from "@freshmarkets/contracts";
import { adminPromotionSummarySchema } from "@freshmarkets/validation";
import { catalogResultSchema, useCatalogCommand } from "@/components/admin/catalog-command-state";
import { PromotionDefinitionForm } from "@/components/admin/promotion-definition-form";
import { PromotionStatusSwitch } from "@/components/admin/promotion-status-switch";
import { Button } from "../../../../components/ui/button";
import { Skeleton } from "../../../../components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "../../../../components/ui/alert";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../../components/ui/dropdown-menu";

type LoadState =
  | { phase: "loading" }
  | { phase: "error"; message: string; requestId: string | null }
  | { phase: "ready"; sale: AdminPromotionDetail };

function peso(minor: number): string {
  return `₱${(minor / 100).toLocaleString("en-PH", { minimumFractionDigits: 2 })}`;
}

function discountLabel(sale: AdminPromotionDetail): string {
  return sale.benefitType === "ORDER_PERCENT_DISCOUNT"
    ? `${sale.percent}% off per unit`
    : `${peso(sale.discountMinor ?? 0)} off per unit`;
}

function allowanceLabel(
  target: NonNullable<AdminPromotionDetail["productTargets"]>[number],
): string {
  if (target.quantityLimit === null) return "Whole stock";
  return `${target.remainingQuantity ?? 0} of ${target.quantityLimit} remaining`;
}

export default function InventorySaleDetailPage({
  params,
}: {
  params: Promise<{ "sale-id": string }>;
}) {
  const { "sale-id": saleId } = use(params);
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const command = useCatalogCommand(adminPromotionSummarySchema);

  const load = useCallback(async () => {
    setState({ phase: "loading" });
    try {
      const response = await fetch(`/api/admin/promotions/${encodeURIComponent(saleId)}`);
      const payload = catalogResultSchema(adminPromotionSummarySchema).parse(await response.json());
      if (!payload.ok) {
        setState({
          phase: "error",
          message: payload.error.message,
          requestId: payload.error.requestId,
        });
        return;
      }
      setState({ phase: "ready", sale: payload.value });
    } catch {
      setState({
        phase: "error",
        message: "Network error loading the inventory sale.",
        requestId: null,
      });
    }
  }, [saleId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(
    body: Parameters<NonNullable<ComponentProps<typeof PromotionDefinitionForm>["onSave"]>>[0],
  ): Promise<boolean> {
    try {
      const payload = await command
        .submit(`/api/admin/promotions/${encodeURIComponent(saleId)}`, body, "PATCH")
        .catch(() => command.retry());
      if (!payload) return false;
      setNotice(payload.ok ? "Sale details saved." : payload.error.message);
      if (payload.ok) {
        setEditing(false);
        await load();
      }
      return payload.ok;
    } catch {
      setNotice("The sale could not be saved. Try again to check the same change.");
      return false;
    }
  }

  if (state.phase === "loading") {
    return (
      <div className="space-y-3" role="status" aria-label="Loading inventory sale">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (state.phase === "error") {
    return (
      <Alert variant="destructive">
        <AlertTitle>The inventory sale could not be loaded</AlertTitle>
        <AlertDescription>
          {state.message}
          {state.requestId ? (
            <span className="mt-1 block font-mono text-xs">
              Request reference: {state.requestId}
            </span>
          ) : null}
        </AlertDescription>
      </Alert>
    );
  }

  const { sale } = state;
  const targets = sale.productTargets ?? [];
  const active = sale.status === "ACTIVE";

  return (
    <div className="mx-auto w-full max-w-[1280px]">
      <div className="grid min-h-[calc(100vh-10rem)] lg:grid-cols-[minmax(0,1fr)_minmax(320px,390px)]">
        <main className="min-w-0 p-5 sm:p-7">
          <Link
            href="/admin/sales"
            className="inline-flex items-center gap-2 text-sm font-medium text-[var(--fm-text-muted)] hover:text-[var(--fm-text)]"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            Inventory sales
          </Link>

          <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-[2rem] font-bold tracking-[-0.04em] text-[var(--fm-text)]">
                  {sale.name}
                </h1>
                <span
                  className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${active ? "bg-emerald-100 text-emerald-800" : "bg-[var(--fm-admin-surface-muted)] text-[var(--fm-text-muted)]"}`}
                >
                  <span
                    className={`size-1.5 rounded-full ${active ? "bg-emerald-600" : "bg-slate-400"}`}
                    aria-hidden="true"
                  />
                  {active ? "Active" : "Draft"}
                </span>
              </div>
              <p className="mt-1 text-sm text-[var(--fm-text-muted)]">
                Automatic sale on selected products at reduced price.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="outline" className="gap-2">
                    More actions <ChevronDown className="size-4" aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onSelect={() => setNotice("Sale activity is shown on this page.")}
                  >
                    View activity
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() =>
                      setNotice("Sale ID copied to the clipboard is not available in this browser.")
                    }
                  >
                    View sale ID
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              {sale.status === "DRAFT" ? (
                <Button
                  type="button"
                  onClick={() => setEditing((value) => !value)}
                  className="bg-[var(--fm-admin-accent)] text-white hover:bg-[var(--fm-admin-accent-strong)]"
                >
                  {editing ? "Close editor" : "Edit sale"}
                </Button>
              ) : null}
            </div>
          </div>

          {notice ? (
            <p
              role="status"
              className="mt-5 rounded-lg border border-[var(--fm-border)] bg-[var(--fm-admin-surface-muted)] p-3 text-sm"
            >
              {notice}
            </p>
          ) : null}

          <div className="mt-8 flex items-center gap-6 border-b border-[var(--fm-border)] text-sm">
            <span className="border-b-2 border-[var(--fm-admin-accent)] pb-3 font-semibold text-[var(--fm-text)]">
              Details
            </span>
            <span className="pb-3 text-[var(--fm-text-muted)]">Products</span>
            <span className="pb-3 text-[var(--fm-text-muted)]">Activity</span>
          </div>

          {editing && sale.status === "DRAFT" ? (
            <section
              className="mt-5 rounded-lg border border-[var(--fm-border)] bg-[var(--fm-admin-surface)]"
              aria-labelledby="edit-sale-title"
            >
              <h2
                id="edit-sale-title"
                className="border-b border-[var(--fm-border)] px-5 py-4 text-lg font-semibold"
              >
                Edit sale details
              </h2>
              <PromotionDefinitionForm
                promotion={sale}
                disabled={command.pending || command.uncertain}
                onSave={save}
              />
            </section>
          ) : (
            <>
              <section
                className="mt-5 rounded-lg border border-[var(--fm-border)] bg-[var(--fm-admin-surface)] p-5"
                aria-labelledby="basic-information-title"
              >
                <h2 id="basic-information-title" className="text-lg font-semibold">
                  Basic information
                </h2>
                <dl className="mt-5 grid gap-x-8 gap-y-5 sm:grid-cols-2">
                  <div>
                    <dt className="text-xs text-[var(--fm-text-muted)]">Sale name</dt>
                    <dd className="mt-1 font-medium">{sale.name}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-[var(--fm-text-muted)]">Status</dt>
                    <dd className="mt-1 font-medium">{active ? "Active" : "Draft"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-[var(--fm-text-muted)]">Products</dt>
                    <dd className="mt-1 font-medium">
                      {targets
                        .map((target) => target.productName ?? "Selected product")
                        .filter((name, index, items) => items.indexOf(name) === index)
                        .join(", ") || "No products"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-[var(--fm-text-muted)]">Location</dt>
                    <dd className="mt-1 font-medium">
                      {targets[0]?.locationName ?? "Selected location"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-[var(--fm-text-muted)]">Discount type</dt>
                    <dd className="mt-1 font-medium">{discountLabel(sale)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-[var(--fm-text-muted)]">Allowance</dt>
                    <dd className="mt-1 font-medium">
                      {targets.every((target) => target.quantityLimit === null)
                        ? "Whole stock"
                        : "Limited quantity"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-[var(--fm-text-muted)]">Start date</dt>
                    <dd className="mt-1 font-medium">
                      {new Date(sale.startsAt).toLocaleDateString()}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-[var(--fm-text-muted)]">End date</dt>
                    <dd className="mt-1 font-medium">
                      {sale.endsAt ? new Date(sale.endsAt).toLocaleDateString() : "No end date"}
                    </dd>
                  </div>
                </dl>
              </section>

              <section
                className="mt-5 rounded-lg border border-[var(--fm-border)] bg-[var(--fm-admin-surface)] p-5"
                aria-labelledby="selling-options-title"
              >
                <h2 id="selling-options-title" className="text-lg font-semibold">
                  Product selling options
                </h2>
                <div className="mt-4 overflow-x-auto rounded-lg border border-[var(--fm-border)]">
                  <table className="w-full min-w-[520px] text-left text-sm">
                    <thead className="bg-[var(--fm-admin-surface-muted)] text-xs text-[var(--fm-text-muted)]">
                      <tr>
                        <th className="px-3 py-3 font-medium">Option</th>
                        <th className="px-3 py-3 font-medium">Sale discount</th>
                        <th className="px-3 py-3 font-medium">Allowance</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--fm-border)]">
                      {targets.map((target) => (
                        <tr key={`${target.skuId}:${target.locationId}`}>
                          <td className="px-3 py-3 font-medium">
                            {target.skuName ?? "Selling option"}
                          </td>
                          <td className="px-3 py-3">{discountLabel(sale)}</td>
                          <td className="px-3 py-3">{allowanceLabel(target)}</td>
                        </tr>
                      ))}
                      {targets.length === 0 ? (
                        <tr>
                          <td colSpan={3} className="px-3 py-4 text-[var(--fm-text-muted)]">
                            No selling options configured.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </section>

              <section
                className="mt-5 rounded-lg border border-[var(--fm-border)] bg-[var(--fm-admin-surface)] p-5"
                aria-labelledby="allowance-title"
              >
                <h2 id="allowance-title" className="text-lg font-semibold">
                  Allowance and stock
                </h2>
                <div className="mt-4 grid gap-4 rounded-lg bg-[var(--fm-admin-surface-muted)] p-4 sm:grid-cols-2">
                  <div>
                    <p className="text-xs text-[var(--fm-text-muted)]">Sale allowance</p>
                    <p className="mt-1 text-lg font-semibold">
                      {targets.every((target) => target.quantityLimit === null)
                        ? "Whole stock"
                        : "Limited quantity"}
                    </p>
                    <p className="mt-1 text-xs text-[var(--fm-text-muted)]">
                      Applies to the selected stock at this location.
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-[var(--fm-text-muted)]">Remaining allowance</p>
                    <p className="mt-1 text-lg font-semibold">
                      {targets.every((target) => target.quantityLimit === null)
                        ? "∞"
                        : targets
                            .reduce((sum, target) => sum + (target.remainingQuantity ?? 0), 0)
                            .toLocaleString("en-PH")}
                    </p>
                    <p className="mt-1 text-xs text-[var(--fm-text-muted)]">
                      Updated from current inventory availability.
                    </p>
                  </div>
                </div>
                <div className="mt-4 rounded-lg border border-[var(--fm-border)] p-4">
                  <p className="text-xs text-[var(--fm-text-muted)]">Current physical stock</p>
                  <p className="mt-1 text-2xl font-bold">Managed through inventory</p>
                  <p className="mt-1 text-xs text-[var(--fm-text-muted)]">
                    Stock is managed through inventory features.
                  </p>
                </div>
              </section>
            </>
          )}
        </main>

        <aside className="border-t border-[var(--fm-border)] bg-[var(--fm-admin-surface)] lg:border-l lg:border-t-0">
          <section
            className="border-b border-[var(--fm-border)] p-5"
            aria-labelledby="sale-status-title"
          >
            <h2 id="sale-status-title" className="text-lg font-semibold">
              Sale status
            </h2>
            <div className="mt-4 rounded-lg border border-[var(--fm-border)] p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span
                    className={`flex size-7 items-center justify-center rounded-full ${active ? "bg-emerald-100" : "bg-[var(--fm-admin-surface-muted)]"}`}
                  >
                    <span
                      className={`size-2 rounded-full ${active ? "bg-emerald-600" : "bg-slate-400"}`}
                    />
                  </span>
                  <span className="text-lg font-semibold">{active ? "Active" : "Draft"}</span>
                </div>
                <PromotionStatusSwitch
                  promotion={sale}
                  onApplied={(summary) => setState({ phase: "ready", sale: summary })}
                />
              </div>
              <p className="mt-3 text-sm text-[var(--fm-text-muted)]">
                {active
                  ? "This sale is currently running and applied at checkout."
                  : "This sale is saved as a draft and is not active."}
              </p>
            </div>
          </section>
          <section className="p-5" aria-labelledby="activity-title">
            <h2 id="activity-title" className="text-lg font-semibold">
              Activity
            </h2>
            <ol className="mt-5 space-y-6 border-l border-[var(--fm-border)] pl-5 text-sm">
              <li className="relative">
                <span className="absolute -left-[1.65rem] top-0.5 size-3 rounded-full border-4 border-[var(--fm-admin-surface)] bg-[var(--fm-admin-accent)]" />
                <p className="font-medium">Sale {active ? "activated" : "created"}</p>
                <p className="mt-1 text-xs text-[var(--fm-text-muted)]">
                  {new Date(active ? sale.updatedAt : sale.createdAt).toLocaleString()}
                </p>
                <p className="mt-1 text-xs text-[var(--fm-text-muted)]">
                  Automatic sale setup for selected products.
                </p>
              </li>
              <li className="relative">
                <span className="absolute -left-[1.65rem] top-0.5 size-3 rounded-full border-4 border-[var(--fm-admin-surface)] bg-slate-300" />
                <p className="font-medium">Sale created</p>
                <p className="mt-1 text-xs text-[var(--fm-text-muted)]">
                  {new Date(sale.createdAt).toLocaleString()}
                </p>
              </li>
            </ol>
          </section>
        </aside>
      </div>
    </div>
  );
}
