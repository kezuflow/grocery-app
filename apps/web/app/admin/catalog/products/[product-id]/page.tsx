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

type LoadState =
  | { phase: "loading" }
  | { phase: "error"; message: string; requestId: string | null }
  | { phase: "ready"; product: AdminProductDetail; units: AdminUnitSummary[] };

const BASE = "/api/admin/catalog";

export default function ProductDetailPage({
  params,
}: {
  params: Promise<{ "product-id": string }>;
}) {
  const { "product-id": productId } = use(params);
  const searchParams = useSearchParams();
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const [reason, setReason] = useState("");
  const [confirmingStatus, setConfirmingStatus] = useState(false);
  const [mediaToRemove, setMediaToRemove] = useState<AdminProductMediaView | null>(null);
  const statusCancelRef = useRef<HTMLButtonElement>(null);
  const mediaRemoveCancelRef = useRef<HTMLButtonElement>(null);
  const [newSku, setNewSku] = useState({
    code: "",
    name: "",
    unitId: "",
    sellQuantity: "",
    consumption: "",
  });
  const [priceBySku, setPriceBySku] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(
    searchParams.get("created")
      ? "Product created."
      : searchParams.get("updated")
        ? "Product updated."
        : null,
  );
  const commandIntent = useAdminCommandIntent();

  const load = useCallback(() => {
    setState({ phase: "loading" });
    void (async () => {
      try {
        const [productResponse, unitsResponse] = await Promise.all([
          fetch(`${BASE}/products/${encodeURIComponent(productId)}`),
          fetch(`${BASE}/units`),
        ]);
        const productPayload = (await productResponse.json()) as RpcResult<AdminProductDetail>;
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
        setState({
          phase: "error",
          message: "Network error loading the product.",
          requestId: null,
        });
      }
    })();
  }, [productId]);

  useEffect(() => load(), [load]);
  useEffect(() => {
    if (confirmingStatus) statusCancelRef.current?.focus();
  }, [confirmingStatus]);
  useEffect(() => {
    if (mediaToRemove) mediaRemoveCancelRef.current?.focus();
  }, [mediaToRemove]);

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
      <nav className="text-sm text-[var(--fm-text-muted)]">
        <Link className="underline" href={`/admin/catalog/products${from ? `?${from}` : ""}`}>
          Products
        </Link>{" "}
        / {product.name}
      </nav>
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
                      onClick={() => setMediaToRemove(media)}
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
      {mediaToRemove ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4"
          onKeyDown={(event) => {
            if (event.key === "Escape") setMediaToRemove(null);
          }}
        >
          <section
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="media-removal-title"
            aria-describedby="media-removal-description"
            className="w-full max-w-md rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-white p-6 shadow-xl"
          >
            <h2 id="media-removal-title" className="text-lg font-semibold">
              Remove {mediaToRemove.altText}?
            </h2>
            <p id="media-removal-description" className="mt-2 text-sm text-[var(--fm-text-muted)]">
              This deactivates the canonical attachment before deleting its stored image. The image
              disappears from active Product media and cannot be edited afterward.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button
                ref={mediaRemoveCancelRef}
                variant="outline"
                onClick={() => setMediaToRemove(null)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={commandIntent.pending}
                onClick={() => {
                  const media = mediaToRemove;
                  setMediaToRemove(null);
                  void run(
                    `${BASE}/products/${encodeURIComponent(productId)}/media/${encodeURIComponent(media.mediaId)}`,
                    "DELETE",
                    { expectedProductVersion: product.version },
                    "Media removed.",
                  );
                }}
              >
                Confirm media removal
              </Button>
            </div>
          </section>
        </div>
      ) : null}

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
        {product.skus.length === 0 ? (
          <p className="p-5 text-sm text-[var(--fm-text-muted)]">No SKUs defined.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Price</TableHead>
                <TableHead>Availability (Cebu Central)</TableHead>
                <TableHead>Set price ₱</TableHead>
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
                    {sku.priceMinor === null
                      ? "—"
                      : `₱${(sku.priceMinor / 100).toFixed(2)} (v${sku.priceVersion})`}
                  </TableCell>
                  <TableCell>
                    <StatusBadge tone={sku.availability === "AVAILABLE" ? "success" : "neutral"}>
                      {sku.availability ?? "unset"}
                    </StatusBadge>
                  </TableCell>
                  <TableCell>
                    <span className="flex items-center gap-1">
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
                          void run(`${BASE}/skus/${encodeURIComponent(sku.skuId)}/price`, "POST", {
                            marketId: "market-metro-cebu",
                            locationId: null,
                            currency: "PHP",
                            amountMinor: Math.round(pesos * 100),
                            validFrom: Date.now(),
                            expectedVersion: sku.priceVersion ?? 0,
                          });
                        }}
                      >
                        Set
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          void run(
                            `${BASE}/skus/${encodeURIComponent(sku.skuId)}/availability`,
                            "PUT",
                            {
                              locationId: "location-cebu-central",
                              availabilityStatus:
                                sku.availability === "AVAILABLE" ? "UNAVAILABLE" : "AVAILABLE",
                              sourcingMode: "STOCKED",
                              expectedVersion: sku.availabilityVersion ?? 0,
                            },
                          );
                        }}
                      >
                        {sku.availability === "AVAILABLE" ? "Unset" : "Set available"}
                      </Button>
                    </span>
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
      {confirmingStatus ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4"
          onKeyDown={(event) => {
            if (event.key === "Escape") setConfirmingStatus(false);
          }}
        >
          <section
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="product-status-confirmation-title"
            aria-describedby="product-status-confirmation-description"
            className="w-full max-w-md rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-white p-6 shadow-xl"
          >
            <h2 id="product-status-confirmation-title" className="text-lg font-semibold">
              {product.status === "active" ? "Deactivate product?" : "Activate product?"}
            </h2>
            <p
              id="product-status-confirmation-description"
              className="mt-2 text-sm text-[var(--fm-text-muted)]"
            >
              {product.status === "active"
                ? "The Product leaves storefront availability. Variants, prices, inventory history, and committed order snapshots remain intact."
                : "The Product becomes active, while each SKU price and location availability remains independently authoritative."}
            </p>
            <p className="mt-3 rounded bg-[var(--fm-surface-soft)] p-3 text-sm">Reason: {reason}</p>
            <div className="mt-5 flex justify-end gap-2">
              <Button
                ref={statusCancelRef}
                variant="outline"
                onClick={() => setConfirmingStatus(false)}
              >
                Cancel
              </Button>
              <Button
                variant={product.status === "active" ? "destructive" : "default"}
                disabled={commandIntent.pending}
                onClick={() => {
                  setConfirmingStatus(false);
                  void run(`${BASE}/products/${encodeURIComponent(productId)}/status`, "POST", {
                    status: product.status === "active" ? "inactive" : "active",
                    reason: reason.trim(),
                    expectedVersion: product.version,
                  });
                }}
              >
                {product.status === "active" ? "Confirm deactivation" : "Confirm activation"}
              </Button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
