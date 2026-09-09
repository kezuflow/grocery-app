"use client";
import { z, adminProductDetailSchema, adminUnitSummarySchema } from "@freshmarkets/validation";
import { catalogResultSchema } from "@/components/admin/catalog-command-state";
import { useCallback, useEffect, useRef, useState, use } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type {
  AdminProductDetail,
  AdminProductMediaView,
  AdminUnitSummary,
} from "@freshmarkets/contracts";
import { Button } from "../../../../../components/ui/button";
import { Input } from "../../../../../components/ui/input";
import { Skeleton } from "../../../../../components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "../../../../../components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../../../components/ui/table";
import {
  PageHeader,
  ListPageSection,
  StatusBadge,
} from "../../../../../components/admin/admin-shell";
import { useAdminCommand } from "@/components/admin/use-admin-command";
import { ConfirmCommandDialog } from "../../../../../components/admin/admin-controls";
import { ProductMediaUpload } from "@/components/admin/product-media-upload";
import { GlobalPricePanel } from "../../../../../components/admin/global-price-panel";
import { SkuVariantEditor } from "@/components/admin/sku-variant-editor";
import { ProductDetailSummary } from "../../../../../components/admin/product-detail-summary";
import { useAdminContext } from "../../../admin-context-provider";

type LoadState =
  | { phase: "loading" }
  | { phase: "error"; message: string; requestId: string | null }
  | { phase: "ready"; product: AdminProductDetail; units: AdminUnitSummary[] };

const BASE = "/api/admin/catalog";

type VariantCommandConfirmation = {
  kind: "AVAILABILITY";
  skuId: string;
  skuCode: string;
  availabilityStatus: "AVAILABLE" | "UNAVAILABLE";
  expectedVersion: number;
  locationId: string;
  targetLabel: string;
};

