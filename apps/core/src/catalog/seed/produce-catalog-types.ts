/**
 * Controlled taxonomy and typed shape for the development-time produce seed
 * manifest. This module is seed input tooling, never a runtime catalog
 * authority: D1 owns live catalog state after migration application.
 *
 * Discriminated mass/count variants make cross-dimensional recipes hard to
 * express. `Pack`/`Bunch` are customer-facing merchandising labels only;
 * they never introduce universal conversion units.
 */

export const PRODUCE_CATEGORY_CODES = [
  "FRUITS",
  "VEGETABLES",
  "LEAFY_GREENS_HERBS",
  "ROOTS_TUBERS_BULBS",
  "BEANS_PEAS_SEEDS",
  "AROMATICS_SPICES",
  "NATIVE_SPECIALTY_PRODUCE",
] as const;

export type ProduceCategoryCode = (typeof PRODUCE_CATEGORY_CODES)[number];

export type ProduceCategoryDefinition = {
  code: ProduceCategoryCode;
  name: string;
  slug: string;
  sortOrder: number;
};

export const PRODUCE_CATEGORIES: ReadonlyArray<ProduceCategoryDefinition> = [
  { code: "FRUITS", name: "Fruits", slug: "fruits", sortOrder: 1 },
  { code: "VEGETABLES", name: "Vegetables", slug: "vegetables", sortOrder: 2 },
  {
    code: "LEAFY_GREENS_HERBS",
    name: "Leafy Greens & Herbs",
    slug: "leafy-greens-herbs",
    sortOrder: 3,
  },
  {
    code: "ROOTS_TUBERS_BULBS",
    name: "Roots, Tubers & Bulbs",
    slug: "roots-tubers-bulbs",
    sortOrder: 4,
  },
  { code: "BEANS_PEAS_SEEDS", name: "Beans, Peas & Seeds", slug: "beans-peas-seeds", sortOrder: 5 },
  { code: "AROMATICS_SPICES", name: "Aromatics & Spices", slug: "aromatics-spices", sortOrder: 6 },
  {
    code: "NATIVE_SPECIALTY_PRODUCE",
    name: "Native & Specialty Produce",
    slug: "native-specialty-produce",
    sortOrder: 7,
  },
];

export function produceCategory(code: ProduceCategoryCode): ProduceCategoryDefinition {
  const definition = PRODUCE_CATEGORIES.find((candidate) => candidate.code === code);
  if (!definition) throw new Error(`Unknown produce category code: ${code}`);
  return definition;
}

/** Canonical inventory base units; authoritative quantities are integers. */
export type ProduceBaseUnit = "GRAM" | "PIECE";

export type ProduceMerchandisingLabel = "Pack" | "Bunch";

type MassVariantRecipe = {
  baseUnit: "GRAM";
  sellUnitCode: "G" | "KG";
  /** Sellable quantity expressed through the controlled sell unit. */
  sellQuantity: number;
  /** Exact integer gram consumption from the shared product pool. */
  inventoryQuantityBase: number;
};

type CountVariantRecipe = {
  baseUnit: "PIECE";
  sellUnitCode: "PC";
  sellQuantity: number;
  inventoryQuantityBase: number;
};

type VariantDisplayAndPrice = {
  id: string;
  code: string;
  displayName: string;
  /** Merchandising labels mark staff-assembled packs/bunches, never units. */
  merchandisingLabel?: ProduceMerchandisingLabel;
  /** Approximate customer copy; approximate ranges are never authoritative. */
  customerContentsNote?: string;
  /** Staff operations instruction; never exposed through public DTOs. */
  packingInstruction?: string;
  /** Positive PHP minor units. */
  priceMinor: number;
  sortOrder: number;
};

export type ProduceSeedVariant = (MassVariantRecipe | CountVariantRecipe) & VariantDisplayAndPrice;

export type ProduceSeedDetail = {
  label: string;
  value: string;
  sortOrder: number;
};

export type ProduceSeedProduct = {
  id: string;
  slug: string;
  name: string;
  categoryCode: ProduceCategoryCode;
  description: string;
  media: {
    /** Public `.webp` basename under `apps/web/public/produce`, sans directory. */
    assetKey: string;
    altText: string;
  };
  details: ReadonlyArray<ProduceSeedDetail>;
  inventoryBaseUnit: ProduceBaseUnit;
  variants: ReadonlyArray<ProduceSeedVariant>;
};

export type ProduceCatalogInput = {
  products: ReadonlyArray<ProduceSeedProduct>;
  /** Every public asset key that must map to exactly one product. */
  assetKeys: ReadonlyArray<string>;
};

export type ProducePriceRange = { minPriceMinor: number; maxPriceMinor: number };

export type ProduceCatalogSummary = {
  productCount: number;
  assetCount: number;
  variantCount: number;
  byCategory: Readonly<Record<string, number>>;
  byBaseUnit: Readonly<Record<string, number>>;
  /** Assembled-pack and bunch SKU counts keyed by label. */
  byMerchandisingLabel: Readonly<Record<string, number>>;
  minPriceMinor: number | null;
  maxPriceMinor: number | null;
  priceRangeByCategory: Readonly<Record<string, ProducePriceRange>>;
  /** Always zero after validation; kept for review fixtures and reporting. */
  unpricedVariantCount: number;
  /** Always zero after validation; launch SKUs start available. */
  unavailableSkuCount: number;
};

export type ValidatedProduceCatalog = {
  products: ReadonlyArray<ProduceSeedProduct>;
  summary: ProduceCatalogSummary;
};
