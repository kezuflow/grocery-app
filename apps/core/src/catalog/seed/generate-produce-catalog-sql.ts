import {
  PRODUCE_CATEGORIES,
  produceCategory,
  type ProduceCategoryCode,
  type ProduceSeedProduct,
} from "./produce-catalog-types.ts";

/**
 * Deterministic additive-SQL generator for the complete produce launch
 * catalog. Pure over its inputs: identical manifests and seed-id sets always
 * produce byte-identical SQL, and every emitted statement is safe to re-run.
 *
 * Compatibility decisions encoded here:
 * - `category-fresh-fruits` becomes canonical FRUITS; `category-vegetables`
 *   already matches; the remaining five taxonomy rows are inserted.
 * - Legacy broad categories are deactivated after their products repoint.
 * - Reused products keep IDs/slugs/pools; retired SKU combinations on reused
 *   products (their legacy variants no longer in the manifest) deactivate so
 *   the storefront presents exactly the reviewed variant sets.
 * - Existing SKUs receive price version 2 with prior open-ended Metro Cebu
 *   STANDARD rows closed; brand-new SKUs start at version 1.
 * - Sourcing stays in the stored compatibility vocabulary of
 *   `PLANNED`; it never conflates sourcing with fulfillment mode.
 */

export const MARKET_METRO_CEBU = "market-metro-cebu";
export const LOCATION_CEBU_CENTRAL = "location-cebu-central";

export type GenerateProduceCatalogOptions = {
  existingProductIds?: ReadonlySet<string>;
  existingSkuIds?: ReadonlySet<string>;
};

const CATEGORY_COMPAT_UPDATES: ReadonlyArray<{
  id: string;
  code: ProduceCategoryCode;
  sortOrder: number;
}> = [
  { id: "category-fresh-fruits", code: "FRUITS", sortOrder: 1 },
  { id: "category-vegetables", code: "VEGETABLES", sortOrder: 2 },
];

const LEGACY_CATEGORY_IDS_TO_DEACTIVATE = [
  "category-fresh-produce",
  "category-leafy-greens",
  "category-pantry",
] as const;

/** Legacy rows reused as canonical taxonomy keep their committed IDs. */
const CATEGORY_ID_BY_CODE: Readonly<Record<ProduceCategoryCode, string>> = {
  FRUITS: "category-fresh-fruits",
  VEGETABLES: "category-vegetables",
  LEAFY_GREENS_HERBS: "category-leafy-greens-herbs",
  ROOTS_TUBERS_BULBS: "category-roots-tubers-bulbs",
  BEANS_PEAS_SEEDS: "category-beans-peas-seeds",
  AROMATICS_SPICES: "category-aromatics-spices",
  NATIVE_SPECIALTY_PRODUCE: "category-native-specialty-produce",
};

function categoryIdFor(code: ProduceCategoryCode): string {
  return CATEGORY_ID_BY_CODE[code];
}

