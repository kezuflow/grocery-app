# Produce Catalog Storefront Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Seed every produce image as a complete D1-backed catalog product and make the Scheduled Cebu storefront browse, search, categorize, paginate, and display those products and their fixed piece, weight, pack, or bunch variants without Web-owned catalog data.

**Architecture:** A typed Core seed manifest is validated against the 226 public produce assets and deterministically generates an additive seed migration. D1 is runtime authority; Core returns purpose-built media/detail/variant/home/search DTOs through the Service Binding, and Web renders those DTOs without a slug-to-image map. Launch availability is Scheduled and Admin-flag-driven; current compatibility sourcing values remain internal and physical inventory behavior is deferred to future Instant/On-demand work.

**Tech Stack:** TypeScript 7, Node.js 24 native type stripping, pnpm 11, Drizzle ORM/D1 SQLite, Cloudflare Workers RPC Service Bindings, vinext/React 19, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/PRODUCE_CATALOG_STOREFRONT_DESIGN.md`

## Global Constraints

- Read `AGENTS.md`, the Spec above, `docs/architecture/ARCHITECTURE.md`, `docs/architecture/DOMAIN_MODEL.md`, `docs/architecture/DATA_MODEL.md`, `docs/architecture/API_CONTRACTS.md`, `docs/design/marketplace/DESIGN.md`, and `docs/product/IMPLEMENTATION_PLAN.md` before editing.
- Work directly on `main` under `TRUNK.md`; do not create a feature branch or PR.
- Preserve all pre-existing uncommitted storefront changes. Inspect `git status --short` before every commit and stage only files belonging to the current task.
- Do not rewrite migrations `0001` through `0023`; use additive migrations beginning at `0024`.
- Core and D1 remain authoritative. Web must not access D1 or reproduce catalog, availability, pricing, unit, or fulfillment decisions.
- Cebu launch fulfillment is `SCHEDULED`. Storefront visibility uses active Product/SKU state, valid price, and the Cebu availability flag, not on-hand inventory.
- Do not implement future `INSTANT`/On-demand availability, raw customer stock counts, R2 binary migration, Admin UI redesign, supplier integration, substitutions, or variable-weight settlement.
- New pack/bunch SKUs use `G`, `KG`, or `PC`; never introduce a universal `PACK` or `BUNCH` conversion.
- Staff-assembled variable-content packs have an exact gram recipe and may expose only an approximate customer contents note.
- Keep the stored compatibility sourcing vocabulary (`PLANNED_PROCUREMENT`) in the existing commerce schema during this plan. Do not perform the broad `PLANNED_PROCUREMENT`/`HYBRID` to `PLANNED`/`MIXED` remediation; hide sourcing from the public catalog DTO.
- All money is positive integer PHP centavos. All authoritative base quantities are positive integers in `GRAM` or `PIECE`.
- Every task follows red-green-refactor, ends with focused verification, and commits only its own files.

---

### Task 1: Add typed catalog media, detail, variant, home, and pagination contracts

**Files:**
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/src/catalog.test.ts`
- Test: `packages/contracts/src/catalog.test.ts`

**Interfaces:**
- Produces: `CatalogMedia`, `CatalogDetail`, expanded `CatalogVariant`, expanded `CatalogProduct`, `MarketplaceHomeView`, `MarketplaceHomeRequest`, and category-aware cursor fields on `CatalogSearchRequest`.
- Public DTOs do not contain `packingInstruction`, D1 rows, image JSON, or sourcing mode.

- [ ] **Step 1: Record and protect the working tree**

Run:

```powershell
git status --short
git diff --stat
```

Expected: existing Web/storefront changes are visible. Save the output in the task notes and do not stage those paths unless a later task explicitly modifies them.

- [ ] **Step 2: Write failing contract-shape tests**

Extend `packages/contracts/src/catalog.test.ts` with compile/runtime fixtures equivalent to:

