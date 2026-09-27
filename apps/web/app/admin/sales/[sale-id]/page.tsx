"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useRef, useState, type ComponentProps } from "react";
import { ArrowLeft } from "lucide-react";
import type { AdminPromotionDetail } from "@freshmarkets/contracts";
import { adminPromotionSummarySchema } from "@freshmarkets/validation";
import { catalogResultSchema, useCatalogCommand } from "@/components/admin/catalog-command-state";
import { PromotionDefinitionForm } from "@/components/admin/promotion-definition-form";
import { PromotionStatusSwitch } from "@/components/admin/promotion-status-switch";
import { Button } from "@/components/admin/shadcn/button";
import { Badge } from "@/components/admin/shadcn/badge";
import { Skeleton } from "@/components/admin/shadcn/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/admin/shadcn/alert";
import { AdminPageState } from "../../../../components/admin/admin-page-state";
import { PageHeader } from "../../../../components/admin/admin-shell";
import { useAdminRouteGuard } from "../../../../components/admin/use-admin-route-guard";
import { useAdminContext, useAdminScopeGuard } from "../../admin-context-provider";

type LoadState =
  | { phase: "loading" }
  | { phase: "error"; code: string; message: string; requestId: string | null }
  | { phase: "ready"; sale: AdminPromotionDetail };

const statusPresentation = {
  DRAFT: {
    label: "Draft",
    variant: "outline",
    dot: "bg-muted-foreground",
    icon: "bg-muted",
    description: "This sale is saved as a draft and is not active.",
  },
  ACTIVE: {
    label: "Active",
    variant: "secondary",
    dot: "bg-primary",
    icon: "bg-secondary",
    description: "Active status; applies only during its scheduled dates when eligible.",
  },
  INACTIVE: {
    label: "Inactive",
    variant: "outline",
    dot: "bg-muted-foreground",
    icon: "bg-muted",
    description: "This sale is inactive and is not applied at checkout.",
  },
  ARCHIVED: {
    label: "Archived",
    variant: "outline",
    dot: "bg-muted-foreground",
    icon: "bg-muted",
    description: "This sale is archived and remains available as a historical record.",
  },
} as const;

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
  const admin = useAdminContext();

  if (admin.state.phase !== "ready") {
    return <AdminPageState state="loading" title="Loading sale access" />;
  }

  const canRead =
    admin.state.selectedScope?.kind === "GLOBAL" &&
    admin.state.context.capabilities.includes("promotions.read");
  if (!canRead) {
    return (
      <section className="space-y-5" aria-labelledby="admin-page-title">
        <PageHeader title="Promotion Sale unavailable" />
        <AdminPageState
          state="error"
          title="Promotion Sale access denied"
          message="Promotion Sale details require the promotions.read capability with a Global scope."
        />
      </section>
    );
  }

  const scopeKey = JSON.stringify(admin.state.selectedScope);
  return (
    <InventorySaleDetailWorkspace
      key={`${scopeKey}:${saleId}`}
      saleId={saleId}
      canManage={admin.state.context.capabilities.includes("promotions.manage")}
    />
  );
}

