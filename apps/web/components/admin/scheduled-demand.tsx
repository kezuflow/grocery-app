import type { ScheduledDemandItem } from "@freshmarkets/contracts";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/admin/shadcn/table";

export function formatDemandQuantity(quantity: number, unit: string): string {
  const label =
    unit === "GRAM" ? "g" : unit === "MILLILITER" ? "mL" : unit === "PIECE" ? "pcs" : unit;
  return `${quantity.toLocaleString("en-PH")} ${label}`;
}

export function ScheduledDemand({
  items,
  global,
}: {
  items: readonly ScheduledDemandItem[];
  global: boolean;
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
        </TableRow>
      </TableHeader>
      <TableBody className="block lg:table-row-group">
        {items.map((item) => {
          return (
            <TableRow
              key={JSON.stringify([item.skuId, item.inventoryPoolId, item.locationId])}
              className="grid grid-cols-2 gap-3 border-b border-border p-4 lg:table-row lg:p-0 [&>td]:min-w-0 [&>td]:p-0 lg:[&>td]:px-3 lg:[&>td]:py-3"
            >
              <TableCell className="col-span-2 whitespace-normal">
                <p className="font-semibold">{item.productName}</p>
                <p className="text-sm text-muted-foreground">{item.variantName}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Recorded shipping weight:{" "}
                  {item.shippingGrams === null
                    ? "Not recorded"
                    : `${item.shippingGrams.toLocaleString("en-PH")} g`}
                </p>
              </TableCell>
              <TableCell className="col-span-2 text-sm lg:col-span-1">
                <span className="block text-muted-foreground lg:hidden">Destination</span>
                {item.locationName}
              </TableCell>
              <TableCell className="text-sm tabular-nums lg:text-right">
                <span className="block text-muted-foreground lg:hidden">Sold units</span>
                {item.quantitySellable.toLocaleString("en-PH")}
              </TableCell>
              <TableCell className="text-sm font-semibold tabular-nums lg:text-right">
                <span className="block font-normal text-muted-foreground lg:hidden">
                  Paid quantity
                </span>
                {formatDemandQuantity(item.quantityBase, item.baseUnit)}
              </TableCell>
              {global ? (
                <TableCell className="col-span-2 text-sm lg:col-span-1">
                  <span className="block text-muted-foreground lg:hidden">
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
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
