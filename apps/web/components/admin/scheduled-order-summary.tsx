import type {
  ScheduledOrderSummaryItem,
  ScheduledOrderSummaryTotals,
} from "@freshmarkets/contracts";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";

export function formatScheduledQuantity(
  quantity: number,
  unit: ScheduledOrderSummaryItem["baseUnit"],
) {
  if (unit === "GRAM" && quantity >= 1000)
    return `${new Intl.NumberFormat("en-PH", { maximumFractionDigits: 3 }).format(quantity / 1000)} kg`;
  const label = unit === "GRAM" ? "g" : unit === "MILLILITER" ? "mL" : "pcs";
  return `${quantity.toLocaleString("en-PH")} ${label}`;
}

export function ScheduledOrderSummary({
  items,
  totals,
  global,
}: {
  items: readonly ScheduledOrderSummaryItem[];
  totals: ScheduledOrderSummaryTotals;
  global: boolean;
}) {
  const statistics = [
    ["Paid orders", totals.paidOrderCount],
    ["Products", totals.productCount],
    ["Selling options", totals.sellingOptionCount],
    ["Destinations", totals.destinationCount],
  ] as const;
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Paid ordered quantities include committed paid additions and exclude accepted cancellations.
        They do not subtract physical stock or add forecast quantities.
      </p>
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Order summary totals">
        {statistics.map(([label, value]) => (
          <div key={label} className="rounded-lg border p-3">
            <dt className="text-sm text-muted-foreground">{label}</dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums">
              {value.toLocaleString("en-PH")}
            </dd>
          </div>
        ))}
      </dl>
      {items.length === 0 ? (
        <p>No paid products are recorded for this cycle.</p>
      ) : (
        <>
          <div className="hidden md:block">
            <Table aria-label="Paid ordered products">
              <TableCaption>
                Exact paid demand for this cycle. Each row keeps compatible selling-option and
                base-unit evidence distinct.
              </TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Selling option</TableHead>
                  <TableHead className="text-right">Paid orders</TableHead>
                  <TableHead className="text-right">Sold units</TableHead>
                  <TableHead className="text-right">Paid quantity</TableHead>
                  {global ? <TableHead className="text-right">Destinations</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow
                    key={JSON.stringify([
                      item.skuId,
                      item.inventoryPoolId,
                      item.baseUnit,
                      item.productName,
                      item.variantName,
                      item.unitName,
                    ])}
                  >
                    <TableCell className="font-medium">{item.productName}</TableCell>
                    <TableCell>{item.variantName}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {item.paidOrderCount.toLocaleString("en-PH")}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {item.soldUnitCount.toLocaleString("en-PH")}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {formatScheduledQuantity(item.totalQuantityBase, item.baseUnit)}
                    </TableCell>
                    {global ? (
                      <TableCell className="text-right tabular-nums">
                        {item.destinationCount.toLocaleString("en-PH")}
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="grid gap-3 md:hidden" aria-label="Paid ordered products">
            {items.map((item) => (
              <article
                className="rounded-lg border p-4"
                key={JSON.stringify([
                  item.skuId,
                  item.inventoryPoolId,
                  item.baseUnit,
                  item.productName,
                  item.variantName,
                  item.unitName,
                ])}
              >
                <h3 className="font-semibold">{item.productName}</h3>
                <p className="text-sm text-muted-foreground">{item.variantName}</p>
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <div>
                    <dt className="text-muted-foreground">Paid orders</dt>
                    <dd>{item.paidOrderCount.toLocaleString("en-PH")}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Sold units</dt>
                    <dd>{item.soldUnitCount.toLocaleString("en-PH")}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Paid quantity</dt>
                    <dd className="font-medium">
                      {formatScheduledQuantity(item.totalQuantityBase, item.baseUnit)}
                    </dd>
                  </div>
                  {global ? (
                    <div>
                      <dt className="text-muted-foreground">Destinations</dt>
                      <dd>{item.destinationCount.toLocaleString("en-PH")}</dd>
                    </div>
                  ) : null}
                </dl>
              </article>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