```ts
const product: CatalogProduct = {
  id: "product-chili-pepper-fruit-siling-labuyo",
  slug: "chili-pepper-fruit-siling-labuyo",
  name: "Siling Labuyo",
  description: "Fresh local chili peppers.",
  category: { code: "AROMATICS_SPICES", name: "Aromatics & Spices", slug: "aromatics-spices" },
  media: { src: "/produce/chili-pepper-fruit-siling-labuyo.webp", alt: "Fresh siling labuyo chili peppers" },
  details: [{ label: "Storage", value: "Keep refrigerated.", sortOrder: 1 }],
  available: true,
  variants: [{
    id: "sku-chili-pepper-fruit-siling-labuyo-pack",
    code: "CHILI_PEPPER_FRUIT_SILING_LABUYO_PACK",
    name: "1 pack",
    merchandisingLabel: "Pack",
    sellQuantity: 100,
    sellUnitCode: "G",
    unit: "g",
    consumptionBaseQuantity: 100,
    contentsNote: "Approximately 10–15 chili peppers per pack.",
    priceMinor: 6500,
    currency: "PHP",
    priceVersion: 1,
  }],
};

const home: MarketplaceHomeView = {
  categories: [{ code: "AROMATICS_SPICES", name: "Aromatics & Spices", slug: "aromatics-spices" }],
  rails: [{ code: "AROMATICS_SPICES", title: "Aromatics & Spices", categorySlug: "aromatics-spices", items: [product] }],
};

expect(product.media.alt).toContain("chili");
expect(home.rails[0]?.items).toHaveLength(1);
```

Also assert that a `CatalogSearchRequest` accepts `categorySlug`, `cursor`, `limit`, and `locationId`.

- [ ] **Step 3: Run the contract test and observe failure**

Run:

```powershell
pnpm --filter @freshmarkets/contracts test -- catalog.test.ts
```

Expected: FAIL because media, details, merchandising fields, home DTOs, and search filters are not defined.

- [ ] **Step 4: Add the exact public contract types**

Implement these shapes in `packages/contracts/src/index.ts`:

```ts
export type CatalogMedia = { src: string; alt: string };
export type CatalogDetail = { label: string; value: string; sortOrder: number };

export type CatalogVariant = {
  id: string;
  code: string;
  name: string;
  merchandisingLabel: string | null;
  sellQuantity: number;
  sellUnitCode: "G" | "KG" | "PC";
  unit: string;
  consumptionBaseQuantity: number;
  contentsNote: string | null;
  priceMinor: number | null;
  currency: string | null;
  priceVersion: number | null;
};

export type MarketplaceHomeRail = {
  code: string;
  title: string;
  categorySlug: string;
  items: ReadonlyArray<CatalogProduct>;
};

export type MarketplaceHomeView = {
  categories: CategoryNavigationView["categories"];
  rails: ReadonlyArray<MarketplaceHomeRail>;
};

export type MarketplaceHomeRequest = RequestMeta & {
  locationId?: string;
  itemsPerRail?: number;
};
```

Add `media: CatalogMedia | null` and `details` to `CatalogProduct`. Remove `sourcingMode` from the public type only after all Core/Web callers in later tasks are migrated; if deployment skew requires compatibility, keep it deprecated and unused until Task 8, then remove it in the final coordinated contract change.

Extend `CatalogSearchRequest` with `categorySlug?: string` and `cursor?: string`. Define the home request/view DTOs in this task, but add `getMarketplaceHome` to `CatalogService`, `CoreServiceBinding`, and `CoreEntrypoint` atomically with its real implementation in Task 6; do not introduce a stubbed runtime method.

- [ ] **Step 5: Run contract tests and type checks**

Run:

```powershell
pnpm --filter @freshmarkets/contracts test
pnpm --filter @freshmarkets/contracts typecheck
```

Expected: PASS. If Web fails only because its presentation fixtures require the new fields, add explicit null/empty values to test fixtures without implementing Web behavior early.

- [ ] **Step 6: Commit the contract boundary**

```powershell
git add -- packages/contracts/src/index.ts packages/contracts/src/catalog.test.ts
git commit -m "feat(catalog): define marketplace catalog read models"
```

### Task 2: Add additive catalog-detail and SKU-availability persistence

**Files:**
- Create: `apps/core/migrations/0024_catalog_details_and_sku_availability.sql`
- Modify: `apps/core/src/catalog/schema.ts`
- Modify: `scripts/verify-migrations.mjs`
- Create: `apps/core/src/catalog/catalog-schema.integration.test.ts`

**Interfaces:**
- Produces D1 tables `product_detail`, `sku_detail`, and `sku_location_availability`.
- Adds `sku.merchandising_label`, `sku.sell_quantity`, and `sku.version` while retaining existing `consumption_base_quantity`.
- Continues to use `product.image_metadata_json` as a validated compatibility media record.

- [ ] **Step 1: Write a failing fresh-schema integration test**

Create `catalog-schema.integration.test.ts` that queries `PRAGMA table_info` and asserts:

```ts
expect(await columns("sku")).toEqual(expect.arrayContaining([
  "merchandising_label",
  "sell_quantity",
  "version",
]));
expect(await tableExists("product_detail")).toBe(true);
expect(await tableExists("sku_detail")).toBe(true);
expect(await tableExists("sku_location_availability")).toBe(true);
```

