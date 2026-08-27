# Produce Catalog Storefront Design

## Status and authority

This specification defines the approved expansion of the FreshMarkets catalog from the current curated subset to every image in `apps/web/public/produce`, with D1-backed product identity, categories, fixed sellable variants, product and variant details, mock Metro Cebu prices, Cebu availability, and media metadata returned through Core.

The canonical repository documents remain authoritative. In particular:

- Core owns catalog, availability, pricing, unit definitions, and business validation.
- Web reads purpose-built typed contracts through the Cloudflare Service Binding and never reads D1 directly.
- Products are global; availability and price are location/market aware.
- Authoritative money and inventory quantities are integers.
- `PACK` and `BUNCH` are merchandising labels, not universal conversion units.
- Cebu launches with `SCHEDULED` fulfillment. Future `INSTANT` fulfillment, presented to customers as On-demand delivery, is outside this change.

The existing produce binaries remain public Web assets for this implementation. D1 owns the catalog-to-asset metadata used by the storefront. Moving the binaries to R2 and replacing the compatibility media reference with canonical R2-backed `product_media` records is a separate, explicitly deferred media-storage task.

## Objective

Make all 226 `.webp` assets in `apps/web/public/produce` usable as database-backed storefront products without maintaining a parallel hard-coded Web image map. Every seeded product must have:

1. A stable product identity, name, slug, category, description, and media reference.
2. At least one fixed sellable SKU with a customer-facing label.
3. Exact integer base-unit consumption in `GRAM` or `PIECE`.
4. A positive versioned mock price in PHP minor units for Metro Cebu.
5. Cebu availability configuration.
6. Customer-visible details and, where relevant, a staff packing instruction.

The resulting storefront must browse, search, filter, and open product details from Core/D1 data. It must not silently truncate the catalog to the current 50-item query ceiling.

## Approved launch behavior

### Fulfillment and availability

Cebu Central operates in `SCHEDULED` mode for launch. Catalog presentation follows these rules:

- A product is visible when the Product is active and at least one active SKU is marked available for Cebu Central with a valid current Metro Cebu price.
- The customer sees `Available`, `Unavailable`, cutoff/window messaging, or another approved coarse state; raw inventory quantities are not shown.
- Scheduled catalog visibility uses the administrator-controlled Cebu availability state. It does not depend on current physical inventory quantity.
- Every generated produce SKU starts `AVAILABLE` for Cebu Central; later changes occur through the authorized Admin availability command.
- Checkout remains authoritative and revalidates SKU state, Cebu availability, price, cycle, cutoff, capacity, subscription, and other existing eligibility rules.
- All launch seed entries use internal `PLANNED` sourcing where a sourcing value is required. Sourcing controls are not added to the launch Admin UI.
- A product-level Admin availability action may apply one command across all active SKUs, but persistence and Core validation remain SKU-specific so variants can diverge later.

Future `INSTANT` fulfillment will use location inventory, expiring checkout holds, and exact SKU consumption to compute availability. That future behavior must not be simulated in this change.

### Selling formats

The catalog generator assigns formats according to the physical product:

- Loose roots, tubers, bulbs, beans, and similar commodities may use fixed weight SKUs such as `250 g`, `500 g`, and `1 kg`.
- Large individually countable produce may use `1 piece` or another exact count.
- Chilies, herbs, leafy greens, small vegetables, and similar produce may use an assembled `Pack` or `Bunch` merchandising label.
- Fixed-count packs use exact `PIECE` consumption.
- Staff-assembled variable-content packs use an exact internal gram recipe even though the customer buys a pack rather than arbitrary weight.

Example chili SKU:

```text
display name: 1 pack
merchandising label: Pack
sell quantity/unit: 100 G
inventory quantity base: 100 GRAM
customer contents note: Approximately 10–15 chili peppers per pack.
staff packing instruction: Pack 100 g per bag.
```

The controlled unit and base dimension remain compatible. The storefront may prioritize the merchandising label and fixed variant name while Core retains the exact gram recipe.

## Catalog taxonomy

Use one shallow, storefront-friendly taxonomy for the initial manifest:

1. `FRUITS` — Fruits
2. `VEGETABLES` — Vegetables
3. `LEAFY_GREENS_HERBS` — Leafy Greens & Herbs
4. `ROOTS_TUBERS_BULBS` — Roots, Tubers & Bulbs
5. `BEANS_PEAS_SEEDS` — Beans, Peas & Seeds
6. `AROMATICS_SPICES` — Aromatics & Spices
7. `NATIVE_SPECIALTY_PRODUCE` — Native & Specialty Produce

Each asset maps to exactly one primary category. Existing compatible category identifiers may be reused; incompatible or overly broad seed categories are migrated additively rather than rewritten in historical migrations. Category ordering is deterministic and persisted.

## Development-time catalog manifest

Create a typed, human-reviewable manifest under the Core catalog module. It is seed input, not a runtime data source and not a second production authority.

Each product entry contains conceptually:

