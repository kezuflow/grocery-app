import type { ScheduledDemandItem } from "@freshmarkets/contracts";
import { Button } from "../ui/button";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";
import { StatusBadge } from "./admin-shell";

export function formatDemandQuantity(quantity: number, unit: string): string {
  const label =
    unit === "GRAM" ? "g" : unit === "MILLILITER" ? "mL" : unit === "PIECE" ? "pcs" : unit;
  return `${quantity.toLocaleString("en-PH")} ${label}`;
}

export function purchaseVersionKey(cycleId: string, item: ScheduledDemandItem): string {
  return JSON.stringify([
    cycleId,
    item.locationId,
    item.skuId,
    item.inventoryPoolId,
    item.requirementVersion,
  ]);
}

function DemandProgress({ item }: { item: ScheduledDemandItem }) {
  return (
    <div className="space-y-1 text-xs">
      <StatusBadge>{item.status.toLowerCase().replaceAll("_", " ")}</StatusBadge>
      {item.receivingStatus ? (
        <p>Receiving: {item.receivingStatus.toLowerCase().replaceAll("_", " ")}</p>
      ) : null}
      <p>
        Accepted {formatDemandQuantity(item.acceptedBase, item.baseUnit)} · Rejected{" "}
        {formatDemandQuantity(item.rejectedBase, item.baseUnit)}
      </p>
      {item.shortageBase > 0 ? (
        <p>Reported missing: {formatDemandQuantity(item.shortageBase, item.baseUnit)}</p>
      ) : null}
      {item.replacementBase > 0 ? (
        <p>Replacement accepted: {formatDemandQuantity(item.replacementBase, item.baseUnit)}</p>
      ) : null}
    </div>
  );
}

export function ScheduledDemand({
  items,
  global,
  cycleId,
  pending,
  confirmedPurchaseKey,
  onConfirm,
}: {
  items: readonly ScheduledDemandItem[];
  global: boolean;
  cycleId: string;
  pending: boolean;
  confirmedPurchaseKey: string | null;
  onConfirm(item: ScheduledDemandItem): void;
}) {
  if (items.length === 0) return <p>No paid quantities to buy for this week.</p>;
  return (
    <Table className="block lg:table" aria-label="Paid quantities to buy">
      <TableCaption>
        One row per destination. Global full-cycle totals repeat for each destination; they are not
        totals of this page.
      </TableCaption>
      <TableHeader className="hidden lg:table-header-group">
        <TableRow>
          <TableHead>Product</TableHead>
          <TableHead>Destination</TableHead>
          <TableHead className="text-right">Sold units</TableHead>
          <TableHead className="text-right">Paid quantity</TableHead>
          {global ? <TableHead>All destinations</TableHead> : null}
          <TableHead>Receiving progress</TableHead>
          <TableHead>Purchase</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody className="block lg:table-row-group">
        {items.map((item) => {
          const confirmed = confirmedPurchaseKey === purchaseVersionKey(cycleId, item);
          return (
            <TableRow
              key={JSON.stringify([item.skuId, item.inventoryPoolId, item.locationId])}
              className="grid grid-cols-2 gap-3 border-b border-[var(--fm-border)] p-4 lg:table-row lg:p-0 [&>td]:min-w-0 [&>td]:p-0 lg:[&>td]:px-3 lg:[&>td]:py-3"
            >
              <TableCell className="col-span-2 whitespace-normal">
                <p className="font-semibold">{item.productName}</p>
                <p className="text-sm text-[var(--fm-text-muted)]">{item.variantName}</p>
                <p className="mt-1 text-xs text-[var(--fm-text-muted)]">
                  Recorded shipping weight: {item.shippingGrams.toLocaleString("en-PH")} g
                </p>
              </TableCell>
              <TableCell className="col-span-2 text-sm lg:col-span-1">
                <span className="block text-[var(--fm-text-muted)] lg:hidden">Destination</span>
                {item.locationName}
              </TableCell>
              <TableCell className="text-sm tabular-nums lg:text-right">
                <span className="block text-[var(--fm-text-muted)] lg:hidden">Sold units</span>
                {item.quantitySellable.toLocaleString("en-PH")}
              </TableCell>
              <TableCell className="text-sm font-semibold tabular-nums lg:text-right">
                <span className="block font-normal text-[var(--fm-text-muted)] lg:hidden">
                  Paid quantity
                </span>
                {formatDemandQuantity(item.quantityBase, item.baseUnit)}
              </TableCell>
              {global ? (
                <TableCell className="col-span-2 text-sm lg:col-span-1">
                  <span className="block text-[var(--fm-text-muted)] lg:hidden">
                    All destinations, full cycle
                  </span>
                  <span className="block whitespace-nowrap tabular-nums">
                    {item.totalQuantitySellable.toLocaleString("en-PH")} sold units
                  </span>
                  <span className="block whitespace-nowrap tabular-nums">
                    {formatDemandQuantity(item.totalQuantityBase, item.baseUnit)}
                  </span>
                </TableCell>
              ) : null}
              <TableCell className="col-span-2 align-top lg:col-span-1">
                <span className="mb-1 block text-sm text-[var(--fm-text-muted)] lg:hidden">
                  Receiving progress
                </span>
                <DemandProgress item={item} />
              </TableCell>
              <TableCell className="col-span-2 align-top lg:col-span-1">
                {confirmed ? (
                  <p role="status" className="text-sm">
                    Purchase recorded. Refreshing current quantities.
                  </p>
                ) : item.canConfirmPurchase ? (
                  <Button disabled={pending} onClick={() => onConfirm(item)}>
                    Confirm purchase
                  </Button>
                ) : null}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