Insert one chili product/SKU whose sell unit is `unit-gram`, `sell_quantity=100`, `consumption_base_quantity=100`, merchandising label `Pack`, one CUSTOMER contents detail, one OPERATIONS packing detail, and one Cebu `AVAILABLE` row. Assert foreign keys and positive-quantity checks reject invalid rows.

- [ ] **Step 2: Run the focused test and observe failure**

Run:

```powershell
pnpm --filter @freshmarkets/core test -- catalog-schema.integration.test.ts
```

Expected: FAIL because the additive schema does not exist.

- [ ] **Step 3: Write migration `0024`**

Add columns with safe compatibility defaults, backfill existing SKUs, then create guards:

```sql
ALTER TABLE sku ADD COLUMN merchandising_label TEXT;
ALTER TABLE sku ADD COLUMN sell_quantity INTEGER NOT NULL DEFAULT 1 CHECK (sell_quantity > 0);
ALTER TABLE sku ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0);

UPDATE sku
SET sell_quantity = consumption_base_quantity
WHERE sellable_unit_id IN ('unit-gram', 'unit-piece');
UPDATE sku
SET sell_quantity = 1, merchandising_label = 'Pack'
WHERE sellable_unit_id = 'unit-pack';

CREATE TABLE product_detail (
  id TEXT PRIMARY KEY NOT NULL,
  product_id TEXT NOT NULL REFERENCES product(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  value TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE(product_id, label)
);

CREATE TABLE sku_detail (
  id TEXT PRIMARY KEY NOT NULL,
  sku_id TEXT NOT NULL REFERENCES sku(id) ON DELETE CASCADE,
  audience TEXT NOT NULL CHECK (audience IN ('CUSTOMER', 'OPERATIONS')),
  label TEXT NOT NULL,
  value TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE(sku_id, audience, label)
);

CREATE TABLE sku_location_availability (
  sku_id TEXT NOT NULL REFERENCES sku(id) ON DELETE CASCADE,
  location_id TEXT NOT NULL REFERENCES fulfillment_location(id) ON DELETE CASCADE,
  availability_status TEXT NOT NULL CHECK (availability_status IN ('AVAILABLE', 'UNAVAILABLE')),
  sourcing_mode TEXT NOT NULL CHECK (sourcing_mode IN ('STOCKED', 'PLANNED_PROCUREMENT', 'HYBRID')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  PRIMARY KEY (sku_id, location_id)
);
CREATE INDEX sku_location_availability_location_idx
  ON sku_location_availability(location_id, availability_status, sku_id);
```

Backfill `sku_location_availability` from `location_product_availability` joined to active SKUs, using `COALESCE(lpa.sourcing_mode, ip.sourcing_mode)`.

- [ ] **Step 4: Update the Drizzle schema exactly once**

Add typed definitions for the new columns/tables in `apps/core/src/catalog/schema.ts`. Also add the already-migrated `marketId`, `locationId`, and `priceType` fields to `priceVersion` so the Drizzle model matches migrations `0010` and `0012`. Do not change historical SQL.

- [ ] **Step 5: Strengthen migration verification**

Extend `assertFinalSchema` in `scripts/verify-migrations.mjs` to assert the three new tables, SKU columns, Cebu backfill rows, and `PRAGMA foreign_key_check = []` for both fresh and populated upgrade paths.

- [ ] **Step 6: Run persistence verification**

```powershell
pnpm migration:check
pnpm --filter @freshmarkets/core test -- catalog-schema.integration.test.ts
pnpm --filter @freshmarkets/core typecheck
```

Expected: all PASS.

- [ ] **Step 7: Commit persistence foundations**

```powershell
git add -- apps/core/migrations/0024_catalog_details_and_sku_availability.sql apps/core/src/catalog/schema.ts apps/core/src/catalog/catalog-schema.integration.test.ts scripts/verify-migrations.mjs
git commit -m "feat(catalog): add product detail and SKU availability storage"
```

### Task 3: Build the typed manifest and aggregate validator

**Files:**
- Create: `apps/core/src/catalog/seed/produce-catalog-types.ts`
- Create: `apps/core/src/catalog/seed/produce-catalog-categories.ts`
- Create: `apps/core/src/catalog/seed/validate-produce-catalog.ts`
- Create: `apps/core/src/catalog/seed/validate-produce-catalog.test.ts`

**Interfaces:**
- Produces: `ProduceSeedProduct`, `ProduceSeedVariant`, `produceCategories`, `validateProduceCatalog(input)`.
- `validateProduceCatalog` returns `{ products, summary }` or throws one `ProduceCatalogValidationError` containing every violation.

