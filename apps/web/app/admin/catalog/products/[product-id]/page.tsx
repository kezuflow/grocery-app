"use client";
import { useCallback, useEffect, useRef, useState, use } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { AdminProductDetail, AdminUnitSummary, RpcResult } from "@freshmarkets/contracts";
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
  const statusCancelRef = useRef<HTMLButtonElement>(null);
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

  async function run(url: string, method: "POST" | "PATCH" | "PUT", body: unknown) {
    const payload = await commandIntent.submit(async (idempotencyKey) => {
      const response = await fetch(url, {
        method,
        headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
        body: JSON.stringify(body),
      });
      return (await response.json()) as RpcResult<unknown>;
    });
    setNotice(payload.ok ? "Applied." : (payload.error?.message ?? "The command failed."));
    if (payload.ok || payload.error?.code === "STALE_VERSION") load();
    return payload.ok;
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
            {product.allowedActions.includes("UPDATE") ? (
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

      <ListPageSection title="Product media">
        {product.media.length ? (
          <ul className="divide-y divide-[var(--fm-border)]">
            {product.media.map((media) => (
              <li key={media.mediaId} className="flex justify-between p-4 text-sm">
                <span>{media.altText}</span>
                <span>{media.isPrimary ? "Primary" : `Order ${media.sortOrder}`}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="p-5 text-sm text-[var(--fm-text-muted)]">No canonical media attached.</p>
        )}
      </ListPageSection>

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
