"use client";
import { z, adminProductDetailSchema, adminUnitSummarySchema } from "@freshmarkets/validation";
import { catalogResultSchema } from "@/components/admin/catalog-command-state";
import { useCallback, useEffect, useRef, useState, use } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import type { AdminProductDetail, AdminUnitSummary } from "@freshmarkets/contracts";
import { Button } from "@/components/admin/shadcn/button";
import { Input } from "@/components/admin/shadcn/input";
import { Skeleton } from "@/components/admin/shadcn/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/admin/shadcn/alert";
import {
  PageHeader,
  ListPageSection,
  StatusBadge,
} from "../../../../../components/admin/admin-shell";
import { useAdminCommand } from "@/components/admin/use-admin-command";
import { ConfirmCommandDialog } from "../../../../../components/admin/admin-controls";
import { ProductImagesEditor } from "@/components/admin/product-images-editor";
import { ProductVariantsTable } from "@/components/admin/product-variants-table";
import { ProductDetailSummary } from "../../../../../components/admin/product-detail-summary";
import { useAdminContext, useAdminScopeGuard } from "../../../admin-context-provider";
import { useAdminRouteGuard } from "@/components/admin/use-admin-route-guard";
import { useQueryClient } from "@tanstack/react-query";
import { invalidateAdminProductQueries } from "@/lib/query/admin-products";
import {
  adminProductReadIdentity,
  isAdminProductRecordCurrent,
  isAdminProductTransientCurrent,
} from "@/lib/query/admin-products";
import { resolveAdminProductScopeTarget } from "@/lib/admin/product-scope-target";

type LoadState =
  | { phase: "loading" }
  | { phase: "error"; message: string; requestId: string | null }
  | {
      phase: "ready";
      product: AdminProductDetail;
      units: AdminUnitSummary[];
      readIdentity: string;
    };

const BASE = "/api/admin/catalog";