- [ ] **Step 1: Write failing validation tests**

Cover a valid chili pack and aggregate failures for duplicate asset, missing file, invalid category, nonpositive price, dimension mismatch, range-as-consumption, and missing operations instruction. Use a temporary asset-name set injected into the validator rather than touching the real directory in unit tests.

```ts
expect(() => validateProduceCatalog({ products: invalid, assetKeys })).toThrowError(
  /duplicate asset.*missing asset.*dimension.*packing instruction/s,
);
```

- [ ] **Step 2: Run and observe failure**

```powershell
pnpm --filter @freshmarkets/core test -- validate-produce-catalog.test.ts
```

Expected: FAIL because seed types and validator do not exist.

- [ ] **Step 3: Define controlled types and categories**

Define only these categories: `FRUITS`, `VEGETABLES`, `LEAFY_GREENS_HERBS`, `ROOTS_TUBERS_BULBS`, `BEANS_PEAS_SEEDS`, `AROMATICS_SPICES`, and `NATIVE_SPECIALTY_PRODUCE` with stable slugs and sort order 1–7.

Define variant discriminants so invalid cross-dimensional recipes are hard to express:

```ts
type MassVariant = {
  baseUnit: "GRAM";
  sellUnitCode: "G" | "KG";
  sellQuantity: number;
  inventoryQuantityBase: number;
};
type CountVariant = {
  baseUnit: "PIECE";
  sellUnitCode: "PC";
  sellQuantity: number;
  inventoryQuantityBase: number;
};
export type ProduceSeedVariant = (MassVariant | CountVariant) & VariantDisplayAndPrice;
```

- [ ] **Step 4: Implement aggregate validation and summary**

Validate the asset/product bijection, stable IDs, slug/code uniqueness, positive integers, category membership, description/detail/media completeness, dimension compatibility, pack recipes, customer/operations audience separation, and availability defaults. Produce summary counts by category, merchandising label, base unit, variants, and min/max price.

- [ ] **Step 5: Run tests and commit**

```powershell
pnpm --filter @freshmarkets/core test -- validate-produce-catalog.test.ts
pnpm --filter @freshmarkets/core typecheck
git add -- apps/core/src/catalog/seed
git commit -m "feat(catalog): validate typed produce seed manifests"
```

### Task 4: Curate all 226 produce products and mock prices

**Files:**
- Create: `apps/core/src/catalog/seed/produce-catalog.ts`
- Create: `apps/core/src/catalog/seed/produce-catalog.integrity.test.ts`

**Interfaces:**
- Produces: `produceCatalog: ReadonlyArray<ProduceSeedProduct>` containing exactly one entry per `.webp` asset.
- Existing product/SKU IDs from migrations `0004` and `0023` are reused when they represent the same item; collisions are reconciled explicitly.

- [ ] **Step 1: Write the real-directory integrity test**

Read `apps/web/public/produce`, pass the sorted `.webp` names plus `produceCatalog` to `validateProduceCatalog`, and assert:

```ts
expect(assetKeys).toHaveLength(226);
expect(validated.products).toHaveLength(226);
expect(new Set(validated.products.map((p) => p.media.assetKey))).toEqual(new Set(assetKeys));
expect(validated.summary.unpricedVariantCount).toBe(0);
expect(validated.summary.unavailableSkuCount).toBe(0);
```

- [ ] **Step 2: Run and observe failure**

```powershell
pnpm --filter @freshmarkets/core test -- produce-catalog.integrity.test.ts
```

Expected: FAIL because the explicit 226-entry manifest does not exist.

- [ ] **Step 3: Populate explicit product records in category groups**

Use the image basename as the default slug, convert it into a readable market name, and manually correct Filipino/common names. Reuse current identifiers for avocado, banana Lakatan, mango Carabao, strawberry, pineapple, watermelon, calamansi, papaya, tomato, carrot, broccoli, cabbage, eggplant, kangkong, pechay, garlic, and red onion instead of duplicating them. Reconcile the current generic cucumber to `/produce/cucumber.webp` and add Japanese cucumber as its own product.

Every product gets a factual, non-medical one- or two-sentence description and at least `Contents` plus `Storage` details. Do not invent health claims, organic certification, exact farm origin, seedlessness, or Cebu-grown provenance unless it is encoded in the source name.

- [ ] **Step 4: Assign fixed variants and recipes**

Apply these consistent rules, then make product-specific corrections:

- Loose roots/tubers/bulbs: `250 g`, `500 g`, `1 kg`.
- Loose beans/peas: `250 g`, `500 g` unless normally sold dry, in which case retain the same fixed weights but categorize appropriately.
- Large countable fruits/vegetables: `1 piece`; add a fixed multi-piece SKU only when operationally credible.
- Chilies: `1 pack`, usually 100 g; customer note gives an approximate piece range and operations detail gives exact grams.
- Herbs: `1 pack` or `1 bunch`, usually 50 g or 100 g depending on density.
- Leafy greens/tops/leaves/flowers: `1 bunch` or `1 pack`, usually 200–250 g.
- Small specialty produce: use a 100–250 g assembled pack when piece sale would be impractical.

For every assembled pack/bunch, keep `sellUnitCode: "G"`, set `sellQuantity` and `inventoryQuantityBase` to the exact same gram recipe, and store the approximate count only as customer copy.

- [ ] **Step 5: Assign sensible mock prices**

Use product-specific PHP reference prices with consistent variant derivation. Keep normal variants broadly within ₱20–₱500 unless the produce is a credibly premium item. Add a small assembly premium to packs/bunches, round to whole-peso or five-peso increments, and keep all values integer centavos. Review the generated category min/max summary and correct implausible outliers manually.

- [ ] **Step 6: Run integrity tests and review the summary**

```powershell
pnpm --filter @freshmarkets/core test -- produce-catalog.integrity.test.ts
pnpm --filter @freshmarkets/core typecheck
```

Expected: PASS with 226 products, 226 unique assets, zero missing prices, zero unavailable launch SKUs, and no validator errors.

- [ ] **Step 7: Commit the curated manifest**

```powershell
git add -- apps/core/src/catalog/seed/produce-catalog.ts apps/core/src/catalog/seed/produce-catalog.integrity.test.ts
git commit -m "feat(catalog): curate complete produce seed data"
```

### Task 5: Generate and verify the immutable D1 seed migration

**Files:**
- Create: `apps/core/src/catalog/seed/generate-produce-catalog-sql.ts`
- Create: `apps/core/src/catalog/seed/generate-produce-catalog-sql.test.ts`
- Create: `apps/core/scripts/generate-produce-catalog.ts`
- Create: `apps/core/migrations/0025_complete_produce_catalog.sql`
- Modify: `package.json`
- Modify: `scripts/verify-migrations.mjs`

**Interfaces:**
- Produces: `generateProduceCatalogSql(products): string` with stable category/product/pool/SKU/detail/media/availability/price ordering.
- Produces root scripts `catalog:generate` and `catalog:check`.

- [ ] **Step 1: Write failing deterministic SQL tests**

Assert identical input produces byte-identical output, apostrophes are SQL-escaped, current IDs use price version 2 with old v1 closed, new IDs use v1, and generated SQL contains no `unit-pack` or public packing instructions.

- [ ] **Step 2: Run and observe failure**

```powershell
pnpm --filter @freshmarkets/core test -- generate-produce-catalog-sql.test.ts
```

- [ ] **Step 3: Implement the pure generator**

Generate additive SQL in this order: categories; compatibility updates for reused products; inventory pools; products including versioned `image_metadata_json`; SKUs; product details; customer and operations SKU details; product-level compatibility availability; SKU-level availability; closure of overlapping current prices; new versioned prices.

Use `market-metro-cebu`, `location-cebu-central`, `STANDARD`, `PHP`, and compatibility sourcing `PLANNED_PROCUREMENT`. Keep existing order/cart foreign-key IDs stable.

- [ ] **Step 4: Implement CLI check/write modes**

`node apps/core/scripts/generate-produce-catalog.ts` writes `0025_complete_produce_catalog.sql` only after successful validation. `--check` compares generated bytes with the committed migration and exits nonzero on drift without modifying files.

Add:

```json
"catalog:generate": "node apps/core/scripts/generate-produce-catalog.ts",
"catalog:check": "node apps/core/scripts/generate-produce-catalog.ts --check"
```

- [ ] **Step 5: Generate the migration and extend migration assertions**

Run `pnpm catalog:generate`. Extend `verify-migrations.mjs` to assert 226 distinct `image_metadata_json` asset keys, 226 matching public assets at script level, every active produce SKU has Cebu SKU availability, all active SKUs have a current positive Metro Cebu standard price, and foreign keys remain valid on fresh and populated upgrades.

- [ ] **Step 6: Verify drift and migrations**

```powershell
pnpm catalog:check
pnpm migration:check
pnpm --filter @freshmarkets/core test -- generate-produce-catalog-sql.test.ts produce-catalog.integrity.test.ts
git diff --check
```

