"use client";
import { useCallback, useEffect, useRef, useState, use } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type {
  AdminProductDetail,
  AdminProductMediaView,
  AdminUnitSummary,
  RpcResult,
  SourcingMode,
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

type SkuCommandConfirmation =
  | {
      kind: "PRICE";
      skuId: string;
      skuCode: string;
      amountMinor: number;
      expectedVersion: number;
      marketId: string;
      locationId: string | null;
      currency: string;
      targetLabel: string;
    }
  | {
      kind: "AVAILABILITY";
      skuId: string;
      skuCode: string;
      availabilityStatus: "AVAILABLE" | "UNAVAILABLE";
      sourcingMode: SourcingMode;
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
  const [catalogTarget, setCatalogTarget] = useState("");
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
    consumption: "",
  });
  const [priceBySku, setPriceBySku] = useState<Record<string, string>>({});
  const [sourcingBySku, setSourcingBySku] = useState<Record<string, SourcingMode>>({});
  const [skuCommand, setSkuCommand] = useState<SkuCommandConfirmation | null>(null);
  const [notice, setNotice] = useState<string | null>(
    searchParams.get("created")
      ? "Product created."
      : searchParams.get("updated")
        ? "Product updated."
        : null,
  );
  const commandIntent = useAdminCommandIntent();
  const targetOptions = adminContext.state.phase === "ready" ? adminContext.state.scopes : [];
  const selectedTarget = targetOptions.find((option) =>
    option.kind === "market"
      ? catalogTarget === `market:${option.marketId}`
      : catalogTarget === `location:${option.locationId}`,
  );
  const selectedMarketId = selectedTarget?.marketId;
  const selectedLocationId = selectedTarget?.kind === "location" ? selectedTarget.locationId : null;

  useEffect(() => {
    if (adminContext.state.phase !== "ready") return;
    const selected = adminContext.state.selectedScope;
    if (selected?.kind === "MARKET") setCatalogTarget(`market:${selected.marketId}`);
    else if (selected?.kind === "LOCATION") setCatalogTarget(`location:${selected.locationId}`);
  }, [adminContext.state]);

  const load = useCallback(() => {
    const requestNumber = loadRequest.current + 1;
    loadRequest.current = requestNumber;
    setState({ phase: "loading" });
    void (async () => {
      try {
        const [productResponse, unitsResponse] = await Promise.all([
          fetch(
            `${BASE}/products/${encodeURIComponent(productId)}${
              selectedMarketId
                ? `?marketId=${encodeURIComponent(selectedMarketId)}${
                    selectedLocationId
                      ? `&locationId=${encodeURIComponent(selectedLocationId)}`
                      : ""
                  }`
                : ""
            }`,
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
  }, [productId, selectedLocationId, selectedMarketId]);

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

  return (
    <div className="mx-auto max-w-[1280px] space-y-6">
      <PageHeader
        title={product.name}
        description={`${product.categoryName} · ${product.slug}`}
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

      <ProductDetailSummary product={product} />

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-white p-5 lg:col-span-2">
          <h2 className="font-semibold">Customer-facing details</h2>
          {product.description ? (
            <p className="mt-3 text-sm">{product.description}</p>
          ) : (
            <p className="mt-3 text-sm text-[var(--fm-text-muted)]">No description provided.</p>
          )}
          {product.customerDetails.length ? (
            <dl className="mt-4 grid gap-3 sm:grid-cols-2">
              {product.customerDetails.map((detail) => (
                <div key={detail.detailId}>
                  <dt className="text-xs font-semibold text-[var(--fm-text-muted)]">
                    {detail.label}
                  </dt>
                  <dd className="text-sm">{detail.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </section>
        <section className="rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-white p-5">
          <h2 className="font-semibold">Inventory pool</h2>
          <p className="mt-2 text-sm">
            Base unit: {product.inventoryPool.baseUnitCode} ({product.inventoryPool.baseUnitSymbol})
          </p>
          <p className="mt-1 font-mono text-xs text-[var(--fm-text-muted)]">
            {product.inventoryPool.inventoryPoolId}
          </p>
        </section>
      </div>

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
              <Input name="sortOrder" type="number" min={0} max={10000} defaultValue={0} required />
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
                      <Input name="altText" defaultValue={media.altText} maxLength={300} required />
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
      ) : null}

      <ListPageSection
        title="SKUs"
        description="Fixed variants with exact base-unit consumption. Prices are versioned; availability is per location."
      >
        {canManageProduct ? (
          <div className="grid gap-1 border-b border-[var(--fm-border)] p-4 text-sm font-medium sm:max-w-md">
            <label htmlFor="catalog-command-target">Catalog command target</label>
            <select
              id="catalog-command-target"
              value={catalogTarget}
              onChange={(event) => setCatalogTarget(event.target.value)}
              className="h-10 rounded-[var(--fm-radius-control)] border border-[var(--fm-border)] bg-white px-3 text-sm"
            >
              <option value="">Select a market or location…</option>
              {targetOptions.map((option) => (
                <option
                  key={
                    option.kind === "market"
                      ? `market:${option.marketId}`
                      : `location:${option.locationId}`
                  }
                  value={
                    option.kind === "market"
                      ? `market:${option.marketId}`
                      : `location:${option.locationId}`
                  }
                >
                  {option.kind === "market"
                    ? `${option.marketName} · market prices`
                    : `${option.locationName} · location prices and availability`}
                </option>
              ))}
            </select>
            <span className="text-xs font-normal text-[var(--fm-text-muted)]">
              Price and availability commands apply only to this explicit Core-authorized target.
            </span>
          </div>
        ) : null}
        {canManageProduct ? (
          <form
            className="flex flex-col gap-2 border-b border-[var(--fm-border)] p-4 sm:flex-row sm:items-center"
            onSubmit={(event) => {
              event.preventDefault();
              const unit = units.find((candidate) => candidate.unitId === newSku.unitId);
              if (
                newSku.code.trim() === "" ||
                newSku.name.trim() === "" ||
                !unit ||
                Number.isNaN(Number(newSku.sellQuantity)) ||
                Number.isNaN(Number(newSku.consumption))
              ) {
                setNotice("Code, name, unit, sell quantity, and base consumption are required.");
                return;
              }
              void run(`${BASE}/skus`, "POST", {
                productId,
                code: newSku.code.trim().toUpperCase(),
                name: newSku.name.trim(),
                sellableUnitId: unit.unitId,
                sellQuantity: Math.round(Number(newSku.sellQuantity)),
                consumptionBaseQuantity: Math.round(Number(newSku.consumption)),
              });
            }}
          >
            <Input
              aria-label="SKU code"
              placeholder="CODE"
              value={newSku.code}
              onChange={(event) => setNewSku({ ...newSku, code: event.target.value })}
              className="sm:w-40"
            />
            <Input
              aria-label="SKU name"
              placeholder="e.g. 250 g"
              value={newSku.name}
              onChange={(event) => setNewSku({ ...newSku, name: event.target.value })}
              className="sm:w-32"
            />
            <select
              aria-label="Sellable unit"
              value={newSku.unitId}
              onChange={(event) => setNewSku({ ...newSku, unitId: event.target.value })}
              className="h-10 rounded-[var(--fm-radius-control)] border border-[var(--fm-border)] bg-white px-3 text-sm"
            >
              <option value="">unit…</option>
              {units.map((unit) => (
                <option key={unit.unitId} value={unit.unitId}>
                  {unit.code} ({unit.dimension})
                </option>
              ))}
            </select>
            <Input
              aria-label="Sell quantity"
              placeholder="sell qty"
              value={newSku.sellQuantity}
              onChange={(event) => setNewSku({ ...newSku, sellQuantity: event.target.value })}
              className="sm:w-24"
            />
            <Input
              aria-label="Base consumption"
              placeholder="base qty"
              value={newSku.consumption}
              onChange={(event) => setNewSku({ ...newSku, consumption: event.target.value })}
              className="sm:w-28"
            />
            <Button type="submit" size="sm">
              Add SKU
            </Button>
          </form>
        ) : null}
        {product.skus.length === 0 ? (
          <p className="p-5 text-sm text-[var(--fm-text-muted)]">No SKUs defined.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Price</TableHead>
                <TableHead>Availability</TableHead>
                <TableHead>Targeted commands</TableHead>
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
                  <TableCell className="text-xs">
                    {sku.priceMinor === null || !sku.currency
                      ? "—"
                      : `${new Intl.NumberFormat(undefined, {
                          style: "currency",
                          currency: sku.currency,
                        }).format(sku.priceMinor / 100)} (v${sku.priceVersion})`}
                  </TableCell>
                  <TableCell>
                    <StatusBadge tone={sku.availability === "AVAILABLE" ? "success" : "neutral"}>
                      {sku.availability ?? "unset"}
                    </StatusBadge>
                    {product.pricingContext.locationId ? (
                      <span className="block text-xs text-[var(--fm-text-muted)]">
                        {product.pricingContext.locationId}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    {canManageProduct ? (
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
                            if (!selectedTarget || !selectedMarketId) {
                              setNotice("Select an explicit market or location target.");
                              return;
                            }
                            setSkuCommand({
                              kind: "PRICE",
                              skuId: sku.skuId,
                              skuCode: sku.code,
                              marketId: selectedMarketId,
                              locationId: selectedLocationId,
                              currency: selectedTarget.currency,
                              amountMinor: Math.round(pesos * 100),
                              expectedVersion: sku.priceVersion ?? 0,
                              targetLabel:
                                selectedTarget.kind === "market"
                                  ? selectedTarget.marketName
                                  : selectedTarget.locationName,
                            });
                          }}
                        >
                          Review price
                        </Button>
                        <select
                          aria-label={`Sourcing mode for ${sku.code}`}
                          value={sourcingBySku[sku.skuId] ?? sku.sourcingMode ?? "STOCKED"}
                          onChange={(event) =>
                            setSourcingBySku({
                              ...sourcingBySku,
                              [sku.skuId]: event.target.value as SourcingMode,
                            })
                          }
                          className="h-9 rounded-[var(--fm-radius-control)] border border-[var(--fm-border)] bg-white px-2 text-xs"
                        >
                          <option value="STOCKED">Stocked</option>
                          <option value="PLANNED">Planned</option>
                          <option value="ON_DEMAND">On demand</option>
                          <option value="MIXED">Mixed</option>
                        </select>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={selectedTarget?.kind !== "location"}
                          onClick={() => {
                            if (selectedTarget?.kind !== "location") {
                              setNotice("Select a location target for availability.");
                              return;
                            }
                            setSkuCommand({
                              kind: "AVAILABILITY",
                              skuId: sku.skuId,
                              skuCode: sku.code,
                              locationId: selectedTarget.locationId,
                              availabilityStatus:
                                sku.availability === "AVAILABLE" ? "UNAVAILABLE" : "AVAILABLE",
                              sourcingMode:
                                sourcingBySku[sku.skuId] ?? sku.sourcingMode ?? "STOCKED",
                              expectedVersion: sku.availabilityVersion ?? 0,
                              targetLabel: selectedTarget.locationName,
                            });
                          }}
                        >
                          {sku.availability === "AVAILABLE"
                            ? "Review unavailable"
                            : "Review available"}
                        </Button>
                      </span>
                    ) : (
                      <span className="text-xs text-[var(--fm-text-muted)]">Read only</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </ListPageSection>
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
      <ConfirmCommandDialog
        open={confirmingStatus}
        title={product.status === "active" ? "Deactivate product?" : "Activate product?"}
        resource={`${product.name} · version ${product.version}`}
        scope="Global Catalog"
        consequence={
          product.status === "active"
            ? "The Product leaves storefront availability. Variants, prices, inventory history, and committed order snapshots remain intact."
            : "The Product becomes active, while each SKU price and location availability remains independently authoritative."
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
        open={skuCommand !== null}
        title={skuCommand?.kind === "PRICE" ? "Set SKU price?" : "Change SKU availability?"}
        resource={skuCommand?.skuCode ?? "SKU"}
        scope={skuCommand?.targetLabel ?? "Catalog target"}
        consequence={
          skuCommand?.kind === "PRICE"
            ? `This creates a new ${skuCommand.currency} price version for exactly ${skuCommand.amountMinor} minor units.`
            : `This sets ${skuCommand?.availabilityStatus ?? "availability"} with ${skuCommand?.sourcingMode ?? "the selected"} sourcing at this location.`
        }
        reasonRequired={false}
        confirmLabel={skuCommand?.kind === "PRICE" ? "Confirm price" : "Confirm availability"}
        pending={commandIntent.pending}
        onCancel={() => setSkuCommand(null)}
        onConfirm={() => {
          const pendingCommand = skuCommand;
          setSkuCommand(null);
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
                sourcingMode: pendingCommand.sourcingMode,
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