export default function ProductDetailPage({
  params,
}: {
  params: Promise<{ "product-id": string }>;
}) {
  const { "product-id": productId } = use(params);
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const adminContext = useAdminContext();
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const [imageBusy, setImageBusy] = useState(false);
  const loadRequest = useRef(0);
  const [reason, setReason] = useState("");
  const [confirmingStatus, setConfirmingStatus] = useState<string | null>(null);
  const statusTrigger = useRef<HTMLButtonElement>(null);
  const [newSku, setNewSku] = useState({
    code: "",
    name: "",
    unitId: "",
    sellQuantity: "",
    sellingLabel: "Piece",
    estimatedShippingWeightGrams: "",
  });
  const [variantBusy, setVariantBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(
    searchParams.get("created")
      ? "Product created."
      : searchParams.get("updated")
        ? "Product updated."
        : null,
  );
  const command = useAdminCommand();
  const skuCommand = useAdminCommand();
  const otherPending =
    imageBusy || command.busy || command.uncertain || skuCommand.busy || skuCommand.uncertain;
  const commandIntent = { pending: otherPending || variantBusy };
  const dirty =
    reason.trim() !== "" ||
    newSku.code.trim() !== "" ||
    newSku.name.trim() !== "" ||
    newSku.unitId !== "" ||
    newSku.sellQuantity.trim() !== "" ||
    newSku.sellingLabel !== "Piece" ||
    newSku.estimatedShippingWeightGrams.trim() !== "";
  const locked = commandIntent.pending || confirmingStatus !== null;
  useAdminScopeGuard(dirty, locked, () => {
    setReason("");
    setNewSku({
      code: "",
      name: "",
      unitId: "",
      sellQuantity: "",
      sellingLabel: "Piece",
      estimatedShippingWeightGrams: "",
    });
  });
  useAdminRouteGuard(dirty, locked);
  const variantNotice = skuCommand.uncertain
    ? "The variant could not be confirmed. Select Add variant to try again."
    : skuCommand.notice;
  const selectedScope =
    adminContext.state.phase === "ready" ? adminContext.state.selectedScope : null;
  const productScopeTarget = resolveAdminProductScopeTarget(selectedScope);
  const load = useCallback(() => {
    if (otherPending) return;
    if (selectedScope?.kind !== "GLOBAL" && selectedScope?.kind !== "LOCATION") return;
    const readIdentity = adminProductReadIdentity(productId, selectedScope);
    const requestNumber = loadRequest.current + 1;
    loadRequest.current = requestNumber;
    setState({ phase: "loading" });
    void (async () => {
      try {
        const [productResponse, unitsResponse] = await Promise.all([
          fetch(
            `${BASE}/products/${encodeURIComponent(productId)}?${new URLSearchParams(
              selectedScope.kind === "LOCATION"
                ? {
                    scopeKind: "LOCATION",
                    marketId: selectedScope.marketId,
                    locationId: selectedScope.locationId,
                  }
                : { scopeKind: "GLOBAL" },
            )}`,
          ),
          fetch(`${BASE}/units`),
        ]);
        const productPayload = catalogResultSchema(adminProductDetailSchema).parse(
          await productResponse.json(),
        );
        if (loadRequest.current !== requestNumber) return;
        if (!productPayload.ok) {
          setState({
            phase: "error",
            message: productPayload.error.message,
            requestId: productPayload.error.requestId,
          });
          return;
        }
        const unitsPayload = catalogResultSchema(z.array(adminUnitSummarySchema)).parse(
          await unitsResponse.json(),
        );
        if (loadRequest.current !== requestNumber) return;
        if (!unitsPayload.ok && productPayload.value.scope.kind === "GLOBAL") {
          setState({
            phase: "error",
            message: unitsPayload.error.message,
            requestId: unitsPayload.error.requestId,
          });
          return;
        }
        setState({
          phase: "ready",
          product: productPayload.value,
          units: unitsPayload.ok ? unitsPayload.value : [],
          readIdentity,
        });
      } catch {
        if (loadRequest.current !== requestNumber) return;
        setState({
          phase: "error",
          message: "Network error loading the product.",
          requestId: null,
        });
      }
    })();
  }, [productId, selectedScope, otherPending]);

  useEffect(() => load(), [load]);
  const acceptedProductChange = () => {
    void invalidateAdminProductQueries(queryClient, [productId]);
    load();
  };

  async function run(
    url: string,
    method: "POST" | "PATCH" | "PUT" | "DELETE",
    body: unknown,
    successMessage = "Applied.",
  ) {
    skuCommand.setNotice(null);
    const applied = await command.run(url, url, body, method, { title: successMessage });
    setNotice(applied ? successMessage : null);
    if (applied) acceptedProductChange();
    return applied;
  }
  async function addVariant(body?: unknown) {
    setNotice(null);
    const applied =
      body === undefined
        ? await skuCommand.retry()
        : await skuCommand.run(`${BASE}/skus`, `${BASE}/skus`, body, "POST", {
            title: "Variant added",
          });
    if (applied) {
      setNotice("Variant added.");
      acceptedProductChange();
    }
  }
  if (!productScopeTarget && state.phase !== "ready") {
    return (
      <div className="p-5 sm:p-7">
        <Alert variant="destructive">
          <AlertTitle>Product scope required</AlertTitle>
          <AlertDescription>
            Select a supported Product scope before viewing this record.
          </AlertDescription>
        </Alert>
      </div>
    );
  }
  if (state.phase === "loading") {
    return (
      <div className="space-y-3 p-5 sm:p-7" role="status" aria-label="Loading product">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (state.phase === "error") {
    return (
      <div className="p-5 sm:p-7">
        <Alert variant="destructive">
          <AlertTitle>The product could not be loaded</AlertTitle>
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
      </div>
    );
  }

  const { product, units } = state;
  const recordCurrent = isAdminProductRecordCurrent(
    state.readIdentity,
    productId,
    productScopeTarget,
  );
  const statusConfirmationCurrent = isAdminProductTransientCurrent(
    recordCurrent,
    confirmingStatus,
    state.readIdentity,
  );
  const from = searchParams.get("from");
  const returnQuery = from ? new URLSearchParams(from).toString() : "";
  const listHref = `/admin/catalog/products${returnQuery ? `?${returnQuery}` : ""}`;
  const countedSizes = product.inventoryPool.stockTracking === "COUNTED_SIZES";
  const variantBaseUnitCode = countedSizes ? "PIECE" : product.inventoryPool.baseUnitCode;
  const canManageProduct = product.allowedActions.includes("UPDATE");
  const canManageLocation =
    product.scope.kind === "LOCATION" &&
    adminContext.state.phase === "ready" &&
    adminContext.state.context.capabilities.includes("catalog.manage");

  const detailSections =
    product.scope.kind === "LOCATION"
      ? [
          ["Overview", "#product-overview"],
          ["Sell variants", "#product-variants"],
          ["Audit", "#product-audit"],
        ]
      : [
          ["Overview", "#product-overview"],
          ["Media", "#product-media"],
          ["Status", "#product-status"],
          ["Sell variants", "#product-variants"],
          ["Audit", "#product-audit"],
        ];

  const master = (
    <section className="w-full space-y-6 p-5 sm:p-7">
      <Link
        href={listHref}
        className="inline-flex items-center gap-2 text-sm font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Products
      </Link>
      <PageHeader
        title={product.name}
        description={`${product.categoryName} · ${product.skus.length} sell variant${product.skus.length === 1 ? "" : "s"} · ${countedSizes ? "actual counted sizes" : `shared ${product.inventoryPool.baseUnitCode} inventory`}`}
        action={
          <span className="flex items-center gap-2">
            <StatusBadge tone={product.status === "active" ? "success" : "neutral"}>
              {product.status}
            </StatusBadge>
            {canManageProduct ? (
              <Button asChild variant="outline">
                <Link
                  href={`/admin/catalog/products/${product.productId}/edit${from ? `?from=${encodeURIComponent(from)}` : ""}`}
                >
                  Edit product
                </Link>
              </Button>
            ) : null}
          </span>
        }
      />

      {(notice ?? variantNotice ?? command.notice) ? (
        <p role="status" className="rounded-xl border border-border bg-card p-3 text-sm">
          {notice ?? variantNotice ?? command.notice}
        </p>
      ) : null}

      <div
        aria-label="Product detail sections"
        className="sticky top-[4.5rem] z-20 -mx-1 overflow-x-auto rounded-md border border-border bg-card/95 px-2 shadow-sm backdrop-blur"
      >
        <div className="flex min-w-max gap-1 py-1">
          {detailSections.map(([label, href]) => (
            <a
              className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              href={href}
              key={href}
            >
              {label}
            </a>
          ))}
        </div>
      </div>

      <div id="product-overview" className="scroll-mt-32">
        {command.uncertain ? (
          <Button
            disabled={command.busy}
            onClick={async () => {
              if (await command.retry()) {
                setNotice("Applied.");
                acceptedProductChange();
              }
            }}
          >
            Retry saved command
          </Button>
        ) : null}
        <ProductDetailSummary product={product} />
      </div>

      <div id="product-media" className="scroll-mt-32">
        {canManageProduct ? (
          <fieldset disabled={commandIntent.pending}>
            <ProductImagesEditor
              productId={productId}
              version={product.version}
              images={product.media}
              onBusyChange={setImageBusy}
              onComplete={() => {
                setNotice("Images updated.");
                acceptedProductChange();
              }}
            />
          </fieldset>
        ) : (
          <ListPageSection title="Product images" description="Product photos and display order.">
            <div className="flex flex-wrap gap-4 p-4">
              {product.media.map((image) => (
                <img
                  key={image.mediaId}
                  src={`${BASE}/products/${encodeURIComponent(productId)}/media/${encodeURIComponent(image.mediaId)}/content?version=${image.version}`}
                  alt={image.altText}
                  className="size-28 object-contain"
                />
              ))}
            </div>
          </ListPageSection>
        )}
      </div>
      {product.allowedActions.includes("SET_STATUS") ? (
        <div id="product-status" className="scroll-mt-32">
          <ListPageSection
            title="Product status"
            description="Inactive products leave all storefront surfaces. Historical snapshots remain intact."
          >
            <div className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center">
              <Input
                aria-label="Reason"
                disabled={commandIntent.pending}
                placeholder="reason (required)"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                className="sm:w-72"
              />
              <Button
                ref={statusTrigger}
                disabled={commandIntent.pending}
                size="sm"
                variant={product.status === "active" ? "destructive" : "default"}
                onClick={() => {
                  if (reason.trim() === "") {
                    setNotice("A reason is required.");
                    return;
                  }
                  setConfirmingStatus(state.readIdentity);
                }}
              >
                {product.status === "active" ? "Review deactivation" : "Review activation"}
              </Button>
            </div>
          </ListPageSection>
        </div>
      ) : null}

      <div id="product-variants" className="scroll-mt-32">
        <ListPageSection
          title="Sell variants"
          description="Customer choices consume exact quantities from this Product's one shared inventory pool. Selling status is separate from physical stock."
        >
          {canManageProduct ? (
            <form
              className="grid gap-4 border-b border-border p-4"
              onSubmit={(event) => {
                event.preventDefault();
                if (skuCommand.uncertain) {
                  void addVariant();
                  return;
                }
                const unit = units.find((candidate) => candidate.unitId === newSku.unitId);
                if (
                  newSku.code.trim() === "" ||
                  newSku.name.trim() === "" ||
                  !unit ||
                  !Number.isSafeInteger(Number(countedSizes ? 1 : newSku.sellQuantity)) ||
                  Number(countedSizes ? 1 : newSku.sellQuantity) < 1
                ) {
                  setNotice("SKU code, display name, unit, and amount are required.");
                  return;
                }
                const convertedNumerator =
                  Number(countedSizes ? 1 : newSku.sellQuantity) * unit.conversionNumerator;
                if (
                  !Number.isSafeInteger(convertedNumerator) ||
                  convertedNumerator % unit.conversionDenominator !== 0
                ) {
                  setNotice("This amount does not convert to an exact base inventory unit.");
                  return;
                }
                const enteredShippingWeight = newSku.estimatedShippingWeightGrams.trim();
                const estimatedShippingWeightGrams =
                  variantBaseUnitCode === "GRAM" || !enteredShippingWeight
                    ? null
                    : Number(enteredShippingWeight);
                if (
                  estimatedShippingWeightGrams !== null &&
                  (!Number.isSafeInteger(estimatedShippingWeightGrams) ||
                    estimatedShippingWeightGrams < 1)
                ) {
                  setNotice("Shipping weight must be a positive whole number when provided.");
                  return;
                }
                void addVariant({
                  productId,
                  code: newSku.code.trim().toUpperCase(),
                  name: newSku.name.trim(),
                  sellableUnitId: unit.unitId,
                  sellQuantity: Number(countedSizes ? 1 : newSku.sellQuantity),
                  ...(countedSizes ? { merchandisingLabel: newSku.sellingLabel } : {}),
                  consumptionBaseQuantity: convertedNumerator / unit.conversionDenominator,
                  ...(estimatedShippingWeightGrams === null
                    ? {}
                    : { estimatedShippingWeightGrams }),
                });
              }}
            >
              <div>
                <p className="text-sm font-semibold text-foreground">Add a sell variant</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Example: SKU <span className="font-mono">ZUCCHINI-250G</span>, display name “Small
                  bag (250 g)”, unit “Gram”, and amount “250”.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(12rem,1.2fr)_minmax(12rem,1.2fr)_minmax(10rem,0.9fr)_minmax(8rem,0.7fr)_auto] lg:items-end">
                <label className="grid gap-1 text-sm font-medium">
                  SKU code
                  <span className="text-xs font-normal text-muted-foreground">
                    Stable internal identifier
                  </span>
                  <Input
                    aria-label="SKU code"
                    disabled={commandIntent.pending}
                    placeholder="ZUCCHINI-250G"
                    value={newSku.code}
                    onChange={(event) => setNewSku({ ...newSku, code: event.target.value })}
                  />
                </label>
                {variantBaseUnitCode !== "GRAM" ? (
                  <label className="grid gap-1 text-sm font-medium">
                    Shipping weight (g, optional)
                    <span className="text-xs font-normal text-muted-foreground">
                      Logistics reference for one sold unit
                    </span>
                    <Input
                      aria-label="Estimated shipping weight"
                      disabled={commandIntent.pending}
                      type="number"
                      inputMode="numeric"
                      min={1}
                      step={1}
                      placeholder="60"
                      value={newSku.estimatedShippingWeightGrams}
                      onChange={(event) =>
                        setNewSku({
                          ...newSku,
                          estimatedShippingWeightGrams: event.target.value,
                        })
                      }
                    />
                  </label>
                ) : null}
                <label className="grid gap-1 text-sm font-medium">
                  Display name
                  <span className="text-xs font-normal text-muted-foreground">
                    Customer-facing choice
                  </span>
                  <Input
                    aria-label="Display name"
                    disabled={commandIntent.pending}
                    placeholder="Small bag (250 g)"
                    value={newSku.name}
                    onChange={(event) => setNewSku({ ...newSku, name: event.target.value })}
                  />
                </label>
                <label className="grid gap-1 text-sm font-medium">
                  Unit
                  <span className="text-xs font-normal text-muted-foreground">
                    Measurement type
                  </span>
                  <select
                    aria-label="Unit"
                    disabled={commandIntent.pending}
                    value={
                      countedSizes ? (newSku.unitId ? newSku.sellingLabel : "") : newSku.unitId
                    }
                    onChange={(event) =>
                      setNewSku(
                        countedSizes
                          ? {
                              ...newSku,
                              unitId: event.target.value
                                ? (units.find((unit) => unit.code === "PIECE")?.unitId ?? "")
                                : "",
                              sellingLabel: event.target.value,
                            }
                          : { ...newSku, unitId: event.target.value },
                      )
                    }
                    className="h-10 rounded-md border border-border bg-card px-3 text-sm"
                  >
                    <option value="">Select unit</option>
                    {countedSizes
                      ? ["Piece", "Pack"].map((label) => (
                          <option key={label} value={label}>
                            {label}
                          </option>
                        ))
                      : units
                          .filter(
                            (unit) =>
                              unit.status === "active" &&
                              unit.canonicalBaseCode === variantBaseUnitCode &&
                              unit.dimension !== "VOLUME",
                          )
                          .map((unit) => (
                            <option key={unit.unitId} value={unit.unitId}>
                              {unit.displayName}
                            </option>
                          ))}
                  </select>
                </label>
                {!countedSizes ? (
                  <label className="grid gap-1 text-sm font-medium">
                    Amount
                    <span className="text-xs font-normal text-muted-foreground">
                      Number in this unit
                    </span>
                    <Input
                      aria-label="Amount"
                      disabled={commandIntent.pending}
                      type="number"
                      inputMode="numeric"
                      min={1}
                      step={1}
                      placeholder="250"
                      value={newSku.sellQuantity}
                      onChange={(event) =>
                        setNewSku({ ...newSku, sellQuantity: event.target.value })
                      }
                    />
                  </label>
                ) : null}
                <Button
                  type="submit"
                  size="sm"
                  disabled={
                    imageBusy || command.busy || command.uncertain || skuCommand.busy || variantBusy
                  }
                  className="sm:col-span-2 lg:col-span-1"
                >
                  {skuCommand.busy ? "Adding variant…" : "Add variant"}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Shared inventory consumption is calculated automatically from the selected unit and
                amount.
              </p>
            </form>
          ) : null}
          <ProductVariantsTable
            product={product}
            canManageGlobal={canManageProduct}
            canManageLocation={canManageLocation}
            disabled={otherPending || confirmingStatus !== null}
            onInteractionChange={setVariantBusy}
            onSaved={acceptedProductChange}
          />
        </ListPageSection>
      </div>
      <div id="product-audit" className="scroll-mt-32">
        <ListPageSection title="Recent audit">
          {product.recentAudit.length ? (
            <ol className="divide-y divide-border">
              {product.recentAudit.map((audit) => (
                <li key={audit.auditEventId} className="p-4 text-sm">
                  <span className="font-medium">{audit.action}</span>
                  <span className="block text-muted-foreground">
                    {new Date(audit.occurredAt).toLocaleString()} ·{" "}
                    {audit.correlationId ?? "No request reference"}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="p-5 text-sm text-muted-foreground">No audit events recorded.</p>
          )}
        </ListPageSection>
      </div>
      <ConfirmCommandDialog
        open={statusConfirmationCurrent}
        title={product.status === "active" ? "Deactivate product?" : "Activate product?"}
        resource={`${product.name} · version ${product.version}`}
        scope="Global Catalog"
        consequence={
          product.status === "active"
            ? "The Product leaves storefront availability. Variants, prices, inventory history, and committed order snapshots remain intact."
            : "The Product becomes active, while each variant price and location selling status remains independently authoritative."
        }
        initialReason={reason}
        confirmLabel={product.status === "active" ? "Confirm deactivation" : "Confirm activation"}
        cancelLabel="Cancel"
        pending={commandIntent.pending}
        restoreFocusRef={statusTrigger}
        onCancel={() => setConfirmingStatus(null)}
        onConfirm={(confirmedReason) => {
          if (confirmingStatus !== state.readIdentity || !recordCurrent) return;
          setConfirmingStatus(null);
          void run(`${BASE}/products/${encodeURIComponent(productId)}/status`, "POST", {
            status: product.status === "active" ? "inactive" : "active",
            reason: confirmedReason,
            expectedVersion: product.version,
          });
        }}
      />
    </section>
  );

  return (
    <>
      {!recordCurrent ? (
        <Alert variant="destructive" className="m-5 sm:m-7">
          <AlertTitle>Product hidden while Admin scope changes</AlertTitle>
          <AlertDescription>
            Select a supported Product scope and wait for Core to authorize the current record.
          </AlertDescription>
        </Alert>
      ) : null}
      <div
        className={recordCurrent ? "contents" : undefined}
        hidden={!recordCurrent}
        inert={!recordCurrent}
      >
        {master}
      </div>
    </>
  );
}