export default function ProductDetailPage({
  params,
}: {
  params: Promise<{ "product-id": string }>;
}) {
  const { "product-id": productId } = use(params);
  const searchParams = useSearchParams();
  const adminContext = useAdminContext();
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const loadRequest = useRef(0);
  const [reason, setReason] = useState("");
  const [confirmingStatus, setConfirmingStatus] = useState(false);
  const statusTrigger = useRef<HTMLButtonElement>(null);
  const mediaTrigger = useRef<HTMLButtonElement | null>(null);
  const [mediaToRemove, setMediaToRemove] = useState<AdminProductMediaView | null>(null);
  const [newSku, setNewSku] = useState({
    code: "",
    name: "",
    unitId: "",
    sellQuantity: "",
    sellingLabel: "Piece",
    estimatedShippingWeightGrams: "",
  });
  const [variantCommand, setVariantCommand] = useState<VariantCommandConfirmation | null>(null);
  const [notice, setNotice] = useState<string | null>(
    searchParams.get("created")
      ? "Product created."
      : searchParams.get("updated")
        ? "Product updated."
        : null,
  );
  const command = useAdminCommand();
  const skuCommand = useAdminCommand();
  const commandIntent = {
    pending: command.busy || command.uncertain || skuCommand.busy || skuCommand.uncertain,
  };
  const variantNotice = skuCommand.uncertain
    ? "The variant could not be confirmed. Select Add variant to try again."
    : skuCommand.notice;
  const targetOptions = adminContext.state.phase === "ready" ? adminContext.state.scopes : [];
  const selectedScope =
    adminContext.state.phase === "ready" ? adminContext.state.selectedScope : null;
  const selectedTarget =
    selectedScope?.kind === "LOCATION"
      ? targetOptions.find(
          (option) => option.kind === "location" && option.locationId === selectedScope.locationId,
        )
      : null;

  const load = useCallback(() => {
    if (selectedScope?.kind !== "GLOBAL" && selectedScope?.kind !== "LOCATION") return;
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
  }, [productId, selectedScope]);

  useEffect(() => load(), [load]);

  async function run(
    url: string,
    method: "POST" | "PATCH" | "PUT" | "DELETE",
    body: unknown,
    successMessage = "Applied.",
  ) {
    skuCommand.setNotice(null);
    const applied = await command.run(url, url, body, method);
    setNotice(applied ? successMessage : null);
    if (applied) load();
    return applied;
  }
  async function addVariant(body?: unknown) {
    setNotice(null);
    const applied =
      body === undefined
        ? await skuCommand.retry()
        : await skuCommand.run(`${BASE}/skus`, `${BASE}/skus`, body);
    if (applied) {
      setNotice("Variant added.");
      load();
    }
  }
  if (state.phase === "loading") {
    return (
      <div className="space-y-3" role="status" aria-label="Loading product">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (state.phase === "error") {
    return (
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
    );
  }

  const { product, units } = state;
  const from = searchParams.get("from");
  const countedSizes = product.inventoryPool.stockTracking === "COUNTED_SIZES";
  const variantBaseUnitCode = countedSizes ? "PIECE" : product.inventoryPool.baseUnitCode;
  const canManageProduct = product.allowedActions.includes("UPDATE");
  const canManageLocation =
    product.scope.kind === "LOCATION" &&
    adminContext.state.phase === "ready" &&
    adminContext.state.context.capabilities.includes("catalog.manage");
  const canManageTarget = canManageLocation;
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

  return (
    <div className="mx-auto max-w-[1280px] space-y-6">
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
        <p
          role="status"
          className="rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-white p-3 text-sm"
        >
          {notice ?? variantNotice ?? command.notice}
        </p>
      ) : null}

      <div
        aria-label="Product detail sections"
        className="sticky top-[4.5rem] z-20 -mx-1 overflow-x-auto rounded-[var(--fm-radius-control)] border border-[var(--fm-border)] bg-white/95 px-2 shadow-sm backdrop-blur"
      >
        <div className="flex min-w-max gap-1 py-1">
          {detailSections.map(([label, href]) => (
            <a
              className="rounded-md px-3 py-2 text-sm font-medium text-[var(--fm-text-muted)] hover:bg-[var(--fm-hover)] hover:text-[var(--fm-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fm-focus)]"
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
                load();
              }
            }}
          >
            Retry saved command
          </Button>
        ) : null}
        <ProductDetailSummary product={product} />
      </div>

      <div id="product-media" className="scroll-mt-32">
        <ListPageSection
          title="Product media"
          description="Manage product images, descriptions and display order."
        >
          {canManageProduct ? (
            <ProductMediaUpload
              productId={productId}
              productVersion={product.version}
              onComplete={() => {
                setNotice("Media uploaded.");
                load();
              }}
            />
          ) : null}
          {product.media.length ? (
            <ul className="divide-y divide-[var(--fm-border)]">
              {product.media.map((media) => (
                <li key={`${media.mediaId}-${media.version}`} className="p-4 text-sm">
                  {canManageProduct ? (
                    <form
                      className="grid gap-3 md:grid-cols-[minmax(12rem,1fr)_7rem_8rem_auto_auto] md:items-end"
                      onSubmit={(event) => {
                        event.preventDefault();
                        const fields = new FormData(event.currentTarget);
                        void run(
                          `${BASE}/products/${encodeURIComponent(productId)}/media/${encodeURIComponent(media.mediaId)}`,
                          "PATCH",
                          {
                            altText: String(fields.get("altText") ?? ""),
                            isPrimary: fields.get("isPrimary") === "true",
                            sortOrder: Number(fields.get("sortOrder")),
                            expectedProductVersion: product.version,
                          },
                          "Media updated.",
                        );
                      }}
                    >
                      <label className="grid gap-1 font-medium">
                        Alt text for {media.altText}
                        <Input
                          name="altText"
                          defaultValue={media.altText}
                          maxLength={300}
                          required
                        />
                      </label>
                      <label className="grid gap-1 font-medium">
                        Order for {media.altText}
                        <Input
                          name="sortOrder"
                          type="number"
                          min={0}
                          max={10000}
                          defaultValue={media.sortOrder}
                          required
                        />
                      </label>
                      <label className="flex h-10 items-center gap-2 font-medium">
                        <input
                          name="isPrimary"
                          type="checkbox"
                          value="true"
                          defaultChecked={media.isPrimary}
                        />
                        Primary
                      </label>
                      <Button
                        type="submit"
                        size="sm"
                        variant="outline"
                        disabled={commandIntent.pending}
                        aria-label={`Save ${media.altText}`}
                      >
                        Save
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        disabled={commandIntent.pending}
                        aria-label={`Review remove ${media.altText}`}
                        onClick={(event) => {
                          mediaTrigger.current = event.currentTarget;
                          setMediaToRemove(media);
                        }}
                      >
                        Remove
                      </Button>
                    </form>
                  ) : (
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium">{media.altText}</span>
                      <span>{media.isPrimary ? "Primary" : `Order ${media.sortOrder}`}</span>
                    </div>
                  )}
                  <p className="mt-2 text-xs text-[var(--fm-text-muted)]">
                    {media.mimeType} · attachment v{media.version}
                    {media.isPrimary ? " · Current primary" : ""}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="p-5 text-sm text-[var(--fm-text-muted)]">No canonical media attached.</p>
          )}
        </ListPageSection>
      </div>
      <ConfirmCommandDialog
        open={mediaToRemove !== null}
        title={`Remove ${mediaToRemove?.altText ?? "media"}?`}
        resource={mediaToRemove?.altText ?? "Product media"}
        scope={`${product.name} · canonical media`}
        consequence="This deactivates the canonical attachment before deleting its stored image. The image disappears from active Product media and cannot be edited afterward."
        reasonRequired={false}
        confirmLabel="Confirm media removal"
        cancelLabel="Cancel"
        pending={commandIntent.pending}
        restoreFocusRef={mediaTrigger}
        onCancel={() => setMediaToRemove(null)}
        onConfirm={() => {
          const media = mediaToRemove;
          setMediaToRemove(null);
          if (!media) return;
          void run(
            `${BASE}/products/${encodeURIComponent(productId)}/media/${encodeURIComponent(media.mediaId)}`,
            "DELETE",
            { expectedProductVersion: product.version },
            "Media removed.",
          );
        }}
      />

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
                  setConfirmingStatus(true);
                }}
              >
                {product.status === "active" ? "Review deactivation" : "Review activation"}
              </Button>
            </div>
          </ListPageSection>
        </div>
      ) : null}

      {product.scope.kind === "GLOBAL" ? (
        <GlobalPricePanel skus={product.skus} scopes={targetOptions} />
      ) : null}

      <div id="product-variants" className="scroll-mt-32">
        <ListPageSection
          title="Sell variants"
          description="Customer choices consume exact quantities from this Product's one shared inventory pool. Selling status is separate from physical stock."
        >
          {canManageProduct ? (
            <form
              className="grid gap-4 border-b border-[var(--fm-border)] p-4"
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
                const estimatedShippingWeightGrams =
                  variantBaseUnitCode === "GRAM"
                    ? null
                    : Number(newSku.estimatedShippingWeightGrams);
                if (
                  variantBaseUnitCode !== "GRAM" &&
                  (typeof estimatedShippingWeightGrams !== "number" ||
                    !Number.isSafeInteger(estimatedShippingWeightGrams) ||
                    estimatedShippingWeightGrams < 1)
                ) {
                  setNotice("Enter a positive shipping weight in grams for one sold unit.");
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
                <p className="text-sm font-semibold text-[var(--fm-text)]">Add a sell variant</p>
                <p className="mt-1 text-xs leading-5 text-[var(--fm-text-muted)]">
                  Example: SKU <span className="font-mono">ZUCCHINI-250G</span>, display name “Small
                  bag (250 g)”, unit “Gram”, and amount “250”.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(12rem,1.2fr)_minmax(12rem,1.2fr)_minmax(10rem,0.9fr)_minmax(8rem,0.7fr)_auto] lg:items-end">
                <label className="grid gap-1 text-sm font-medium">
                  SKU code
                  <span className="text-xs font-normal text-[var(--fm-text-muted)]">
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
                    Shipping weight (g)
                    <span className="text-xs font-normal text-[var(--fm-text-muted)]">
                      Estimate for one sold unit
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
                  <span className="text-xs font-normal text-[var(--fm-text-muted)]">
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
                  <span className="text-xs font-normal text-[var(--fm-text-muted)]">
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
                    className="h-10 rounded-[var(--fm-radius-control)] border border-[var(--fm-border)] bg-white px-3 text-sm"
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
                    <span className="text-xs font-normal text-[var(--fm-text-muted)]">
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
                  disabled={command.busy || command.uncertain || skuCommand.busy}
                  className="sm:col-span-2 lg:col-span-1"
                >
                  {skuCommand.busy ? "Adding variant…" : "Add variant"}
                </Button>
              </div>
              <p className="text-xs text-[var(--fm-text-muted)]">
                Shared inventory consumption is calculated automatically from the selected unit and
                amount.
              </p>
            </form>
          ) : null}
          {product.skus.length === 0 ? (
            <p className="p-5 text-sm text-[var(--fm-text-muted)]">No sell variants defined.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU code</TableHead>
                  <TableHead>Display name</TableHead>
                  <TableHead>Inventory consumed</TableHead>
                  <TableHead>Shipping weight</TableHead>
                  <TableHead>Catalog status</TableHead>
                  {canManageProduct ? <TableHead>Actions</TableHead> : null}
                  {product.scope.kind === "LOCATION" ? <TableHead>Price</TableHead> : null}
                  {product.scope.kind === "LOCATION" ? <TableHead>Selling status</TableHead> : null}
                  {product.scope.kind === "LOCATION" ? <TableHead>Stock status</TableHead> : null}
                  {product.scope.kind === "LOCATION" ? (
                    <TableHead>Location commands</TableHead>
                  ) : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {product.skus.map((sku) => (
                  <TableRow key={sku.skuId}>
                    <TableCell className="font-mono text-xs">{sku.code}</TableCell>
                    <TableCell>
                      {sku.name}
                      {sku.merchandisingLabel ? (
                        <span className="ml-1 text-xs text-[var(--fm-text-muted)]">
                          ({sku.merchandisingLabel})
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      {sku.consumptionBaseQuantity.toLocaleString()}{" "}
                      {countedSizes ? "pieces/packs" : product.inventoryPool.baseUnitSymbol}
                    </TableCell>
                    <TableCell>
                      {variantBaseUnitCode === "GRAM"
                        ? `${sku.consumptionBaseQuantity.toLocaleString()} g`
                        : sku.estimatedShippingWeightGrams === null
                          ? "Not configured"
                          : `${sku.estimatedShippingWeightGrams.toLocaleString()} g each`}
                    </TableCell>
                    <TableCell>
                      <StatusBadge tone={sku.status === "active" ? "success" : "neutral"}>
                        {sku.status === "active" ? "Active" : "Inactive"}
                      </StatusBadge>
                    </TableCell>
                    {canManageProduct ? (
                      <TableCell>
                        <SkuVariantEditor
                          sku={sku}
                          baseUnitCode={variantBaseUnitCode}
                          disabled={commandIntent.pending}
                          onSaved={() => {
                            setNotice("Variant saved.");
                            load();
                          }}
                        />
                      </TableCell>
                    ) : null}
                    {product.scope.kind === "LOCATION" ? (
                      <TableCell className="text-xs">
                        {sku.priceMinor === null || !sku.currency
                          ? "—"
                          : `${new Intl.NumberFormat(undefined, {
                              style: "currency",
                              currency: sku.currency,
                            }).format(sku.priceMinor / 100)} (v${sku.priceVersion})`}
                      </TableCell>
                    ) : null}
                    {product.scope.kind === "LOCATION" ? (
                      <TableCell>
                        <StatusBadge
                          tone={sku.availability === "AVAILABLE" ? "success" : "neutral"}
                        >
                          {sku.availability === "AVAILABLE"
                            ? "Selling"
                            : sku.availability === "UNAVAILABLE"
                              ? "Not selling"
                              : "Not configured"}
                        </StatusBadge>
                        <span className="block text-xs text-[var(--fm-text-muted)]">
                          {product.scope.locationName}
                        </span>
                      </TableCell>
                    ) : null}
                    {product.scope.kind === "LOCATION" ? (
                      <TableCell>
                        {product.inventoryPool.position ? (
                          <StatusBadge
                            tone={
                              (sku.availableBase ?? product.inventoryPool.position.availableBase) >=
                              sku.consumptionBaseQuantity
                                ? "success"
                                : "neutral"
                            }
                          >
                            {(sku.availableBase ?? product.inventoryPool.position.availableBase) >=
                            sku.consumptionBaseQuantity
                              ? "In stock"
                              : "Insufficient stock"}
                          </StatusBadge>
                        ) : (
                          <span className="text-xs text-[var(--fm-text-muted)]">
                            No stock recorded
                          </span>
                        )}
                      </TableCell>
                    ) : null}
                    {product.scope.kind === "LOCATION" ? (
                      <TableCell>
                        {canManageTarget ? (
                          <span className="flex flex-wrap items-center gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={selectedTarget?.kind !== "location"}
                              onClick={() => {
                                if (selectedTarget?.kind !== "location") {
                                  setNotice(
                                    "A location context is required to change selling status.",
                                  );
                                  return;
                                }
                                setVariantCommand({
                                  kind: "AVAILABILITY",
                                  skuId: sku.skuId,
                                  skuCode: sku.code,
                                  locationId: selectedTarget.locationId,
                                  availabilityStatus:
                                    sku.availability === "AVAILABLE" ? "UNAVAILABLE" : "AVAILABLE",
                                  expectedVersion: sku.availabilityVersion ?? 0,
                                  targetLabel: selectedTarget.locationName,
                                });
                              }}
                            >
                              {sku.availability === "AVAILABLE"
                                ? "Review stop selling"
                                : "Review start selling"}
                            </Button>
                          </span>
                        ) : (
                          <span className="text-xs text-[var(--fm-text-muted)]">Read only</span>
                        )}
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </ListPageSection>
      </div>
      <div id="product-audit" className="scroll-mt-32">
        <ListPageSection title="Recent audit">
          {product.recentAudit.length ? (
            <ol className="divide-y divide-[var(--fm-border)]">
              {product.recentAudit.map((audit) => (
                <li key={audit.auditEventId} className="p-4 text-sm">
                  <span className="font-medium">{audit.action}</span>
                  <span className="block text-[var(--fm-text-muted)]">
                    {new Date(audit.occurredAt).toLocaleString()} ·{" "}
                    {audit.correlationId ?? "No request reference"}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="p-5 text-sm text-[var(--fm-text-muted)]">No audit events recorded.</p>
          )}
        </ListPageSection>
      </div>
      <ConfirmCommandDialog
        open={confirmingStatus}
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
        onCancel={() => setConfirmingStatus(false)}
        onConfirm={(confirmedReason) => {
          setConfirmingStatus(false);
          void run(`${BASE}/products/${encodeURIComponent(productId)}/status`, "POST", {
            status: product.status === "active" ? "inactive" : "active",
            reason: confirmedReason,
            expectedVersion: product.version,
          });
        }}
      />
      <ConfirmCommandDialog
        open={variantCommand !== null}
        title="Change selling status?"
        resource={variantCommand?.skuCode ?? "Sell variant"}
        scope={variantCommand?.targetLabel ?? "Catalog target"}
        consequence={`This sets ${variantCommand?.availabilityStatus ?? "selling status"} for this location.`}
        reasonRequired={false}
        confirmLabel="Confirm selling status"
        pending={commandIntent.pending}
        onCancel={() => setVariantCommand(null)}
        onConfirm={() => {
          const pendingCommand = variantCommand;
          setVariantCommand(null);
          if (!pendingCommand) return;
          void run(
            `${BASE}/skus/${encodeURIComponent(pendingCommand.skuId)}/availability`,
            "PUT",
            {
              locationId: pendingCommand.locationId,
              availabilityStatus: pendingCommand.availabilityStatus,
              expectedVersion: pendingCommand.expectedVersion,
            },
            "Availability updated.",
          );
        }}
      />
    </div>
  );
}