Expected: all PASS and a second `pnpm catalog:generate` produces no diff.

- [ ] **Step 7: Commit generated persistence**

```powershell
git add -- package.json apps/core/scripts/generate-produce-catalog.ts apps/core/src/catalog/seed/generate-produce-catalog-sql.ts apps/core/src/catalog/seed/generate-produce-catalog-sql.test.ts apps/core/migrations/0025_complete_produce_catalog.sql scripts/verify-migrations.mjs
git commit -m "feat(catalog): generate complete produce catalog migration"
```

### Task 6: Replace N+1 catalog reads with filtered cursor queries and a home read model

**Files:**
- Modify: `packages/contracts/src/catalog.ts`
- Modify: `apps/core/src/catalog/service.ts`
- Replace/expand: `apps/core/src/catalog/service.test.ts`
- Create: `apps/core/src/catalog/service.integration.test.ts`
- Modify: `apps/core/src/index.ts`

**Interfaces:**
- Consumes the Task 1 DTOs and Task 2 tables.
- Produces `CatalogService.getMarketplaceHome(request)`, `searchCatalog(database, input)`, `getProduct(database, slug, locationId?)`, and `getMarketplaceHome(database, input)` without per-product query loops.
- Cursor payload is opaque base64url JSON containing deterministic ordering fields and a stable ID tie-breaker.

- [ ] **Step 1: Write failing integration tests**

Seed/apply migrations and assert:

- `searchCatalog({ limit: 24 })` returns 24 plus a non-null cursor.
- Following cursors visits all 226 produce mappings once without duplicates.
- `categorySlug` filters before pagination.
- Search matches common/local names case-insensitively.
- Unavailable SKU and missing/nonpositive price do not appear as sellable.
- Product detail returns media, ordered product details, customer SKU detail, and never the operations packing instruction.
- Home returns at most the requested items per rail and never materializes all 226 items.

- [ ] **Step 2: Run and observe failure**

```powershell
pnpm --filter @freshmarkets/core test -- service.integration.test.ts
```

- [ ] **Step 3: Implement batched read-model assembly**

Query a page of eligible product IDs first, then fetch products/categories/pools, active SKUs/units/SKU availability, current scoped prices, product details, customer SKU details, and typed media in bounded set-based queries. Group rows in application memory by ID. Do not issue queries inside a product loop.

Parse `image_metadata_json` through a small versioned validator:

```ts
type PublicProduceMediaV1 = { version: 1; assetKey: string; altText: string };
```

Return `/produce/${assetKey}` only after rejecting path traversal, slash, and non-`.webp` values. Invalid media becomes the DTO's established placeholder/null representation rather than a guessed path.

- [ ] **Step 4: Implement stable cursor and category/search predicates**

Validate cursor decoding and page limit `1..50`. Apply active Product/SKU, category, Cebu SKU availability, and current positive price predicates before limit. Use stable category sort/product name/product ID ordering. Return `VALIDATION_FAILED` through the existing Core result envelope for malformed cursors.

- [ ] **Step 5: Implement `getMarketplaceHome`**

Return active categories and bounded rails, defaulting `itemsPerRail` to 8 and capping it at 12. Reuse the same eligibility and row-assembly functions as search; do not duplicate pricing/media/availability rules.

- [ ] **Step 6: Wire the Core entrypoint and verify**

Add `getMarketplaceHome` to `packages/contracts/src/catalog.ts` and implement the matching real query and safe error mapping in `apps/core/src/index.ts` in the same commit.

```powershell
pnpm --filter @freshmarkets/core test -- service.test.ts service.integration.test.ts
pnpm --filter @freshmarkets/core typecheck
pnpm --filter @freshmarkets/core build
```

- [ ] **Step 7: Commit Core queries**

```powershell
git add -- packages/contracts/src/catalog.ts apps/core/src/catalog/service.ts apps/core/src/catalog/service.test.ts apps/core/src/catalog/service.integration.test.ts apps/core/src/index.ts
git commit -m "feat(catalog): serve paginated marketplace catalog views"
```

### Task 7: Make Web presentation entirely Core-media and detail driven

**Files:**
- Modify: `apps/web/lib/storefront/catalog-presentation.ts`
- Modify: `apps/web/lib/storefront/catalog-presentation.test.ts`
- Modify: `apps/web/components/storefront/catalog-components.tsx`
- Modify: `apps/web/components/storefront/marketplace/product-quick-view.tsx`
- Modify: `apps/web/app/products/[slug]/product-view.tsx`
- Modify: `apps/web/app/products/[slug]/page.tsx`

