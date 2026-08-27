import {
  PRODUCE_CATEGORIES,
  produceCategory,
  type ProduceCatalogInput,
  type ProduceCatalogSummary,
  type ProducePriceRange,
  type ProduceSeedProduct,
  type ValidatedProduceCatalog,
} from "./produce-catalog-types";

/**
 * Aggregate manifest validation for the produce seed. Every discovered
 * violation is reported in one deterministic error so a single review pass
 * can fix the whole manifest; generation never starts from invalid input.
 */

export class ProduceCatalogValidationError extends Error {
  readonly violations: ReadonlyArray<string>;

  constructor(violations: ReadonlyArray<string>) {
    super(
      `Invalid produce catalog manifest (${violations.length} violation(s)):\n` +
        violations.map((violation) => `- ${violation}`).join("\n"),
    );
    this.name = "ProduceCatalogValidationError";
    this.violations = violations;
  }
}

const KEBAB_CASE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SNAKE_CODE = /^[A-Z0-9]+(_[A-Z0-9]+)*$/;
const ASSET_SUFFIX = ".webp";

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function slugOfCategoryCode(code: string): string | null {
  return PRODUCE_CATEGORIES.find((category) => category.code === code)?.slug ?? null;
}

/**
 * Validates and normalizes ordering for generation. Deterministic output
 * order is category sort order, then product name, then product ID.
 */
export function validateProduceCatalog(input: ProduceCatalogInput): ValidatedProduceCatalog {
  const violations: string[] = [];
  const { products, assetKeys } = input;

  const knownAssets = new Set<string>();
  for (const assetKey of assetKeys) {
    if (!assetKey.endsWith(ASSET_SUFFIX) || assetKey.includes("/") || assetKey.includes("\\")) {
      violations.push(`invalid asset key ${JSON.stringify(assetKey)}: expected a bare .webp name`);
      continue;
    }
    knownAssets.add(assetKey);
  }

  const seenIds = new Set<string>();
  const seenSlugs = new Set<string>();
  const seenCodes = new Set<string>();
  const productsByAsset = new Map<string, string>();

  for (const product of products) {
    const context = `product ${product.id || "<missing id>"}`;
    if (seenIds.has(product.id)) violations.push(`${context}: duplicate product id`);
    seenIds.add(product.id);
    if (seenSlugs.has(product.slug)) {
      violations.push(`${context}: duplicate slug "${product.slug}"`);
    }
    seenSlugs.add(product.slug);

    if (!product.id.startsWith("product-") || !KEBAB_CASE.test(product.id)) {
      violations.push(`${context}: id must be kebab-case with a "product-" prefix`);
    }
    if (product.slug.length > 0 && !KEBAB_CASE.test(product.slug)) {
      violations.push(`${context}: slug must be kebab-case`);
    }
    if (!product.name || !product.name.trim()) {
      violations.push(`${context}: missing display name`);
    }
    const categorySlug = slugOfCategoryCode(product.categoryCode);
    if (!categorySlug) {
      violations.push(`${context}: category "${String(product.categoryCode)}" is not in the controlled taxonomy`);
    }
    if (!product.description || !product.description.trim()) {
      violations.push(`${context}: missing description`);
    }
    if (!product.media?.assetKey || !product.media.altText?.trim()) {
      violations.push(`${context}: media requires an asset key and alt text`);
    } else {
      const owner = productsByAsset.get(product.media.assetKey);
      if (owner !== undefined) {
        violations.push(
          `${context}: duplicate asset "${product.media.assetKey}" already mapped by ${owner}`,
        );
      } else {
        productsByAsset.set(product.media.assetKey, product.id);
      }
      if (!knownAssets.has(product.media.assetKey)) {
        violations.push(
          `${context}: missing asset file "${product.media.assetKey}" under apps/web/public/produce`,
        );
      }
    }
    if (!Array.isArray(product.details) || product.details.length === 0) {
      violations.push(`${context}: at least one product detail row is required`);
    } else {
      const labels = product.details.map((detail) => detail.label);
      if (!labels.includes("Contents")) violations.push(`${context}: missing Contents detail`);
      if (!labels.includes("Storage")) violations.push(`${context}: missing Storage detail`);
      for (const detail of product.details) {
        if (!detail.label?.trim() || !detail.value?.trim()) {
          violations.push(`${context}: detail rows require label and value`);
          break;
        }
        if (!isPositiveInteger(detail.sortOrder) === false && !Number.isInteger(detail.sortOrder)) {
          violations.push(`${context}: detail sort order must be an integer`);
          break;
        }
      }
    }

    if (product.inventoryBaseUnit !== "GRAM" && product.inventoryBaseUnit !== "PIECE") {
      violations.push(`${context}: inventory base unit must be GRAM or PIECE`);
    }
    if (!Array.isArray(product.variants) || product.variants.length === 0) {
      violations.push(`${context}: at least one sellable variant is required`);
      continue;
    }
    for (const variant of product.variants) {
      const variantContext = `${context}, variant ${variant.id || "<missing id>"}`;
      if (seenIds.has(variant.id)) violations.push(`${variantContext}: duplicate identifier`);
      seenIds.add(variant.id);
      if (seenCodes.has(variant.code)) {
        violations.push(`${variantContext}: duplicate SKU code "${variant.code}"`);
      }
      seenCodes.add(variant.code);

      if (!variant.id.startsWith("sku-") || !KEBAB_CASE.test(variant.id)) {
        violations.push(`${variantContext}: id must be kebab-case with a "sku-" prefix`);
      }
      if (!SNAKE_CODE.test(variant.code)) {
        violations.push(`${variantContext}: SKU code must be UPPER_SNAKE_CASE ("${variant.code}")`);
      }
      if (
        variant.merchandisingLabel !== undefined &&
        variant.merchandisingLabel !== "Pack" &&
        variant.merchandisingLabel !== "Bunch"
      ) {
        violations.push(
          `${variantContext}: merchandising labels are limited to Pack or Bunch; packaging labels never define units`,
        );
      }
      if (!isPositiveInteger(variant.priceMinor)) {
        violations.push(`${variantContext}: price must be a positive integer minor unit`);
      }
      if (!isPositiveInteger(variant.sellQuantity) || !isPositiveInteger(variant.inventoryQuantityBase)) {
        violations.push(`${variantContext}: quantities must be positive integers`);
      }
      const expectedBaseUnit =
        variant.sellUnitCode === "PC"
          ? "PIECE"
          : variant.sellUnitCode === "G" || variant.sellUnitCode === "KG"
            ? "GRAM"
            : null;
      if (expectedBaseUnit === null) {
        violations.push(
          `${variantContext}: controlled sell unit must be G, KG, or PC; no universal PACK/BUNCH unit exists`,
        );
      } else if (expectedBaseUnit !== product.inventoryBaseUnit || variant.baseUnit !== expectedBaseUnit) {
        violations.push(
          `${variantContext}: dimension mismatch between sell unit "${variant.sellUnitCode}" and base unit`,
        );
      }
      const assembled = variant.merchandisingLabel !== undefined;
      if (assembled) {
        if (sellUnitIsMass(variant) && variant.sellQuantity !== variant.inventoryQuantityBase) {
          violations.push(
            `${variantContext}: assembled packs need one exact gram recipe; sell quantity must equal the recipe instead of a range`,
          );
        }
        if (!variant.customerContentsNote?.trim() || !variant.packingInstruction?.trim()) {
          violations.push(
            `${variantContext}: assembled pack/bunch requires a customer contents note and a staff packing instruction`,
          );
        }
      }
      if (variant.customerContentsNote && !variant.customerContentsNote.trim()) {
        violations.push(`${variantContext}: customer contents note cannot be blank when present`);
      }
    }
  }

  for (const assetKey of knownAssets) {
    if (!productsByAsset.has(assetKey)) {
      violations.push(`missing asset mapping: asset file "${assetKey}" has no manifest product`);
    }
  }

  if (violations.length > 0) throw new ProduceCatalogValidationError(violations);

  const sorted = [...products].sort((left, right) => {
    const categoryOrder =
      (produceCategory(left.categoryCode)?.sortOrder ?? 99) -
      (produceCategory(right.categoryCode)?.sortOrder ?? 99);
    if (categoryOrder !== 0) return categoryOrder;
    const nameOrder = left.name.localeCompare(right.name, "en");
    if (nameOrder !== 0) return nameOrder;
    return left.id.localeCompare(right.id);
  });

  return { products: sorted, summary: summarize(sorted, assetKeys.length) };
}

