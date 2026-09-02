"use client";
import { useCallback, useEffect, useRef, useState, use } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type {
  AdminProductDetail,
  AdminProductMediaView,
  AdminUnitSummary,
  RpcResult,
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
import { useAdminCommandIntent } from "../../../../../components/admin/admin-command-state";
import { ConfirmCommandDialog } from "../../../../../components/admin/admin-controls";
import { ProductDetailSummary } from "../../../../../components/admin/product-detail-summary";
import { useAdminContext } from "../../../admin-context-provider";

type LoadState =
  | { phase: "loading" }
  | { phase: "error"; message: string; requestId: string | null }
  | { phase: "ready"; product: AdminProductDetail; units: AdminUnitSummary[] };

const BASE = "/api/admin/catalog";

type VariantCommandConfirmation =
  | {
      kind: "PRICE";
      skuId: string;
      skuCode: string;
      amountMinor: number;
      expectedVersion: number;
      marketId: string;
      locationId: string;
      currency: string;
      targetLabel: string;
    }
  | {
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
  });
  const [priceBySku, setPriceBySku] = useState<Record<string, string>>({});
  const [variantCommand, setVariantCommand] = useState<VariantCommandConfirmation | null>(null);
  const [notice, setNotice] = useState<string | null>(
    searchParams.get("created")
      ? "Product created."
      : searchParams.get("updated")
        ? "Product updated."
        : null,
  );
  const commandIntent = useAdminCommandIntent();
  const targetOptions = adminContext.state.phase === "ready" ? adminContext.state.scopes : [];
  const selectedScope =
    adminContext.state.phase === "ready" ? adminContext.state.selectedScope : null;
  const selectedTarget =
    selectedScope?.kind === "LOCATION"
      ? targetOptions.find(
          (option) => option.kind === "location" && option.locationId === selectedScope.locationId,
        )
      : null;
  const selectedLocationTarget = selectedTarget?.kind === "location" ? selectedTarget : null;
  const selectedMarketId = selectedScope?.kind === "LOCATION" ? selectedScope.marketId : null;
  const selectedLocationId = selectedScope?.kind === "LOCATION" ? selectedScope.locationId : null;
  const selectedCurrency = selectedLocationTarget?.currency;
  const selectedTargetLabel = selectedLocationTarget?.locationName ?? "Global catalog";

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
        const productPayload = (await productResponse.json()) as RpcResult<AdminProductDetail>;
        if (loadRequest.current !== requestNumber) return;
        if (!productPayload.ok) {
          setState({
            phase: "error",
            message: productPayload.error.message,
            requestId: productPayload.error.requestId,
          });
          return;
        }
        const unitsPayload = (await unitsResponse.json()) as RpcResult<AdminUnitSummary[]>;
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
    const payload = await commandIntent.submit(async (idempotencyKey) => {
      const response = await fetch(url, {
        method,
        headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
        body: JSON.stringify(body),
      });
      return (await response.json()) as RpcResult<unknown>;
    });
    setNotice(payload.ok ? successMessage : (payload.error?.message ?? "The command failed."));
    if (payload.ok || payload.error?.code === "STALE_VERSION") load();
    return payload.ok;
  }

  async function uploadMedia(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const file = fields.get("file");
    const altText = fields.get("altText");
    if (
      !(file instanceof File) ||
      file.size === 0 ||
      typeof altText !== "string" ||
      !altText.trim()
    ) {
      setNotice("An image and alt text are required.");
      return;
    }
    fields.set("expectedProductVersion", String(product.version));
    const payload = await commandIntent.submit(async (idempotencyKey) => {
      const response = await fetch(`${BASE}/products/${encodeURIComponent(productId)}/media`, {
        method: "POST",
        headers: { "idempotency-key": idempotencyKey },
        body: fields,
      });
      return (await response.json()) as RpcResult<AdminProductMediaView>;
    });
    setNotice(payload.ok ? "Media uploaded." : payload.error.message);
    if (payload.ok) form.reset();
    if (payload.ok || payload.error.code === "STALE_VERSION") load();
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
        description={`${product.categoryName} · ${product.skus.length} sell variant${product.skus.length === 1 ? "" : "s"} · shared ${product.inventoryPool.baseUnitCode} inventory`}
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

      {notice ? (
        <p
          role="status"
          className="rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-white p-3 text-sm"
        >
          {notice}
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
        <ProductDetailSummary product={product} />
      </div>

      <div id="product-media" className="scroll-mt-32">
        <ListPageSection
          title="Product media"
          description="Canonical images are validated in Core, stored in R2, and attached through guarded Product versions."
        >
          {canManageProduct ? (
            <form
              className="grid gap-3 border-b border-[var(--fm-border)] p-4 md:grid-cols-[minmax(12rem,1fr)_minmax(12rem,1fr)_7rem_8rem_auto] md:items-end"
              onSubmit={uploadMedia}
            >
              <label className="grid gap-1 text-sm font-medium">
                Product media image
                <Input name="file" type="file" accept="image/jpeg,image/png,image/webp" required />
              </label>
              <label className="grid gap-1 text-sm font-medium">
                Media alt text
                <Input name="altText" maxLength={300} required />
              </label>
              <label className="grid gap-1 text-sm font-medium">
                Media sort order
                <Input
                  name="sortOrder"
                  type="number"
                  min={0}
                  max={10000}
                  defaultValue={0}
                  required
                />
              </label>
              <label className="flex h-10 items-center gap-2 text-sm font-medium">
                <input name="isPrimary" type="checkbox" value="true" />
                Primary image
              </label>
              <input name="isPrimary" type="hidden" value="false" />
              <Button type="submit" disabled={commandIntent.pending}>
                Upload media
              </Button>
            </form>
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
                placeholder="reason (required)"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                className="sm:w-72"
              />
              <Button
                ref={statusTrigger}
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
                const unit = units.find((candidate) => candidate.unitId === newSku.unitId);
                if (
                  newSku.code.trim() === "" ||
                  newSku.name.trim() === "" ||
                  !unit ||
                  Number.isNaN(Number(newSku.sellQuantity))
                ) {
                  setNotice("SKU code, display name, unit, and amount are required.");
                  return;
                }
                const convertedNumerator =
                  Math.round(Number(newSku.sellQuantity)) * unit.conversionNumerator;
                if (convertedNumerator % unit.conversionDenominator !== 0) {
                  setNotice("This amount does not convert to an exact base inventory unit.");
                  return;
                }
                void run(`${BASE}/skus`, "POST", {
                  productId,
                  code: newSku.code.trim().toUpperCase(),
                  name: newSku.name.trim(),
                  sellableUnitId: unit.unitId,
                  sellQuantity: Math.round(Number(newSku.sellQuantity)),
                  consumptionBaseQuantity: convertedNumerator / unit.conversionDenominator,
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
                    placeholder="ZUCCHINI-250G"
                    value={newSku.code}
                    onChange={(event) => setNewSku({ ...newSku, code: event.target.value })}
                  />
                </label>
                <label className="grid gap-1 text-sm font-medium">
                  Display name
                  <span className="text-xs font-normal text-[var(--fm-text-muted)]">
                    Customer-facing choice
                  </span>
                  <Input
                    aria-label="Display name"
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
                    value={newSku.unitId}
                    onChange={(event) => setNewSku({ ...newSku, unitId: event.target.value })}
                    className="h-10 rounded-[var(--fm-radius-control)] border border-[var(--fm-border)] bg-white px-3 text-sm"
                  >
                    <option value="">Select unit</option>
                    {units.map((unit) => (
                      <option key={unit.unitId} value={unit.unitId}>
                        {unit.displayName}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1 text-sm font-medium">
                  Amount
                  <span className="text-xs font-normal text-[var(--fm-text-muted)]">
                    Number in this unit
                  </span>
                  <Input
                    aria-label="Amount"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    step={1}
                    placeholder="250"
                    value={newSku.sellQuantity}
                    onChange={(event) => setNewSku({ ...newSku, sellQuantity: event.target.value })}
                  />
                </label>
                <Button type="submit" size="sm" className="sm:col-span-2 lg:col-span-1">
                  Add variant
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
                      {product.inventoryPool.baseUnitSymbol}
                    </TableCell>
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
                              product.inventoryPool.position.availableBase >=
                              sku.consumptionBaseQuantity
                                ? "success"
                                : "neutral"
                            }
                          >
                            {product.inventoryPool.position.availableBase >=
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
                            <Input
                              aria-label={`New price for ${sku.code}`}
                              value={priceBySku[sku.skuId] ?? ""}
                              onChange={(event) =>
                                setPriceBySku({ ...priceBySku, [sku.skuId]: event.target.value })
                              }
                              className="w-24"
                            />
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                const pesos = Number(priceBySku[sku.skuId]);
                                if (Number.isNaN(pesos) || pesos <= 0) {
                                  setNotice("Enter a positive price.");
                                  return;
                                }
                                if (!selectedMarketId || !selectedCurrency || !selectedLocationId) {
                                  setNotice("The selected location price target is unavailable.");
                                  return;
                                }
                                setVariantCommand({
                                  kind: "PRICE",
                                  skuId: sku.skuId,
                                  skuCode: sku.code,
                                  marketId: selectedMarketId,
                                  locationId: selectedLocationId,
                                  currency: selectedCurrency,
                                  amountMinor: Math.round(pesos * 100),
                                  expectedVersion: sku.priceVersion ?? 0,
                                  targetLabel: selectedTargetLabel,
                                });
                              }}
                            >
                              Review price
                            </Button>
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
        title={variantCommand?.kind === "PRICE" ? "Set variant price?" : "Change selling status?"}
        resource={variantCommand?.skuCode ?? "Sell variant"}
        scope={variantCommand?.targetLabel ?? "Catalog target"}
        consequence={
          variantCommand?.kind === "PRICE"
            ? `This creates a new ${variantCommand.currency} price version for exactly ${variantCommand.amountMinor} minor units.`
            : `This sets ${variantCommand?.availabilityStatus ?? "selling status"} for this location.`
        }
        reasonRequired={false}
        confirmLabel={variantCommand?.kind === "PRICE" ? "Confirm price" : "Confirm selling status"}
        pending={commandIntent.pending}
        onCancel={() => setVariantCommand(null)}
        onConfirm={() => {
          const pendingCommand = variantCommand;
          setVariantCommand(null);
          if (!pendingCommand) return;
          if (pendingCommand.kind === "PRICE") {
            void run(
              `${BASE}/skus/${encodeURIComponent(pendingCommand.skuId)}/price`,
              "POST",
              {
                marketId: pendingCommand.marketId,
                locationId: pendingCommand.locationId,
                currency: pendingCommand.currency,
                amountMinor: pendingCommand.amountMinor,
                validFrom: Date.now(),
                expectedVersion: pendingCommand.expectedVersion,
              },
              "Price version created.",
            );
          } else {
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
          }
        }}
      />
    </div>
  );
}
