"use client";
import { useCallback, useEffect, useState, use } from "react";
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
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const [reason, setReason] = useState("");
  const [newSku, setNewSku] = useState({
    code: "",
    name: "",
    unitId: "",
    sellQuantity: "",
    consumption: "",
  });
  const [priceBySku, setPriceBySku] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);

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

  async function run(url: string, method: "POST" | "PATCH" | "PUT", body: unknown) {
    const response = await fetch(url, {
      method,
      headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify(body),
    });
    const payload = (await response.json()) as RpcResult<unknown> & {
      error?: { message?: string };
    };
    setNotice(payload.ok ? "Applied." : (payload.error?.message ?? "The command failed."));
    if (payload.ok) load();
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

  return (
    <div className="mx-auto max-w-[1280px] space-y-6">
      <PageHeader
        title={product.name}
        description={`${product.categoryName} · ${product.slug}`}
        action={
          <StatusBadge tone={product.status === "active" ? "success" : "neutral"}>
            {product.status}
          </StatusBadge>
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

      <ListPageSection
        title="Product status"
        description="Inactive products leave all storefront surfaces."
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
              void run(`${BASE}/products/${encodeURIComponent(productId)}/status`, "POST", {
                status: product.status === "active" ? "inactive" : "active",
                reason: reason.trim(),
                expectedVersion: 1,
              });
            }}
          >
            {product.status === "active" ? "Deactivate" : "Activate"}
          </Button>
        </div>
      </ListPageSection>

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
                            currency: "PHP",
                            amountMinor: Math.round(pesos * 100),
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
                              expectedVersion: 1,
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
    </div>
  );
}