```ts
type ProduceSeedProduct = {
  id: string;
  slug: string;
  name: string;
  categoryCode: ProduceCategoryCode;
  description: string;
  media: {
    assetKey: string;
    altText: string;
  };
  details: ReadonlyArray<{
    label: string;
    value: string;
    sortOrder: number;
  }>;
  inventoryBaseUnit: "GRAM" | "PIECE";
  variants: ReadonlyArray<{
    id: string;
    code: string;
    displayName: string;
    merchandisingLabel?: "Pack" | "Bunch";
    sellQuantity: number;
    sellUnitCode: "G" | "KG" | "PC";
    inventoryQuantityBase: number;
    customerContentsNote?: string;
    packingInstruction?: string;
    priceMinor: number;
    sortOrder: number;
  }>;
};
```

The exact TypeScript name may follow established module boundaries, but the information and invariants above are required.

### Manifest validation

The generator fails before writing SQL when any of these conditions is true:

- An asset exists without one manifest product or a manifest product references a missing asset.
- Two products use the same ID, slug, asset key, or generated SKU code.
- A product has no category, description, detail, variant, price, or media alt text.
- A category code is outside the controlled taxonomy.
- A quantity or price is non-integer or nonpositive.
- A SKU crosses dimensions between its controlled sell unit and inventory base unit.
- A `Pack` or `Bunch` label is treated as a global unit definition.
- A staff-assembled variable-content pack lacks an exact internal recipe and packing instruction.
- A contents range is used as authoritative inventory consumption.
- A generated identifier, migration filename, or source path violates repository naming conventions.

Validation must report all discovered manifest errors in one run with product/variant context rather than stopping at the first error.

### Deterministic generation

The generator produces one reviewable additive migration. Output ordering is stable by category, product sort key, and SKU sort order. Re-running against unchanged input must produce byte-identical SQL.

Generated rows use stable IDs so the migration is idempotent under the repository's established seed conventions. Existing historical migrations remain immutable. The manifest and generated migration are both committed: the manifest is the maintainable seed specification, and D1 becomes runtime authority after migration application.

## Persistence changes

Use additive migrations to align the implemented catalog with the canonical model needed by this feature.

Required persistence capabilities are:

- Product description, category, status, and version-compatible identity.
- Product media metadata containing the existing public produce asset key and alt text.
- Ordered extensible product detail rows.
- Fixed SKUs with display name, optional merchandising label, integer sell quantity, controlled sell unit, exact integer base consumption, status, and order.
- Ordered variant detail records or equivalent queryable fields for customer contents notes and staff packing instructions.
- SKU-specific Cebu availability with `PLANNED` sourcing and active status.
- Versioned `STANDARD` prices scoped to Metro Cebu, with positive PHP minor-unit amounts.

Prefer normalized detail records when implementing extensibility. If compatibility requires a transitional JSON column, the contract must expose a typed DTO and the data must be versioned and validated; untyped JSON must not leak to Web.

Do not reintroduce `PACK` as a universal controlled unit. Existing historical `unit-pack` data remains migration history but new produce SKUs must use controlled `G`, `KG`, or `PC` units with SKU-specific consumption.

## Mock pricing policy

All 226 products receive editable mock Metro Cebu prices. These are launch fixtures, not claims of surveyed real-time market prices.

Pricing rules:

- Store PHP as integer centavos.
- Seed only positive `STANDARD` price version 1 records.
- Use a product-level reference price appropriate to common produce, then derive fixed-variant prices consistently.
- Permit modest pack/handling premiums for staff-assembled packs.
- Round customer prices consistently to sensible peso increments.
- Avoid mechanically assigning one identical price to unrelated products.
- Keep prices market-scoped and versioned so Admin changes create new versions rather than rewriting order history.

The manifest review should make outliers visible by including a generated summary of minimum, maximum, and per-category price distributions.

## Core contracts and queries

Extend the shared catalog DTOs additively so Web receives:

- Primary media source/key and alt text.
- Ordered product details.
- Variant merchandising label, exact customer-facing fixed variant name, contents note, and any customer-safe detail fields.
- Category identity.
- Current Metro Cebu price and availability state.

Operational packing instructions must be available only to authorized operational/Admin read models and must not be exposed in the public marketplace DTO.

Replace the current hard-coded Web slug-to-image map with media returned by Core. Unknown or invalid media still renders the established accessible placeholder.

### Catalog scale and pagination

The current `searchCatalog` implementation caps results at 50 and returns no cursor. It cannot represent the complete 226-item catalog and must be corrected.

Implement database-side filtering and stable cursor pagination:

- Search query, category, active status, location availability, and price eligibility are applied before pagination.
- Ordering is deterministic, with a stable ID tie-breaker.
- `nextCursor` is opaque to Web.
- Page limits remain bounded.
- Product detail remains slug-addressable.

Add or complete the canonical purpose-built `marketplace.getHome` read model for home discovery. It should return categories and bounded product rails without loading all 226 fully expanded products into one response. Category/search pages use paginated catalog search. This avoids both truncation and an oversized home payload.

## Storefront behavior

The existing storefront continues to server-render read-heavy catalog surfaces through Core.

