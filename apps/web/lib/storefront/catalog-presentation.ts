import type { CatalogProduct, CatalogVariant } from "@freshmarkets/contracts";

/**
 * Presentation view-models for marketplace surfaces. Contract DTOs stay the
 * authoritative shape; these types only add presentation decisions (default
 * variant, image resolution, formatting) so every storefront surface makes the
 * same choices. Money never transforms here — minor units pass through
 * untouched and missing prices surface as unavailable, never zero.
 */

export type PresentationVariant = {
  id: string;
  label: string;
  priceMinor: number | null;
  currency: string | null;
};

export type PresentationProduct = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  categoryName: string;
  categorySlug: string;
  available: boolean;
  /** Canonical produce image path or null for the leaf placeholder. */
  image: string | null;
  /** Deterministic card variant; null when no variant carries a valid price. */
  defaultVariant: PresentationVariant | null;
  variants: ReadonlyArray<PresentationVariant>;
};

/**
 * Curated slug -> produce image mapping. The catalog contract intentionally
 * has no media field yet (R2 canonical media is tracked separately), so the
 * storefront resolves images from the seeded public produce library. Unknown
 * slugs render the placeholder instead of a guessed broken path.
 */
const imageBySlug: Record<string, string> = {
  "red-onion": "/produce/onion-red-creole-bermuda-red.webp",
  avocado: "/produce/avocado.webp",
  "banana-lakatan": "/produce/banana-lakatan.webp",
  "mango-carabao": "/produce/mango-carabao.webp",
  strawberry: "/produce/strawberry.webp",
  pineapple: "/produce/pineapple.webp",
  watermelon: "/produce/watermelon.webp",
  tomato: "/produce/tomato.webp",
  carrot: "/produce/carrot.webp",
  broccoli: "/produce/broccoli.webp",
  cucumber: "/produce/japanese-cucumber.webp",
  cabbage: "/produce/cabbage.webp",
  garlic: "/produce/garlic-dried-bulb.webp",
  calamansi: "/produce/calamansi.webp",
  papaya: "/produce/papaya-solo.webp",
  kangkong: "/produce/kangkong-swamp-cabbage.webp",
  eggplant: "/produce/eggplant.webp",
  pechay: "/produce/pechay-native.webp",
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
  };
}

/**
 * Pick the variant a product card presents. Mass/volume packs (base quantity
 * of 100 or more) prefer the pack closest to 500 base units — the everyday
 * 500 g size. Counted packs (pieces/packs) take the first priced variant so
 * the smallest pack leads. Comparison happens within one product's variants,
 * all sharing the same base dimension.
 */
export function pickDefaultVariant(
  variants: ReadonlyArray<CatalogVariant>,
): PresentationVariant | null {
  const priced = variants.filter(
    (variant): variant is CatalogVariant & { priceMinor: number; currency: string } =>
      variant.priceMinor !== null && variant.currency !== null,
  );
  if (priced.length === 0) return null;
  const packs = priced.filter((variant) => variant.consumptionBaseQuantity >= 100);
  if (packs.length === 0) return presentationVariant(priced[0]);
  const closest = packs.reduce((best, variant) =>
    Math.abs(variant.consumptionBaseQuantity - 500) < Math.abs(best.consumptionBaseQuantity - 500)
      ? variant
      : best,
  );
  return presentationVariant(closest);
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
    image: imageBySlug[product.slug] ?? null,
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