**Interfaces:**
- Consumes expanded `CatalogProduct`/`CatalogVariant` DTOs.
- Produces presentation models carrying Core media alt text, ordered details, merchandising labels, and contents notes.
- Deletes `imageBySlug` and all catalog slug/image decisions from Web.

- [ ] **Step 1: Update tests first**

Replace fixtures with Core media/details. Assert chili renders `1 pack`, approximate contents, and `/produce/chili-pepper-fruit-siling-labuyo.webp`; weight products retain `500 g`; invalid/missing media uses the accessible leaf placeholder. Add an integrity assertion that the source file contains no `imageBySlug` constant.

- [ ] **Step 2: Run and observe failure**

```powershell
pnpm --filter @freshmarkets/web test -- catalog-presentation.test.ts
```

- [ ] **Step 3: Update presentation mapping**

Carry `media`, `details`, `merchandisingLabel`, and `contentsNote` directly from DTOs. Continue to select a deterministic priced default variant, but use fixed variant metadata rather than inferring pack/count behavior from `consumptionBaseQuantity >= 100`.

- [ ] **Step 4: Render detail content accessibly**

Cards show image/alt, product, fixed display variant, price, and availability. Quick view and product detail show ordered product details plus the selected variant's contents note. Do not render operations packing instructions or raw base consumption to customers.

- [ ] **Step 5: Run focused Web verification**

```powershell
pnpm --filter @freshmarkets/web test -- catalog-presentation.test.ts
pnpm --filter @freshmarkets/web typecheck
```

- [ ] **Step 6: Commit only the relevant Web paths**

Review `git diff` carefully because these files may overlap user work. Preserve existing navigation/cart changes and stage only intentional hunks.

```powershell
git diff -- apps/web/lib/storefront/catalog-presentation.ts apps/web/components/storefront/catalog-components.tsx apps/web/components/storefront/marketplace/product-quick-view.tsx apps/web/app/products
git add -p -- apps/web/lib/storefront/catalog-presentation.ts apps/web/lib/storefront/catalog-presentation.test.ts apps/web/components/storefront/catalog-components.tsx apps/web/components/storefront/marketplace/product-quick-view.tsx apps/web/app/products
git commit -m "feat(web): render database-backed produce details"
```

### Task 8: Use the home read model and paginated category/search results

**Files:**
- Modify: `apps/web/app/page.tsx`
- Modify: `apps/web/app/api/catalog/route.ts`
- Create: `apps/web/components/storefront/marketplace/catalog-results.tsx`
- Create: `apps/web/components/storefront/marketplace/catalog-results.test.tsx`
- Modify: `apps/web/tests/storefront-home.spec.ts`
- Modify: `apps/web/app/api/catalog/product/route.ts` only if required by the expanded DTO.

**Interfaces:**
- Home consumes `coreClient(env.CORE).getMarketplaceHome`.
- Search/category results consume `searchCatalog` with `query`, `categorySlug`, `cursor`, and bounded `limit`.
- `CatalogResults` owns progressive page loading while preserving URL state and accessible status announcements.

- [ ] **Step 1: Write failing result/home tests**

Assert home renders multiple Core rails without loading a 226-item array, category selection is sent to Core rather than filtered after a 50-item response, and `Load more` appends the next cursor page without duplicates. Assert empty/error states and repeated live announcements.

- [ ] **Step 2: Run and observe failure**

```powershell
pnpm --filter @freshmarkets/web test -- catalog-results.test.tsx
```

- [ ] **Step 3: Migrate the server-rendered home**

Use `getMarketplaceHome({ requestId, itemsPerRail: 8 })` for the normal home. For active search/category URLs, call `searchCatalog` with server-side category/query predicates and render the first page. Do not client-filter a globally truncated list.

- [ ] **Step 4: Add progressive pagination**

Implement an accessible client boundary that requests `/api/catalog?q=...&category=...&cursor=...`, appends unique product IDs, updates loading/error status, and hides the control when `nextCursor` is null. Keep query/category in the URL; the cursor itself need not be user-visible.

- [ ] **Step 5: Update route parameter forwarding**

Forward `category`, `cursor`, `limit`, and `locationId` in `apps/web/app/api/catalog/route.ts`. Parse Core validation errors into the existing JSON envelope without exposing internals.

- [ ] **Step 6: Extend Playwright coverage**

Cover home rails, a category containing more than one page, load-more uniqueness, search, a chili pack detail/contents note, a weighted potato/onion variant, image success, media fallback, and no console errors. Reuse the existing stack fixtures rather than hard-coding Core responses in the browser test unless that is the established test pattern.

