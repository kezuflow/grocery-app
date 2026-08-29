/**
 * Produce-catalog seed migration generator.
 *
 * `node apps/core/scripts/generate-produce-catalog.ts` validates the committed
 * manifest against the real public asset directory, derives already-seeded
 * product/SKU identifiers from every other migration, and writes
 * apps/core/migrations/0025_complete_produce_catalog.sql deterministically.
 * `--check` exits nonzero on any drift without modifying files.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { validateProduceCatalog } from "../src/catalog/seed/validate-produce-catalog.ts";
import { produceCatalog } from "../src/catalog/seed/produce-catalog.ts";
import { generateProduceCatalogSql } from "../src/catalog/seed/generate-produce-catalog-sql.ts";
import { selectCatalogSchemaMigrations } from "../src/catalog/seed/catalog-schema-boundary.ts";

const coreDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = join(coreDir, "migrations");
const outputName = "0025_complete_produce_catalog.sql";
const outputPath = join(migrationsDir, outputName);

const migrationFiles = selectCatalogSchemaMigrations(readdirSync(migrationsDir), outputName);

const database = new DatabaseSync(":memory:");
database.exec("PRAGMA foreign_keys=ON");
for (const name of migrationFiles) {
  database.exec("BEGIN; PRAGMA defer_foreign_keys=ON;");
  try {
    database.exec(readFileSync(join(migrationsDir, name), "utf8"));
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw new Error(`${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const existingProductIds = new Set(
  database
    .prepare("SELECT id FROM product")
    .all()
    .map((row) => String(row.id)),
);
const existingSkuIds = new Set(
  database
    .prepare("SELECT id FROM sku")
    .all()
    .map((row) => String(row.id)),
);
database.close();

const webProduceDir = join(coreDir, "..", "web", "public", "produce");
const assetKeys = readdirSync(webProduceDir)
  .filter((name) => name.endsWith(".webp"))
  .sort();

let validated;
try {
  validated = validateProduceCatalog({ products: produceCatalog, assetKeys });
} catch (error) {
  console.error(String(error));
  process.exit(1);
}

const sql = generateProduceCatalogSql(validated.products, {
  existingProductIds,
  existingSkuIds,
});

const summary = validated.summary;
console.info(
  `[produce-catalog] products=${summary.productCount} assets=${summary.assetCount} ` +
    `variants=${summary.variantCount} packs=${summary.byMerchandisingLabel.Pack ?? 0} ` +
    `bunches=${summary.byMerchandisingLabel.Bunch ?? 0} ` +
    `priceRange=${summary.minPriceMinor}-${summary.maxPriceMinor}`,
);

if (process.argv.includes("--check")) {
  let committed: string | null = null;
  try {
    committed = readFileSync(outputPath, "utf8");
  } catch {
    committed = null;
  }
  if (committed !== sql) {
    console.error(
      `[produce-catalog] drift detected: ${outputName} does not match the manifest. Run \`pnpm catalog:generate\`.`,
    );
    process.exit(1);
  }
  console.info("[produce-catalog] check OK: generated migration matches the manifest.");
  process.exit(0);
}

writeFileSync(outputPath, sql, "utf8");
assert.equal(readFileSync(outputPath, "utf8"), sql);
console.info(`[produce-catalog] wrote ${outputPath}`);