function InventorySaleDetailWorkspace({
  saleId,
  canManage,
}: {
  saleId: string;
  canManage: boolean;
}) {
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const command = useCatalogCommand(adminPromotionSummarySchema);
  const loadGeneration = useRef(0);
  const locked = canManage && (command.pending || command.uncertain);
  useAdminScopeGuard(canManage && editing, locked, () => setEditing(false));
  useAdminRouteGuard(canManage && editing, locked);

  const load = useCallback(
    async (preserveConfirmed = false) => {
      const generation = ++loadGeneration.current;
      if (!preserveConfirmed) setState({ phase: "loading" });
      try {
        const response = await fetch(`/api/admin/promotions/${encodeURIComponent(saleId)}`);
        const payload = catalogResultSchema(adminPromotionSummarySchema).parse(
          await response.json(),
        );
        if (generation !== loadGeneration.current) return;
        if (!payload.ok) {
          if (preserveConfirmed) {
            setNotice("The sale is saved, but the latest record could not be refreshed.");
            return;
          }
          setState({
            phase: "error",
            code: payload.error.code,
            message: payload.error.message,
            requestId: payload.error.requestId,
          });
          return;
        }
        setState({ phase: "ready", sale: payload.value });
      } catch {
        if (generation !== loadGeneration.current) return;
        if (preserveConfirmed) {
          setNotice("The sale is saved, but the latest record could not be refreshed.");
          return;
        }
        setState({
          phase: "error",
          code: "NETWORK_ERROR",
          message: "Network error loading the inventory sale.",
          requestId: null,
        });
      }
    },
    [saleId],
  );

  useEffect(() => {
    void load();
    return () => {
      loadGeneration.current += 1;
    };
  }, [load]);

  async function save(
    body: Parameters<NonNullable<ComponentProps<typeof PromotionDefinitionForm>["onSave"]>>[0],
  ): Promise<boolean> {
    if (!canManage) return false;
    try {
      const payload = await command
        .submit(`/api/admin/promotions/${encodeURIComponent(saleId)}`, body, "PATCH", {
          title: "Sale saved",
        })
        .catch(() => command.retry());
      if (!payload) return false;
      setNotice(payload.ok ? "Sale details saved." : payload.error.message);
      if (payload.ok) {
        setEditing(false);
        setState({ phase: "ready", sale: payload.value });
        await load(true);
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
    const title =
      state.code === "NOT_FOUND"
        ? "Promotion Sale not found"
        : state.code === "FORBIDDEN"
          ? "Promotion Sale access denied"
          : "The inventory sale could not be loaded";
    return (
      <Alert variant="destructive">
        <AlertTitle>{title}</AlertTitle>
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
  const status = statusPresentation[sale.status];

  return (
    <div className="mx-auto w-full max-w-[1280px]">
      <div className="grid min-h-[calc(100vh-10rem)] lg:grid-cols-[minmax(0,1fr)_minmax(320px,390px)]">
        <main className="min-w-0 p-5 sm:p-7">
          <Link
            href="/admin/sales"
            className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            Promotion Sale
          </Link>

          <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-3xl font-bold tracking-tight text-foreground">{sale.name}</h1>
                <Badge variant={status.variant} className="gap-2">
                  <span className={`size-1.5 rounded-full ${status.dot}`} aria-hidden="true" />
                  {status.label}
                </Badge>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Automatic sale on selected products at reduced price.
              </p>
            </div>
            <div className="flex items-center gap-2">
              {canManage && sale.status === "DRAFT" ? (
                <Button type="button" onClick={() => setEditing((value) => !value)}>
                  {editing ? "Close editor" : "Edit sale"}
                </Button>
              ) : null}
            </div>
          </div>

          {notice ? (
            <p role="status" className="mt-5 rounded-lg border border-border bg-muted p-3 text-sm">
              {notice}
            </p>
          ) : null}

          {editing && canManage && sale.status === "DRAFT" ? (
            <section
              className="mt-8 rounded-lg border border-border bg-card"
              aria-labelledby="edit-sale-title"
            >
              <h2
                id="edit-sale-title"
                className="border-b border-border px-5 py-4 text-lg font-semibold"
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
                className="mt-8 rounded-lg border border-border bg-card p-5"
                aria-labelledby="basic-information-title"
              >
                <h2 id="basic-information-title" className="text-lg font-semibold">
                  Basic information
                </h2>
                <dl className="mt-5 grid gap-x-8 gap-y-5 sm:grid-cols-2">
                  <div>
                    <dt className="text-xs text-muted-foreground">Sale name</dt>
                    <dd className="mt-1 font-medium">{sale.name}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Status</dt>
                    <dd className="mt-1 font-medium">{status.label}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Products</dt>
                    <dd className="mt-1 font-medium">
                      {targets
                        .map((target) => target.productName ?? "Selected product")
                        .filter((name, index, items) => items.indexOf(name) === index)
                        .join(", ") || "No products"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Location</dt>
                    <dd className="mt-1 font-medium">
                      {targets[0]?.locationName ?? "Selected location"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Discount type</dt>
                    <dd className="mt-1 font-medium">{discountLabel(sale)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Allowance</dt>
                    <dd className="mt-1 font-medium">
                      {targets.every((target) => target.quantityLimit === null)
                        ? "Whole stock"
                        : "Limited quantity"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Start date</dt>
                    <dd className="mt-1 font-medium">
                      {new Date(sale.startsAt).toLocaleDateString()}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">End date</dt>
                    <dd className="mt-1 font-medium">
                      {sale.endsAt ? new Date(sale.endsAt).toLocaleDateString() : "No end date"}
                    </dd>
                  </div>
                </dl>
              </section>

              <section
                className="mt-5 rounded-lg border border-border bg-card p-5"
                aria-labelledby="selling-options-title"
              >
                <h2 id="selling-options-title" className="text-lg font-semibold">
                  Product selling options
                </h2>
                <div className="mt-4 overflow-x-auto rounded-lg border border-border">
                  <table className="w-full min-w-[520px] text-left text-sm">
                    <thead className="bg-muted text-xs text-muted-foreground">
                      <tr>
                        <th className="px-3 py-3 font-medium">Option</th>
                        <th className="px-3 py-3 font-medium">Sale discount</th>
                        <th className="px-3 py-3 font-medium">Allowance</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
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
                          <td colSpan={3} className="px-3 py-4 text-muted-foreground">
                            No selling options configured.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </section>

              <section
                className="mt-5 rounded-lg border border-border bg-card p-5"
                aria-labelledby="allowance-title"
              >
                <h2 id="allowance-title" className="text-lg font-semibold">
                  Allowance and stock
                </h2>
                <div className="mt-4 grid gap-4 rounded-lg bg-muted p-4 sm:grid-cols-2">
                  <div>
                    <p className="text-xs text-muted-foreground">Sale allowance</p>
                    <p className="mt-1 text-lg font-semibold">
                      {targets.every((target) => target.quantityLimit === null)
                        ? "Whole stock"
                        : "Limited quantity"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Applies to the selected stock at this location.
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Remaining allowance</p>
                    <p className="mt-1 text-lg font-semibold">
                      {targets.every((target) => target.quantityLimit === null)
                        ? "∞"
                        : targets
                            .reduce((sum, target) => sum + (target.remainingQuantity ?? 0), 0)
                            .toLocaleString("en-PH")}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Updated from current inventory availability.
                    </p>
                  </div>
                </div>
                <div className="mt-4 rounded-lg border border-border p-4">
                  <p className="text-xs text-muted-foreground">Current physical stock</p>
                  <p className="mt-1 text-2xl font-bold">Managed through inventory</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Stock is managed through inventory features.
                  </p>
                </div>
              </section>
            </>
          )}
        </main>

        <aside className="border-t border-border bg-card lg:border-l lg:border-t-0">
          <section className="border-b border-border p-5" aria-labelledby="sale-status-title">
            <h2 id="sale-status-title" className="text-lg font-semibold">
              Sale status
            </h2>
            <div className="mt-4 rounded-lg border border-border p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span
                    className={`flex size-7 items-center justify-center rounded-full ${status.icon}`}
                  >
                    <span className={`size-2 rounded-full ${status.dot}`} />
                  </span>
                  <span className="text-lg font-semibold">{status.label}</span>
                </div>
                {canManage ? (
                  <PromotionStatusSwitch
                    promotion={sale}
                    onApplied={(summary) => setState({ phase: "ready", sale: summary })}
                  />
                ) : null}
              </div>
              <p className="mt-3 text-sm text-muted-foreground">{status.description}</p>
            </div>
          </section>
          <section className="p-5" aria-labelledby="activity-title">
            <h2 id="activity-title" className="text-lg font-semibold">
              Record
            </h2>
            <ol className="mt-5 space-y-6 border-l border-border pl-5 text-sm">
              {sale.updatedAt !== sale.createdAt ? (
                <li className="relative">
                  <span className="absolute -left-[1.65rem] top-0.5 size-3 rounded-full border-4 border-card bg-primary" />
                  <p className="font-medium">Last updated</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {new Date(sale.updatedAt).toLocaleString()}
                  </p>
                </li>
              ) : null}
              <li className="relative">
                <span className="absolute -left-[1.65rem] top-0.5 size-3 rounded-full border-4 border-card bg-muted-foreground/50" />
                <p className="font-medium">Created</p>
                <p className="mt-1 text-xs text-muted-foreground">
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