export function sqlQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function kebab(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Canonical deterministic ordering: category, product name, then product ID. */
function sortedProducts(products: ReadonlyArray<ProduceSeedProduct>): ProduceSeedProduct[] {
  return [...products].sort((left, right) => {
    const categoryOrder =
      produceCategory(left.categoryCode).sortOrder - produceCategory(right.categoryCode).sortOrder;
    if (categoryOrder !== 0) return categoryOrder;
    const nameOrder = left.name.localeCompare(right.name, "en");
    if (nameOrder !== 0) return nameOrder;
    return left.id.localeCompare(right.id);
  });
}

function sortedVariants(product: ProduceSeedProduct): ProduceSeedProduct["variants"] {
  return [...product.variants].sort(
    (left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id),
  );
}

export function generateProduceCatalogSql(
  productsInput: ReadonlyArray<ProduceSeedProduct>,
  options: GenerateProduceCatalogOptions = {},
): string {
  const products = sortedProducts(productsInput);
  const existingProducts = options.existingProductIds ?? new Set<string>();
  const existingSkus = options.existingSkuIds ?? new Set<string>();

  const lines: string[] = [];
  const push = (...rows: string[]) => lines.push(...rows);

  push("-- GENERATED FILE — run `pnpm catalog:generate` to regenerate.");
  push("-- Deterministic additive seed for the complete produce launch catalog:");
  push("-- launch taxonomy reconciliation, product/media/detail rows, fixed");
  push("-- piece/weight/pack/bunch SKUs, Cebu availability, and versioned Metro");
  push("-- Cebu STANDARD prices. Sourcing vocabulary remains PLANNED.");
  push("");

  /* ---------------- Category taxonomy reconciliation ---------------- */
  push("-- Launch category taxonomy reconciliation.");
  for (const compat of CATEGORY_COMPAT_UPDATES) {
    const definition = produceCategory(compat.code);
    push(
      `UPDATE category SET code = ${sqlQuote(definition.code)}, name = ${sqlQuote(definition.name)}, slug = ${sqlQuote(definition.slug)}, sort_order = ${compat.sortOrder}, updated_at = 0 WHERE id = ${sqlQuote(compat.id)};`,
    );
  }
  for (const definition of PRODUCE_CATEGORIES) {
    if (CATEGORY_COMPAT_UPDATES.some((compat) => compat.code === definition.code)) continue;
    push(
      `INSERT OR IGNORE INTO category (id, code, name, slug, status, sort_order, created_at, updated_at) VALUES (${sqlQuote(CATEGORY_ID_BY_CODE[definition.code])}, ${sqlQuote(definition.code)}, ${sqlQuote(definition.name)}, ${sqlQuote(definition.slug)}, 'active', ${definition.sortOrder}, 0, 0);`,
    );
  }
  push(
    ...LEGACY_CATEGORY_IDS_TO_DEACTIVATE.map(
      (id) => `UPDATE category SET status = 'inactive', updated_at = 0 WHERE id = ${sqlQuote(id)};`,
    ),
  );
  // The non-produce farm-eggs product stays browsable under the specialty rail.
  push(
    `UPDATE product SET category_id = 'category-native-specialty-produce' WHERE id = 'product-eggs';`,
  );
  push("");

  const skuDeactivations: string[] = [];

  for (const [productIndex, product] of products.entries()) {
    const productId = product.id;
    const categoryId = categoryIdFor(product.categoryCode);
    const poolId = `pool-${product.slug}`;
    const baseUnitId = product.inventoryBaseUnit === "GRAM" ? "unit-gram" : "unit-piece";
    const mediaJson = JSON.stringify({
      version: 1,
      assetKey: product.media.assetKey,
      altText: product.media.altText,
    });

    if (productIndex === 0) push("-- Per-product catalog rows.");

    if (existingProducts.has(productId)) {
      push(
        `UPDATE product SET category_id = ${sqlQuote(categoryId)}, description = ${sqlQuote(product.description)}, status = 'active', image_metadata_json = ${sqlQuote(mediaJson)} WHERE id = ${sqlQuote(productId)};`,
      );
      push(
        `UPDATE inventory_pool SET sourcing_mode = 'PLANNED_PROCUREMENT', canonical_sourcing_mode = 'PLANNED', base_unit_id = ${sqlQuote(baseUnitId)} WHERE id = ${sqlQuote(poolId)};`,
      );
    } else {
      push(
        `INSERT OR IGNORE INTO inventory_pool (id, product_id, base_unit_id, sourcing_mode, canonical_sourcing_mode, created_at, updated_at) VALUES (${sqlQuote(poolId)}, ${sqlQuote(productId)}, ${sqlQuote(baseUnitId)}, 'PLANNED_PROCUREMENT', 'PLANNED', 0, 0);`,
      );
      push(
        `INSERT OR IGNORE INTO product (id, category_id, inventory_pool_id, slug, name, description, status, image_metadata_json, created_at, updated_at) VALUES (${[productId, categoryId, poolId, product.slug, product.name, product.description, "active", mediaJson].map(sqlQuote).join(", ")}, 0, 0);`,
      );
    }

    for (const detail of [...product.details].sort((a, b) => a.sortOrder - b.sortOrder)) {
      push(
        `INSERT OR IGNORE INTO product_detail (id, product_id, label, value, sort_order) VALUES (${["detail-product-" + kebab(product.slug + "-" + detail.label), productId, detail.label, detail.value, detail.sortOrder].map((v) => (typeof v === "number" ? String(v) : sqlQuote(v))).join(", ")});`,
      );
    }

    const legacyPrefix = `sku-${product.slug}-`;
    const retiredIds = [...existingSkus]
      .filter((skuId) => skuId.startsWith(legacyPrefix))
      .filter((skuId) => !product.variants.some((variant) => variant.id === skuId))
      .sort();
    if (retiredIds.length > 0) {
      skuDeactivations.push(
        `UPDATE sku SET status = 'inactive', updated_at = 0 WHERE id IN (${retiredIds.map(sqlQuote).join(",")});`,
      );
    }

    // Product-level Cebu availability remains for compatibility reads.
    push(
      `INSERT OR IGNORE INTO location_product_availability (location_id, product_id, availability_status, sourcing_mode, valid_from) VALUES (${[LOCATION_CEBU_CENTRAL, productId, "AVAILABLE", "PLANNED"].map(sqlQuote).join(", ")}, 0);`,
    );

    for (const variant of sortedVariants(product)) {
      if (!existingSkus.has(variant.id)) {
        const unitId =
          variant.sellUnitCode === "KG"
            ? "unit-kilogram"
            : variant.sellUnitCode === "PC"
              ? "unit-piece"
              : "unit-gram";
        push(
          `INSERT OR IGNORE INTO sku (id, product_id, code, name, sellable_unit_id, sell_quantity, consumption_base_quantity, merchandising_label, status, sort_order, version, created_at, updated_at) VALUES (${[
            variant.id,
            productId,
            variant.code,
            variant.displayName,
            unitId,
            variant.sellQuantity,
            variant.inventoryQuantityBase,
            variant.merchandisingLabel ?? null,
            "active",
            variant.sortOrder,
            1,
          ]
            .map((value) =>
              value === null
                ? "NULL"
                : typeof value === "number"
                  ? String(value)
                  : sqlQuote(String(value)),
            )
            .join(", ")}, 0, 0);`,
        );
      }

      if (variant.customerContentsNote) {
        push(
          `INSERT OR IGNORE INTO sku_detail (id, sku_id, audience, label, value, sort_order) VALUES (${[`${variant.id}-detail-customer`, variant.id, "CUSTOMER", "Contents", variant.customerContentsNote].map((v) => sqlQuote(String(v))).join(", ")}, 1);`,
        );
      }
      if (variant.packingInstruction) {
        push(
          `INSERT OR IGNORE INTO sku_detail (id, sku_id, audience, label, value, sort_order) VALUES (${[`${variant.id}-detail-operations`, variant.id, "OPERATIONS", "Packing instruction", variant.packingInstruction].map((v) => sqlQuote(String(v))).join(", ")}, 1);`,
        );
      }

      push(
        `INSERT OR IGNORE INTO sku_location_availability (sku_id, location_id, availability_status, sourcing_mode, version) VALUES (${[variant.id, LOCATION_CEBU_CENTRAL, "AVAILABLE", "PLANNED"].map(sqlQuote).join(", ")}, 1);`,
      );

      const isReused = existingSkus.has(variant.id);
      const priceVersion = isReused ? 2 : 1;
      if (isReused) {
        push(
          `UPDATE price_version SET valid_to = 1 WHERE sku_id = ${sqlQuote(variant.id)} AND valid_to IS NULL AND market_id = ${sqlQuote(MARKET_METRO_CEBU)} AND price_type = 'STANDARD';`,
        );
      }
      const priceId = `price-${kebab(variant.code)}-v${priceVersion}`;
      push(
        `INSERT OR IGNORE INTO price_version (id, sku_id, currency, amount_minor, valid_from, market_id, location_id, price_type, version, created_at) VALUES (${[priceId, variant.id, "PHP", variant.priceMinor, 1, MARKET_METRO_CEBU, null, "STANDARD", priceVersion, 0].map((value) => (value === null ? "NULL" : typeof value === "number" ? String(value) : sqlQuote(String(value)))).join(", ")});`,
      );
    }
    push("");
  }

  if (skuDeactivations.length > 0) {
    push("-- Retired variant combinations on reused products leave the storefront,");
    push("-- keeping order/cart foreign keys intact while display moves forward.");
    lines.push(...skuDeactivations, "");
  }

  return lines.join("\n") + "\n";
}
