"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  z,
  inventoryTransferPageSchema,
  inventoryTransferOptionsViewSchema,
  inventoryTransferViewSchema,
} from "@freshmarkets/validation";
import type {
  InventoryTransferOptions,
  InventoryTransferPage,
  InventoryTransferView,
} from "@freshmarkets/contracts";
import { useAdminContext } from "@/app/admin/admin-context-provider";
import { InventoryDistribution } from "./inventory-distribution";
import { Checkbox } from "../ui/checkbox";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { PageHeader } from "./admin-shell";
import { AdminCursorPagination, useAdminPagination } from "./admin-controls";
import { useAdminCommand } from "./use-admin-command";

async function readTransfer<T>(url: string, schema: z.ZodType<T>, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  const result = z
    .discriminatedUnion("ok", [
      z.object({ ok: z.literal(true), value: schema }),
      z.object({ ok: z.literal(false), error: z.object({ message: z.string() }) }),
    ])
    .parse(await response.json());
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}
const statusLabel = (value: string) => value.toLowerCase().replaceAll("_", " ");
const units = (value: number, base: "GRAM" | "PIECE") =>
  `${value.toLocaleString("en-PH")} ${base === "GRAM" ? "g" : "pieces"}`;

export function InventoryTransfersPage() {
  const { state } = useAdminContext();
  const scope = state.phase === "ready" ? state.selectedScope : null;
  const scopeKey =
    scope?.kind === "GLOBAL" ? "global" : scope?.kind === "LOCATION" ? scope.locationId : null;
  const [page, setPage] = useState<InventoryTransferPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("ALL");
  const [creating, setCreating] = useState(false);
  const [reload, setReload] = useState(0);
  const pagination = useAdminPagination(`${scopeKey}:${filter}`);
  useEffect(() => {
    setCreating(false);
  }, [scopeKey]);
  useEffect(() => {
    setPage(null);
    setError(null);
    if (!scopeKey) return;
    const controller = new AbortController(),
      params = new URLSearchParams();
    if (scopeKey !== "global") params.set("locationId", scopeKey);
    if (filter !== "ALL") params.set("status", filter);
    if (pagination.cursor) params.set("cursor", pagination.cursor);
    void readTransfer(
      `/api/admin/transfers?${params}`,
      inventoryTransferPageSchema,
      controller.signal,
    )
      .then(setPage)
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setError(error instanceof Error ? error.message : "Unable to load transfers");
      });
    return () => controller.abort();
  }, [scopeKey, filter, pagination.cursor, reload]);
  return (
    <div className="w-full space-y-6">
      <PageHeader
        title="Warehouse transfers"
        description="Dispatch physical stock from the central warehouse. Destinations credit only goods they have checked and accepted."
      />
      {scopeKey === "global" ? <InventoryDistribution key={reload} /> : null}
      {!scopeKey ? (
        <p>Select a Global or location scope to view transfers.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-60 space-y-2">
              <Label htmlFor="transfer-status">Status</Label>
              <Select value={filter} onValueChange={setFilter}>
                <SelectTrigger id="transfer-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[
                    "ALL",
                    "DRAFT",
                    "IN_TRANSIT",
                    "PARTIALLY_RECEIVED",
                    "RECEIVED",
                    "RESOLVED",
                    "CANCELED",
                  ].map((status) => (
                    <SelectItem key={status} value={status}>
                      {statusLabel(status)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {page?.canCreate && scopeKey === "global" ? (
              <Button onClick={() => setCreating(true)}>Create transfer</Button>
            ) : null}
            <Button variant="outline" onClick={() => setReload((value) => value + 1)}>
              Refresh
            </Button>
          </div>
          {creating ? (
            <CreateTransfer
              onCreated={() => {
                setCreating(false);
                setReload((value) => value + 1);
              }}
            />
          ) : null}
          {error ? (
            <p role="alert">{error}</p>
          ) : !page ? (
            <p role="status">Loading transfers…</p>
          ) : (
            <>
              {!page.items.length ? (
                <p>No transfers match this scope and status.</p>
              ) : (
                <div className="overflow-x-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Movement</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Products</TableHead>
                        <TableHead>Created</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {page.items.map((item) => (
                        <TableRow key={item.transferId}>
                          <TableCell>
                            <Link
                              className="font-medium underline"
                              href={`/admin/transfers/${item.transferId}`}
                            >
                              {item.sourceLocationName} → {item.destinationLocationName}
                            </Link>
                          </TableCell>
                          <TableCell className="capitalize">{statusLabel(item.status)}</TableCell>
                          <TableCell>{item.lineCount}</TableCell>
                          <TableCell>
                            {new Date(item.createdAt).toLocaleString("en-PH", {
                              timeZone: "Asia/Manila",
                            })}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              <AdminCursorPagination
                pageNumber={pagination.pageNumber}
                nextCursor={page.nextCursor}
                onPrevious={pagination.previous}
                onNext={pagination.next}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}

function CreateTransfer({ onCreated }: { onCreated: () => void }) {
  const [source, setSource] = useState(""),
    [destination, setDestination] = useState(""),
    [query, setQuery] = useState(""),
    [search, setSearch] = useState("");
  const [options, setOptions] = useState<InventoryTransferOptions | null>(null),
    [error, setError] = useState<string | null>(null);
  const [quantities, setQuantities] = useState<
    Record<string, { product: InventoryTransferOptions["products"][number]; quantity: string }>
  >({});
  const [reason, setReason] = useState("");
  const command = useAdminCommand();
  useEffect(() => {
    const controller = new AbortController(),
      params = new URLSearchParams({ query: search });
    if (source) params.set("sourceLocationId", source);
    setOptions(null);
    setError(null);
    void readTransfer(
      `/api/admin/transfers/options?${params}`,
      inventoryTransferOptionsViewSchema,
      controller.signal,
    )
      .then(setOptions)
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setError(error instanceof Error ? error.message : "Unable to load transfer choices");
      });
    return () => controller.abort();
  }, [source, search]);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const body = {
      sourceLocationId: source,
      destinationLocationId: destination,
      reason,
      lines: Object.values(quantities)
        .filter((line) => Number(line.quantity) > 0)
        .map((line) => ({
          inventoryPoolId: line.product.inventoryPoolId,
          quantityBase: Number(line.quantity),
        })),
    };
    if (
      await (command.uncertain
        ? command.retry()
        : command.run("create-transfer", "/api/admin/transfers", body))
    )
      onCreated();
  }
  const frozen = command.busy || command.uncertain;
  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="space-y-4 rounded-lg border p-4"
      aria-label="Create warehouse transfer"
    >
      <h2 className="text-lg font-semibold">New warehouse transfer</h2>
      {error ? <p role="alert">{error}</p> : null}
      <fieldset disabled={frozen} className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="transfer-source">Source warehouse</Label>
            <Select
              disabled={frozen || !options}
              value={source}
              onValueChange={(value) => {
                setSource(value);
                setQuantities({});
              }}
            >
              <SelectTrigger id="transfer-source">
                <SelectValue placeholder="Select warehouse" />
              </SelectTrigger>
              <SelectContent>
                {options?.sources.map((item) => (
                  <SelectItem key={item.locationId} value={item.locationId}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="transfer-destination">Destination</Label>
            <Select
              disabled={frozen || !options}
              value={destination}
              onValueChange={setDestination}
            >
              <SelectTrigger id="transfer-destination">
                <SelectValue placeholder="Select destination" />
              </SelectTrigger>
              <SelectContent>
                {options?.destinations.map((item) => (
                  <SelectItem key={item.locationId} value={item.locationId}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {options && !options.sources.length ? (
          <p>
            No active warehouse is available. Configure its receiving and inventory capabilities in
            Locations.
          </p>
        ) : null}
        {source ? (
          <>
            <div className="flex items-end gap-2">
              <div className="flex-1 space-y-2">
                <Label htmlFor="transfer-search">Find product</Label>
                <Input
                  id="transfer-search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
              <Button type="button" variant="outline" onClick={() => setSearch(query)}>
                Search
              </Button>
            </div>
            {!options ? (
              <p role="status">Loading products…</p>
            ) : (
              <>
                {options.moreProducts ? (
                  <p>Showing the first 100 matches. Refine the product name to find more.</p>
                ) : null}
                {!options.products.length ? (
                  <p>No matching product pools.</p>
                ) : (
                  <div className="max-h-80 overflow-auto rounded border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Product</TableHead>
                          <TableHead>Available after holds</TableHead>
                          <TableHead>Quantity to send</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {options.products.map((product) => (
                          <TableRow key={product.inventoryPoolId}>
                            <TableCell>{product.productName}</TableCell>
                            <TableCell>{units(product.availableBase, product.baseUnit)}</TableCell>
                            <TableCell>
                              <Input
                                type="number"
                                min="0"
                                step="1"
                                className="w-36"
                                aria-label={`Send ${product.productName} (${product.baseUnit === "GRAM" ? "grams" : "pieces"})`}
                                value={quantities[product.inventoryPoolId]?.quantity ?? ""}
                                onChange={(event) =>
                                  setQuantities((current) => ({
                                    ...current,
                                    [product.inventoryPoolId]: {
                                      product,
                                      quantity: event.target.value,
                                    },
                                  }))
                                }
                              />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </>
            )}
            <p>
              Selected:{" "}
              {Object.values(quantities)
                .filter((line) => Number(line.quantity) > 0)
                .map(
                  (line) =>
                    `${line.product.productName}: ${units(Number(line.quantity), line.product.baseUnit)}`,
                )
                .join("; ") || "No products yet"}
            </p>
          </>
        ) : null}
        <div className="space-y-2">
          <Label htmlFor="transfer-reason">Reason</Label>
          <Input
            id="transfer-reason"
            required
            maxLength={500}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
      </fieldset>
      {command.notice ? <p role="status">{command.notice}</p> : null}
      <Button
        type="submit"
        disabled={command.busy || (!command.uncertain && (!source || !destination))}
      >
        {command.busy ? "Creating…" : "Create draft"}
      </Button>
    </form>
  );
}

export function InventoryTransferDetail({ transferId }: { transferId: string }) {
  const [transfer, setTransfer] = useState<InventoryTransferView | null>(null),
    [error, setError] = useState<string | null>(null),
    [reload, setReload] = useState(0);
  const [quantities, setQuantities] = useState<Record<string, string>>({}),
    [reason, setReason] = useState("");
  const [sizeCounts, setSizeCounts] = useState<Record<string, string>>({});
  const [observations, setObservations] = useState<
    Record<string, { damaged?: string; missing?: string }>
  >({});
  const [resolutionLine, setResolutionLine] = useState(""),
    [resolutionQuantity, setResolutionQuantity] = useState("");
  const [resolutionCategory, setResolutionCategory] = useState("UNCLASSIFIED"),
    [resolutionOutcome, setResolutionOutcome] = useState("LOSS");
  const [inspectionConfirmed, setInspectionConfirmed] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const command = useAdminCommand();
  useEffect(() => {
    const controller = new AbortController();
    setTransfer(null);
    setError(null);
    void readTransfer(
      `/api/admin/transfers/${encodeURIComponent(transferId)}`,
      inventoryTransferViewSchema,
      controller.signal,
    )
      .then(setTransfer)
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setError(error instanceof Error ? error.message : "Unable to load transfer");
      });
    return () => controller.abort();
  }, [transferId, reload]);
  async function act(action: string) {
    if (!transfer) return;
    if (!command.uncertain && !reason.trim()) {
      command.setNotice("Give a reason for this action.");
      return;
    }
    setPendingAction(action);
    const body = {
      expectedVersion: transfer.version,
      reason,
      ...(action === "RESOLVE"
        ? {
            lineId: resolutionLine,
            quantityBase: Number(resolutionQuantity),
            category: resolutionCategory,
            outcome: resolutionOutcome,
            inspectionConfirmed,
          }
        : {}),
      ...(action === "RECEIVE"
        ? {
            lines: transfer.lines
              .filter(
                (line) =>
                  Number(quantities[line.lineId] ?? 0) > 0 ||
                  observations[line.lineId] !== undefined,
              )
              .map((line) => ({
                lineId: line.lineId,
                acceptedBase: Number(quantities[line.lineId] ?? 0),
                ...((line.sizeOptions ?? []).some((size) => Number(sizeCounts[size.skuId] ?? 0) > 0)
                  ? {
                      sizeCounts: (line.sizeOptions ?? [])
                        .filter((size) => Number(sizeCounts[size.skuId] ?? 0) > 0)
                        .map((size) => ({
                          skuId: size.skuId,
                          quantity: Number(sizeCounts[size.skuId]),
                        })),
                    }
                  : {}),
                damagedBase: Number(observations[line.lineId]?.damaged ?? line.damagedBase),
                shortageBase: Number(observations[line.lineId]?.missing ?? line.shortageBase),
              })),
          }
        : {}),
    };
    const done = await (command.uncertain
      ? command.retry()
      : command.run(
          action,
          `/api/admin/transfers/${encodeURIComponent(transferId)}/${action.toLowerCase()}`,
          body,
        ));
    if (done) {
      setQuantities({});
      setSizeCounts({});
      setObservations({});
      setResolutionQuantity("");
      setInspectionConfirmed(false);
      setReason("");
      setPendingAction(null);
      setReload((value) => value + 1);
    }
  }
  return (
    <div className="w-full space-y-6">
      <Link className="underline" href="/admin/transfers">
        Warehouse transfers
      </Link>
      <PageHeader
        title="Transfer details"
        description="Record checked goods and remaining damage or shortages. Only accepted quantities credit destination stock."
      />
      {error ? (
        <p role="alert">{error}</p>
      ) : !transfer ? (
        <p role="status">Loading transfer…</p>
      ) : (
        <>
          <div className="rounded-lg border p-4">
            <h2 className="text-lg font-semibold">
              {transfer.sourceLocationName} → {transfer.destinationLocationName}
            </h2>
            <p className="capitalize">{statusLabel(transfer.status)}</p>
            <p>{transfer.reason}</p>
          </div>
          <section className="space-y-4" aria-label="Transfer quantities">
            {transfer.lines.map((line) => (
              <article key={line.lineId} className="space-y-4 rounded-lg border p-4">
                <h3 className="font-semibold">{line.productName}</h3>
                <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                  {[
                    ["Sent / planned", line.quantityBase],
                    ["Accepted", line.acceptedBase],
                    ["In transit", line.outstandingBase],
                    ["Damaged (non-sellable)", line.damagedBase],
                    ["Missing", line.shortageBase],
                    ["Recorded loss", line.lostBase],
                    ["Returned to warehouse", line.returnedBase],
                  ].map(([label, amount]) => (
                    <div key={label}>
                      <dt className="text-muted-foreground">{label}</dt>
                      <dd className="font-medium">
                        {typeof amount === "number" ? units(amount, line.baseUnit) : amount}
                      </dd>
                    </div>
                  ))}
                </dl>
                {transfer.allowedActions.includes("RECEIVE") && line.outstandingBase > 0 ? (
                  <fieldset
                    disabled={command.busy || command.uncertain}
                    className="grid gap-3 border-t pt-3 sm:grid-cols-3"
                  >
                    <label className="space-y-1 text-sm">
                      Accept now ({line.baseUnit === "GRAM" ? "grams" : "pieces"})
                      <Input
                        type="number"
                        min="0"
                        max={line.outstandingBase}
                        step="1"
                        aria-label={`Accept ${line.productName} (${line.baseUnit === "GRAM" ? "grams" : "pieces"})`}
                        value={quantities[line.lineId] ?? ""}
                        onChange={(event) =>
                          setQuantities((current) => ({
                            ...current,
                            [line.lineId]: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label className="space-y-1 text-sm">
                      Damaged remaining
                      <Input
                        type="number"
                        min="0"
                        max={line.outstandingBase}
                        step="1"
                        aria-label={`Damaged remaining for ${line.productName}`}
                        value={observations[line.lineId]?.damaged ?? String(line.damagedBase)}
                        onChange={(event) =>
                          setObservations((current) => ({
                            ...current,
                            [line.lineId]: { ...current[line.lineId], damaged: event.target.value },
                          }))
                        }
                      />
                    </label>
                    <label className="space-y-1 text-sm">
                      Missing remaining
                      <Input
                        type="number"
                        min="0"
                        max={line.outstandingBase}
                        step="1"
                        aria-label={`Missing remaining for ${line.productName}`}
                        value={observations[line.lineId]?.missing ?? String(line.shortageBase)}
                        onChange={(event) =>
                          setObservations((current) => ({
                            ...current,
                            [line.lineId]: { ...current[line.lineId], missing: event.target.value },
                          }))
                        }
                      />
                    </label>
                  </fieldset>
                ) : null}
                {transfer.allowedActions.includes("RECEIVE") &&
                line.outstandingBase > 0 &&
                !!line.sizeOptions?.length ? (
                  <fieldset
                    disabled={command.busy || command.uncertain}
                    className="space-y-3 border-t pt-3"
                  >
                    <legend>Actual size counts for this receipt</legend>
                    <p className="text-sm text-muted-foreground">
                      Count the pieces or packs in the grams accepted now. Leave blank if they will
                      be counted later. These are the same goods; do not add stock again.
                    </p>
                    <div className="grid gap-3 sm:grid-cols-3">
                      {line.sizeOptions.map((size) => (
                        <label key={size.skuId} className="space-y-1 text-sm">
                          {size.name}
                          <Input
                            aria-label={`Count ${size.name} for ${line.productName}`}
                            type="number"
                            min="0"
                            step="1"
                            value={sizeCounts[size.skuId] ?? ""}
                            onChange={(event) =>
                              setSizeCounts((current) => ({
                                ...current,
                                [size.skuId]: event.target.value,
                              }))
                            }
                          />
                        </label>
                      ))}
                    </div>
                  </fieldset>
                ) : null}
              </article>
            ))}
          </section>
          {transfer.allowedActions.length ? (
            <div className="space-y-3 rounded-lg border p-4">
              {transfer.status === "DRAFT" ? (
                <p>
                  Dispatch deducts the full planned quantity from the warehouse and records it in
                  transit.
                </p>
              ) : (
                <p>
                  Accept only checked, sellable goods. Enter damaged and missing quantities still
                  remaining after this receipt. Both remain part of transit until accepted, lost or
                  returned.
                </p>
              )}
              <Label htmlFor="receipt-reason">Reason for action</Label>
              <Input
                id="receipt-reason"
                maxLength={500}
                value={reason}
                disabled={command.busy || command.uncertain}
                onChange={(event) => setReason(event.target.value)}
              />
              <div className="flex flex-wrap gap-2">
                {transfer.allowedActions
                  .filter((action) => action !== "RESOLVE")
                  .map((action) => (
                    <Button
                      key={action}
                      variant={action === "CANCEL" ? "outline" : "default"}
                      disabled={command.busy || (command.uncertain && pendingAction !== action)}
                      onClick={() => void act(action)}
                    >
                      {command.busy && pendingAction === action
                        ? "Saving…"
                        : action === "DISPATCH"
                          ? "Dispatch transfer"
                          : action === "RECEIVE"
                            ? "Record checked goods"
                            : "Cancel draft"}
                    </Button>
                  ))}
              </div>
            </div>
          ) : (
            <p>No transfer action is available for your authority and the current state.</p>
          )}
          {transfer.allowedActions.includes("RESOLVE") ? (
            <section
              className="space-y-4 rounded-lg border p-4"
              aria-label="Global transfer resolution"
            >
              <h2 className="font-semibold">Resolve outstanding goods</h2>
              <p className="text-sm">
                Record a documented loss or confirm a physical, sellable return to{" "}
                {transfer.sourceLocationName}. This uses the reason for action above.
              </p>
              <fieldset
                disabled={command.busy || command.uncertain}
                className="grid gap-3 sm:grid-cols-2"
              >
                <div className="space-y-2">
                  <Label htmlFor="resolution-product">Product to resolve</Label>
                  <Select
                    disabled={command.busy || command.uncertain}
                    value={resolutionLine}
                    onValueChange={(value) => {
                      setResolutionLine(value);
                      setResolutionQuantity("");
                    }}
                  >
                    <SelectTrigger id="resolution-product">
                      <SelectValue placeholder="Select product" />
                    </SelectTrigger>
                    <SelectContent>
                      {transfer.lines
                        .filter((line) => line.outstandingBase > 0)
                        .map((line) => (
                          <SelectItem key={line.lineId} value={line.lineId}>
                            {line.productName}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="resolution-category">Outstanding goods</Label>
                  <Select
                    disabled={command.busy || command.uncertain}
                    value={resolutionCategory}
                    onValueChange={setResolutionCategory}
                  >
                    <SelectTrigger id="resolution-category">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="UNCLASSIFIED">Other outstanding goods</SelectItem>
                      <SelectItem value="DAMAGED">Reported damaged goods</SelectItem>
                      <SelectItem value="MISSING">Reported missing goods</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="resolution-outcome">Resolution</Label>
                  <Select
                    disabled={command.busy || command.uncertain}
                    value={resolutionOutcome}
                    onValueChange={(value) => {
                      setResolutionOutcome(value);
                      setInspectionConfirmed(false);
                    }}
                  >
                    <SelectTrigger id="resolution-outcome">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="LOSS">Record loss</SelectItem>
                      <SelectItem value="VERIFIED_RETURN">Verify sellable return</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="resolution-quantity">
                    Quantity (
                    {transfer.lines.find((line) => line.lineId === resolutionLine)?.baseUnit ===
                    "PIECE"
                      ? "pieces"
                      : "grams"}
                    )
                  </Label>
                  <Input
                    id="resolution-quantity"
                    type="number"
                    min="1"
                    step="1"
                    value={resolutionQuantity}
                    onChange={(event) => setResolutionQuantity(event.target.value)}
                  />
                </div>
                {resolutionOutcome === "VERIFIED_RETURN" ? (
                  <div className="flex items-start gap-2 sm:col-span-2">
                    <Checkbox
                      id="return-inspection"
                      checked={inspectionConfirmed}
                      onCheckedChange={(value) => setInspectionConfirmed(value === true)}
                    />
                    <Label htmlFor="return-inspection">
                      Physically received at the warehouse and inspected as sellable
                    </Label>
                  </div>
                ) : null}
              </fieldset>
              <Button
                disabled={
                  command.busy ||
                  (command.uncertain && pendingAction !== "RESOLVE") ||
                  (!command.uncertain &&
                    (!resolutionLine ||
                      !resolutionQuantity ||
                      (resolutionOutcome === "VERIFIED_RETURN" && !inspectionConfirmed)))
                }
                onClick={() => void act("RESOLVE")}
              >
                {command.busy && pendingAction === "RESOLVE" ? "Saving…" : "Save resolution"}
              </Button>
            </section>
          ) : null}
          {command.notice ? <p role="status">{command.notice}</p> : null}
          <Button
            variant="outline"
            disabled={command.busy || command.uncertain}
            onClick={() => setReload((value) => value + 1)}
          >
            Refresh transfer
          </Button>
          {transfer.sorting?.length ? (
            <section className="space-y-2">
              <h2 className="font-semibold">Actual received size counts</h2>
              {transfer.sorting.map((item, index) => (
                <p key={`${item.sortId}:${index}`} className="text-sm">
                  {item.quantityGrams.toLocaleString("en-PH")} g receipt · {item.skuName}:{" "}
                  {item.quantity} pieces/packs
                </p>
              ))}
            </section>
          ) : null}
          {transfer.checks.length ? (
            <section className="space-y-2">
              <h2 className="font-semibold">Latest checks (up to 100)</h2>
              {transfer.checks.map((check) => {
                const line = transfer.lines.find((line) => line.lineId === check.lineId);
                return (
                  <p key={check.checkId} className="text-sm">
                    {new Date(check.checkedAt).toLocaleString("en-PH", { timeZone: "Asia/Manila" })}{" "}
                    · {line?.productName} ·{" "}
                    {line ? units(check.acceptedBase, line.baseUnit) : check.acceptedBase} accepted;
                    damaged remaining {check.damagedBase}, missing remaining {check.shortageBase} ·{" "}
                    {check.reason}
                  </p>
                );
              })}
            </section>
          ) : null}
          {transfer.resolutions.length ? (
            <section className="space-y-2">
              <h2 className="font-semibold">Latest resolutions (up to 100)</h2>
              {transfer.resolutions.map((resolution) => {
                const line = transfer.lines.find((line) => line.lineId === resolution.lineId);
                return (
                  <p key={resolution.resolutionId} className="text-sm">
                    {new Date(resolution.resolvedAt).toLocaleString("en-PH", {
                      timeZone: "Asia/Manila",
                    })}{" "}
                    · {line?.productName} ·{" "}
                    {resolution.outcome === "LOSS" ? "Loss" : "Verified sellable return"}:{" "}
                    {line ? units(resolution.quantityBase, line.baseUnit) : resolution.quantityBase}{" "}
                    · {resolution.reason}
                  </p>
                );
              })}
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
