import type { CatalogDetail, CatalogMedia, CatalogProduct, CatalogVariant } from "@freshmarkets/contracts";

/**
 * Presentation view-models for marketplace surfaces. Contract DTOs stay the
 * authoritative shape — media, alt text, ordered details, merchandising
 * labels, and contents notes all come from Core/D1. Money never transforms
 * here: minor units pass through untouched and missing prices surface as
 * unavailable, never zero.
 */

export type PresentationVariant = {
  id: string;
  label: string;
  priceMinor: number | null;
  currency: string | null;
  /** Merchandising label from Core (`Pack`/`Bunch`) or null for fixed sizes. */
  merchandisingLabel: string | null;
  /** Approximate customer contents copy for assembled packs/bunches. */
  contentsNote: string | null;
  sellQuantity: number;
  unitSymbol: string;
};

export type PresentationProduct = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  categoryName: string;
  categorySlug: string;
  available: boolean;
  /** Core-resolved media metadata; null renders the accessible placeholder. */
  media: CatalogMedia | null;
  /** Ordered customer-facing product details. */
  details: ReadonlyArray<CatalogDetail>;
  /** Deterministic card variant; null when no variant carries a valid price. */
  defaultVariant: PresentationVariant | null;
  variants: ReadonlyArray<PresentationVariant>;
};

const pesoFormatter = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
});

export function formatMoney(amountMinor: number, currency: string | null): string {
  if (!currency) return "Unavailable";
  if (currency === "PHP") return pesoFormatter.format(amountMinor / 100);
  return new Intl.NumberFormat("en-PH", { style: "currency", currency }).format(amountMinor / 100);
}

function presentationVariant(variant: CatalogVariant): PresentationVariant {
  return {
    id: variant.id,
    label: variant.name,
    priceMinor: variant.priceMinor,
    currency: variant.currency,
    merchandisingLabel: variant.merchandisingLabel,
    contentsNote: variant.contentsNote,
    sellQuantity: variant.sellQuantity,
    unitSymbol: variant.unit,
  };
}

/**
 * Pick the variant a product card presents, using Core's fixed variant
 * metadata rather than guessing from base consumption:
 *
 * 1. staff-assembled packs/bunches lead through their merchandising label;
 * 2. otherwise mass sizes prefer the everyday ~500 g fixed weight;
 * 3. anything else falls back to the first priced variant.
 *
 * Comparison happens within one product; every variant shares a base
 * dimension by construction.
 */
export function pickDefaultVariant(
  variants: ReadonlyArray<CatalogVariant>,
): PresentationVariant | null {
  const priced = variants.filter(
    (variant): variant is CatalogVariant & { priceMinor: number; currency: string } =>
      variant.priceMinor !== null && variant.currency !== null,
  );
  if (priced.length === 0) return null;

  const assembled = priced.find((variant) => variant.merchandisingLabel !== null);
  if (assembled) return presentationVariant(assembled);

  const massSizes = priced.filter((variant) => variant.sellUnitCode !== "PC");
  if (massSizes.length > 0) {
    const closest = massSizes.reduce((best, variant) =>
      Math.abs(variant.consumptionBaseQuantity - 500) <
      Math.abs(best.consumptionBaseQuantity - 500)
        ? variant
        : best,
    );
    return presentationVariant(closest);
  }

  return presentationVariant(priced[0]!);
}

export function toPresentationProduct(product: CatalogProduct): PresentationProduct {
  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    description: product.description,
    categoryName: product.category.name,
    categorySlug: product.category.slug,
    available: product.available,
    media: product.media ?? null,
    details: product.details ?? [],
    defaultVariant: pickDefaultVariant(product.variants),
    variants: product.variants.map(presentationVariant),
  };
}

export function toPresentationProducts(
  products: ReadonlyArray<CatalogProduct>,
): PresentationProduct[] {
  return products.map(toPresentationProduct);
}

/** Products eligible for merchandising rails: available with a priced variant. */
export function railEligible(products: ReadonlyArray<PresentationProduct>): PresentationProduct[] {
  return products.filter((product) => product.available && product.defaultVariant !== null);
}