function sellUnitIsMass(
  variant: ProduceSeedProduct["variants"][number],
): variant is Extract<ProduceSeedProduct["variants"][number], { baseUnit: "GRAM" }> {
  return variant.baseUnit === "GRAM";
}

function summarize(
  products: ReadonlyArray<ProduceSeedProduct>,
  assetCount: number,
): ProduceCatalogSummary {
  const byCategory: Record<string, number> = {};
  const byBaseUnit: Record<string, number> = {};
  const byMerchandisingLabel: Record<string, number> = {};
  const priceRangeByCategory: Record<string, ProducePriceRange> = {};
  let variantCount = 0;
  let minPriceMinor: number | null = null;
  let maxPriceMinor: number | null = null;

  for (const product of products) {
    byCategory[product.categoryCode] = (byCategory[product.categoryCode] ?? 0) + 1;
    byBaseUnit[product.inventoryBaseUnit] = (byBaseUnit[product.inventoryBaseUnit] ?? 0) + 1;
    let categoryMin = priceRangeByCategory[product.categoryCode]?.minPriceMinor ?? Number.MAX_SAFE_INTEGER;
    let categoryMax = priceRangeByCategory[product.categoryCode]?.maxPriceMinor ?? 0;
    for (const variant of product.variants) {
      variantCount += 1;
      if (variant.merchandisingLabel) {
        byMerchandisingLabel[variant.merchandisingLabel] =
          (byMerchandisingLabel[variant.merchandisingLabel] ?? 0) + 1;
      }
      categoryMin = Math.min(categoryMin, variant.priceMinor);
      categoryMax = Math.max(categoryMax, variant.priceMinor);
      minPriceMinor = minPriceMinor === null ? variant.priceMinor : Math.min(minPriceMinor, variant.priceMinor);
      maxPriceMinor = maxPriceMinor === null ? variant.priceMinor : Math.max(maxPriceMinor, variant.priceMinor);
    }
    priceRangeByCategory[product.categoryCode] = {
      minPriceMinor: categoryMin,
      maxPriceMinor: categoryMax,
    };
  }

  return {
    productCount: products.length,
    assetCount,
    variantCount,
    byCategory,
    byBaseUnit,
    byMerchandisingLabel,
    minPriceMinor,
    maxPriceMinor,
    priceRangeByCategory,
    unpricedVariantCount: 0,
    unavailableSkuCount: 0,
  };
}