- Home uses the marketplace home read model for bounded category rails.
- Search and category URLs preserve query/filter state and request paginated Core data.
- Product cards render Core-provided image metadata, name, fixed variant label, current price, and availability.
- Product quick view and product-detail routes render ordered item details and variant-specific contents information.
- Selecting a pack shows `1 pack` and the contents note; it does not offer arbitrary grams.
- Direct-weight products show their fixed weight variants.
- Missing price or invalid availability produces `Unavailable`, never a zero price.
- Loading, empty, error, unavailable, and cutoff states remain explicit and accessible.

The implementation must preserve and work around all pre-existing uncommitted storefront changes. It must not overwrite the current cart, checkout, navigation, drawer, hero, banner, CSS, test, or plan edits.

## Admin boundary

Building or redesigning Admin catalog screens is outside this task. The data and Core commands must remain compatible with a purpose-built Admin availability action:

- Product-level `Available in Cebu` is a convenience command that updates all targeted active SKUs atomically or reports a stable conflict.
- Individual SKU availability remains representable for later Admin refinement.
- Sourcing configuration is not exposed in the launch Admin UI.
- Admin never writes raw tables.

If the required command does not exist, the implementation plan may add the Core command and contract without adding a new Admin screen, provided capability checks, idempotency, expected versions, and audit requirements are satisfied.

## Error handling and operational safety

- Generator errors are deterministic, actionable, and leave the previous generated migration untouched.
- Migration verification checks foreign keys, controlled units, duplicate active prices, category references, media references, and SKU/location availability.
- Core excludes or marks unavailable any SKU lacking a valid current price rather than returning zero.
- A missing Web public asset uses the accessible placeholder at runtime and fails asset-integrity tests before completion.
- Product-detail lookup returns `NOT_FOUND` for unknown slugs.
- Cursor validation returns a stable validation error rather than accepting malformed pagination state.
- Scheduled checkout always revalidates availability and cycle eligibility; catalog display is not a commitment.

## Testing and acceptance

### Manifest and generator

- Prove a bijection between all 226 `.webp` files and manifest products.
- Prove deterministic migration output.
- Prove duplicate IDs/slugs/assets/SKUs, missing metadata, invalid categories, invalid prices, incompatible units, and imprecise pack recipes are rejected.
- Prove every product has at least one positive priced variant and Cebu availability.
- Produce a review summary by category, selling format, base unit, variant count, and price range.

### Migration and Core

- Apply every migration to a fresh local D1 database and run foreign-key verification.
- Assert exactly 226 produce asset mappings and no unintended duplicate product records after compatibility reconciliation.
- Test fixed weight, single-piece, fixed-count pack, and internally weighted assembled-pack examples.
- Test category filtering, tolerant search, stable pagination, next cursors, product detail, media, details, price resolution, and Cebu availability.
- Test that public DTOs omit packing instructions.
- Test that Scheduled visibility uses configured availability and does not require on-hand inventory.
- Test missing price, unavailable SKU, inactive product, malformed cursor, and missing media behavior.

### Web

- Test that no hard-coded slug-to-image catalog map remains.
- Test cards, rails, search/category pages, quick view, and product detail with Core-provided media and details.
- Test pack and weight labels, approximate contents copy, unavailable states, empty results, pagination/load-more behavior, and media fallback.
- Update Playwright coverage for multiple categories and a pack-based detail page.
- Verify responsive, keyboard, focus, alt-text, and no-horizontal-overflow behavior on relevant storefront surfaces.

### Repository verification

Run naming checks, type checks, focused unit/integration tests, fresh-D1 migration verification, relevant Worker-local tests, Web build, and relevant Playwright flows. Run `git diff --check` before completion.

## Implementation boundaries

In scope:

- Typed manifest and validation/generation tooling.
- All 226 catalog mappings and sensible mock data.
- Additive D1 catalog/detail/media/availability/price migration work required by the approved design.
- Shared DTO and Core catalog query changes.
- Storefront catalog/media/details/pagination integration.
- Focused compatibility support for a future Admin availability action.
- Canonical documentation updates when the implemented contract/data decisions require them.

Out of scope:

- Importing live supplier or market pricing.
- Building an Admin CSV importer.
- Building or redesigning Admin catalog screens.
- Exposing sourcing configuration to Admin or customers.
- `INSTANT`/On-demand inventory-aware storefront behavior.
- Customer-visible raw inventory counts.
- Variable-weight settlement or post-pick repricing.
- Substitution policy, supplier integration, or automatic procurement execution.
- Moving image binaries to R2 in this change.
- Deployment or production data mutation.

## Completion handoff

The implementing model's final report must state:

- manifest/generator work and the final asset/product/category/variant counts;
- important files and modules;
- schema and migration changes;
- RPC/DTO/query changes;
- storefront behavior changes;
- tests and exact validation commands/results;
- documentation updates;
- treatment of the existing uncommitted storefront work;
- deferred R2 media migration and any other deviations or risks;
- what future Instant/On-demand and Admin phases may safely rely on.