- [ ] **Step 7: Run Web verification**

```powershell
pnpm --filter @freshmarkets/web test
pnpm --filter @freshmarkets/web typecheck
pnpm --filter @freshmarkets/web build
pnpm --filter @freshmarkets/web test:e2e -- storefront-home.spec.ts
```

Expected: all PASS.

- [ ] **Step 8: Commit with dirty-worktree care**

```powershell
git diff -- apps/web/app/page.tsx apps/web/app/api/catalog apps/web/components/storefront/marketplace/catalog-results.tsx apps/web/tests/storefront-home.spec.ts
git add -p -- apps/web/app/page.tsx apps/web/app/api/catalog/route.ts apps/web/app/api/catalog/product/route.ts apps/web/components/storefront/marketplace/catalog-results.tsx apps/web/components/storefront/marketplace/catalog-results.test.tsx apps/web/tests/storefront-home.spec.ts
git commit -m "feat(web): browse the complete paginated produce catalog"
```

### Task 9: Reconcile contracts, documentation, and full acceptance

**Files:**
- Modify: `docs/architecture/DATA_MODEL.md`
- Modify: `docs/architecture/API_CONTRACTS.md`
- Modify: `docs/architecture/ARCHITECTURE.md` only to document the approved temporary public-asset media compatibility and deferred R2 binary migration.
- Modify: `apps/core/README.md`
- Modify: `apps/web/README.md`
- Modify: `IMPLEMENTATION_STATUS.md`
- Modify: focused tests/fixtures that still use deprecated catalog DTO fields.

**Interfaces:**
- Final shared contract contains no public sourcing configuration and no hard-coded media compatibility assumptions outside the typed media DTO.
- Canonical documents describe SKU availability, fixed pack recipes, catalog home/pagination, and the bounded temporary media exception consistently.

- [ ] **Step 1: Search for stale implementation patterns**

```powershell
rg -n "imageBySlug|PLANNED_PROCUREMENT|HYBRID|unit-pack|sourcingMode" apps/web apps/core/src/catalog packages/contracts/src
rg -n "slice\(0, Math\.min|nextCursor: null" apps/core/src/catalog
```

Expected: no Web image map, no public sourcing field, no new pack SKUs using `unit-pack`, and no catalog truncation stub. Compatibility sourcing strings may remain only in Core commerce/storage code and migrations.

- [ ] **Step 2: Update canonical and descriptive docs**

Document normalized product/SKU details, compatibility public asset metadata pending R2, SKU-specific availability, `marketplace.getHome`, cursor search, and staff-assembled pack recipes. Do not alter locked fulfillment/sourcing invariants. Update READMEs/status only after canonical documents agree.

- [ ] **Step 3: Run the complete catalog acceptance set**

```powershell
pnpm catalog:check
pnpm naming:check
pnpm migration:check
pnpm lint
pnpm typecheck
pnpm test
pnpm -r build
pnpm --filter @freshmarkets/web test:e2e -- storefront-home.spec.ts
git diff --check
```

Expected: every command PASS. If unrelated pre-existing dirty work causes a failure, prove it by rerunning against the relevant path/commit and report it; do not discard or overwrite the user's changes.

- [ ] **Step 4: Audit acceptance counts and business behavior**

Record in the final report:

- exactly 226 public produce assets and exactly 226 manifest/media mappings;
- category, SKU, mass/piece/pack/bunch, and price-range counts;
- every active launch SKU has positive Metro Cebu price and Cebu `AVAILABLE` state;
- chili assembled pack uses exact internal grams and approximate customer contents;
- potato/onion variants are fixed weight;
- home is bounded and search/category pagination reaches the complete catalog;
- public DTOs omit packing instructions and sourcing configuration;
- Scheduled display does not consult on-hand inventory;
- existing user storefront changes remain preserved;
- R2 migration and Instant/On-demand inventory behavior remain deferred.

- [ ] **Step 5: Commit documentation and final cleanup**

```powershell
git add -- docs/architecture/ARCHITECTURE.md docs/architecture/DATA_MODEL.md docs/architecture/API_CONTRACTS.md apps/core/README.md apps/web/README.md IMPLEMENTATION_STATUS.md
git add -p -- packages/contracts/src apps/core/src/catalog apps/web
git commit -m "docs: record complete produce catalog implementation"
```

- [ ] **Step 6: Inspect history and push trunk**

```powershell
git status --short
git log --oneline -10
git push origin main
```

Expected: only the user's known pre-existing uncommitted files remain, all task commits are on `main`, and the push guard accepts `main`. Do not use `--no-verify`.
