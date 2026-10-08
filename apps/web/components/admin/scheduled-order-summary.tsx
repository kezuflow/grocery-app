"use client";

import type {
  ScheduledOrderSummaryItem,
  ScheduledOrderSummaryTotals,
  ScheduledSellingOptionSummaryItem,
} from "@freshmarkets/contracts";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/admin/shadcn/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/admin/shadcn/collapsible";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/admin/shadcn/table";

export function formatScheduledQuantity(
  quantity: number,
  unit: ScheduledSellingOptionSummaryItem["baseUnit"],
) {
  if (unit === "GRAM" && quantity >= 1000)
    return `${new Intl.NumberFormat("en-PH", { maximumFractionDigits: 3 }).format(quantity / 1000)} kg`;
  const label = unit === "GRAM" ? "g" : unit === "MILLILITER" ? "mL" : "pcs";
  return `${quantity.toLocaleString("en-PH")} ${label}`;
}

function ProductQuantities({ item }: { item: ScheduledOrderSummaryItem }) {
  if (item.purchaseQuantities)
    return (
      <ul className="flex flex-col gap-1">
        {item.purchaseQuantities.map((quantity, index) => (
          <li key={index}>
            {quantity.sizeLabel ? (
              <span className="block text-sm text-muted-foreground">{quantity.sizeLabel}</span>
            ) : null}
            <span className="font-semibold tabular-nums">
              {formatScheduledQuantity(quantity.quantity, quantity.unit)}
            </span>
          </li>
        ))}
      </ul>
    );
  return (
    <ul className="flex flex-col gap-1">
      {item.quantities.map((quantity) => (
        <li key={JSON.stringify([quantity.inventoryPoolId, quantity.baseUnit])}>
          {item.quantities.length > 1 ? (
            <span className="block text-sm text-muted-foreground">
              {quantity.sellingOptionNames.join(" / ")}
            </span>
          ) : null}
          <span className="font-semibold tabular-nums">
            {formatScheduledQuantity(quantity.totalQuantityBase, quantity.baseUnit)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function SellingOptions({ item, global }: { item: ScheduledOrderSummaryItem; global: boolean }) {
  return (
    <div className="flex flex-col gap-3 p-2">
      <p className="text-sm text-muted-foreground">
        Packing breakdown. Sold units refer to each selling option; paid orders and destinations can
        overlap between options.
      </p>
      <ul className="flex flex-col gap-4" aria-label={`Selling options for ${item.productName}`}>
        {item.sellingOptions.map((option) => (
          <li
            className="flex flex-col gap-2"
            key={JSON.stringify([
              option.skuId,
              option.inventoryPoolId,
              option.baseUnit,
              option.variantName,
              option.unitName,
            ])}
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-medium">{option.variantName}</p>
                <p className="text-sm text-muted-foreground">
                  {option.soldUnitCount.toLocaleString("en-PH")} sold{" "}
                  {option.soldUnitCount === 1 ? "unit" : "units"} ·{" "}
                  {option.paidOrderCount.toLocaleString("en-PH")} paid{" "}
                  {option.paidOrderCount === 1 ? "order" : "orders"}
                </p>
              </div>
              <p className="font-medium tabular-nums">
                {formatScheduledQuantity(
                  option.purchaseQuantity?.quantity ?? option.totalQuantityBase,
                  option.purchaseQuantity?.unit ?? option.baseUnit,
                )}
              </p>
            </div>
            {global ? (
              <ul
                className="flex flex-col gap-1 text-sm text-muted-foreground"
                aria-label={`Destinations for ${option.variantName}`}
              >
                {option.destinations.map((destination) => (
                  <li key={destination.locationId} className="flex flex-wrap justify-between gap-2">
                    <span>{destination.locationName}</span>
                    <span className="tabular-nums">
                      {destination.soldUnitCount.toLocaleString("en-PH")} sold{" "}
                      {destination.soldUnitCount === 1 ? "unit" : "units"} ·{" "}
                      {formatScheduledQuantity(
                        destination.purchaseQuantity?.quantity ?? destination.totalQuantityBase,
                        destination.purchaseQuantity?.unit ?? option.baseUnit,
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function OptionsTrigger({ item }: { item: ScheduledOrderSummaryItem }) {
  return (
    <CollapsibleTrigger asChild>
      <Button
        variant="ghost"
        size="sm"
        aria-label={`Selling options for ${item.productName}`}
        className="group"
      >
        {item.sellingOptions.length} selling{" "}
        {item.sellingOptions.length === 1 ? "option" : "options"}
        <ChevronDown
          data-icon="inline-end"
          className="transition-transform group-data-[state=open]:rotate-180"
        />
      </Button>
    </CollapsibleTrigger>
  );
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
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Paid ordered quantities include committed paid additions and exclude accepted cancellations.
        They do not subtract physical stock or add forecast quantities. Expand a product for packing
        and destination details.
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
                Exact paid demand grouped by product. Different sizes, stock quantities and units
                remain distinct where required.
              </TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Paid quantity</TableHead>
                  <TableHead className="text-right">Paid orders</TableHead>
                  {global ? <TableHead className="text-right">Destinations</TableHead> : null}
                </TableRow>
              </TableHeader>
              {items.map((item) => (
                <Collapsible asChild key={JSON.stringify([item.productId, item.productName])}>
                  <TableBody>
                    <TableRow>
                      <TableCell className="whitespace-normal">
                        <div className="flex flex-wrap items-center gap-3">
                          <span className="font-medium">{item.productName}</span>
                          <OptionsTrigger item={item} />
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-normal text-right">
                        <ProductQuantities item={item} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {item.paidOrderCount.toLocaleString("en-PH")}
                      </TableCell>
                      {global ? (
                        <TableCell className="text-right tabular-nums">
                          {item.destinationCount.toLocaleString("en-PH")}
                        </TableCell>
                      ) : null}
                    </TableRow>
                    <CollapsibleContent asChild>
                      <TableRow>
                        <TableCell colSpan={global ? 4 : 3} className="whitespace-normal">
                          <SellingOptions item={item} global={global} />
                        </TableCell>
                      </TableRow>
                    </CollapsibleContent>
                  </TableBody>
                </Collapsible>
              ))}
            </Table>
          </div>
          <div className="grid gap-3 md:hidden" aria-label="Paid ordered products">
            {items.map((item) => (
              <Collapsible asChild key={JSON.stringify([item.productId, item.productName])}>
                <article className="flex flex-col gap-3 rounded-lg border p-4">
                  <h3 className="font-semibold">{item.productName}</h3>
                  <ProductQuantities item={item} />
                  <dl className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <dt className="text-muted-foreground">Paid orders</dt>
                      <dd>{item.paidOrderCount.toLocaleString("en-PH")}</dd>
                    </div>
                    {global ? (
                      <div>
                        <dt className="text-muted-foreground">Destinations</dt>
                        <dd>{item.destinationCount.toLocaleString("en-PH")}</dd>
                      </div>
                    ) : null}
                  </dl>
                  <div>
                    <OptionsTrigger item={item} />
                  </div>
                  <CollapsibleContent>
                    <SellingOptions item={item} global={global} />
                  </CollapsibleContent>
                </article>
              </Collapsible>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
