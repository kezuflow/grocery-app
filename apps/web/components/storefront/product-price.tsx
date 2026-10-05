import type { CatalogVariant } from "@freshmarkets/contracts";
import { formatMoney } from "@/lib/storefront/catalog-presentation";

/** Render Core's one-unit price and fixed variant label; cart and checkout own totals. */
export function ProductPrice({
  variant,
}: {
  variant: Pick<CatalogVariant, "priceMinor" | "currency" | "sale"> &
    ({ name: string } | { label: string }) & {
      availability?: CatalogVariant["availability"];
    };
}) {
  if (variant.availability === "LOCATION_REQUIRED") return <>Set delivery location</>;
  if (variant.priceMinor === null || variant.currency === null) return <>Unavailable</>;
  const label = "name" in variant ? variant.name : variant.label;
  return variant.sale ? (
    <span className="inline-flex flex-wrap items-baseline gap-x-2">
      <del className="text-xs font-normal text-muted-foreground" aria-label="Regular price">
        {formatMoney(variant.priceMinor, variant.currency)}
      </del>
      <span aria-label="Sale price">{formatMoney(variant.sale.priceMinor, variant.currency)}</span>
      <span className="font-normal">/ {label}</span>
    </span>
  ) : (
    <>
      {formatMoney(variant.priceMinor, variant.currency)}{" "}
      <span className="font-normal">/ {label}</span>
    </>
  );
}
