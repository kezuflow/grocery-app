# Admin Catalog & Inventory Slice 5 Implementation Plan

**Goal:** Deliver Catalog and Inventory administration — categories, units, products and status,
SKU creation/update, versioned prices, SKU location availability, and inventory availability/ledger
inspection with the existing guarded adjustment — as purpose-built Core commands/read models behind
thin Web BFF adapters, without beginning finance (Orders/Payments/Refunds) work.

**Spec:** `docs/superpowers/specs/ADMIN_CRM_ANALYTICS_API_DESIGN.md` (Catalog/Inventory sections).
Contracts named in `docs/architecture/API_CONTRACTS.md` (`admin.catalog.*`, `admin.inventory.*`).

## Global constraints

- `apps/core` is the only business, authorization, and D1 authority; Web routes are transport-only.
- **No schema migration is required**: category, unit, inventory_pool, product, sku, price_version,
  location_product_availability, sku_location_availability, inventory_balance, and
  inventory_ledger_entries all exist (0004/0005/0008/0010/0024). This slice composes them.
- Authorization: `catalog.read`/`catalog.manage` plus a global scope for catalog surfaces
  (catalog is global). Inventory reads require `inventory.read` plus operational scope over the
  requested location (global, its market, or that location); `inventory.adjust` keeps its existing
  command-level capability + location/operational-scope enforcement and idempotency.
- Money is integer minor units; quantities are integer base units; missing/invalid price never
  silently zeroes; new price rows are version increments (history preserved, no updates-in-place).
- Product/sku/category status toggles are explicit commands (`active`/`inactive`), audited.
- Unit creation validates same-dimension usage; the existing controlled registry is the authority.
- Defer explicitly: media administration (canonical R2 `product_media` is deferred; binaries remain
  public Web assets), bulk import, product detail/sku detail authoring (operational notes), and
  purchase/receiving surfaces (Slice 7).
- Material commands: caller-stable `idempotencyKey`, `expectedVersion` where concurrent mutation is
  possible (sku, sku_location_availability), `audit_event` rows (`CATALOG.*`/`INVENTORY.*`
  vocabulary — inventory adjustments already write ledger + audit through their command).
- Preserve owner-owned files; stage only files named by each task.

## File ownership map

- `packages/contracts/src/admin-catalog.ts` (+ test): `AdminCatalogService` and
  `AdminInventoryReadService` DTOs/requests.
- `apps/core/src/admin/application/`: `catalog-administration-access.ts` (shared guard incl.
  operational-scope inventory variant), `catalog-reads.ts` (categories/units/products/product
  detail/inventory list/ledger), `catalog-commands.ts` (create category/unit/sku, product status,
  update sku, set availability, set price), `admin-catalog.integration.test.ts`,
  `admin-inventory.integration.test.ts`.
- `apps/core/src/index.ts`: flat WorkerEntrypoint methods with boundary validation.
- `apps/web/app/api/admin/catalog/**`, `apps/web/app/api/admin/inventory/**`,
  `apps/web/app/api/admin/catalog-routes.test.ts`.
- `apps/web/app/admin/catalog/page.tsx` (categories/units/products + create),
  `apps/web/app/admin/catalog/products/[product-id]/page.tsx` (SKUs, price, availability),
  `apps/web/app/admin/inventory/page.tsx` (availability + adjust + ledger),
  `apps/web/tests/admin-catalog.spec.ts`.

## Composed decisions

- `AdminProductSummary`: id, slug, name, category, status, skuCount. `AdminProductDetail` adds the
  SKU list (id, code, name, unit symbol, sell quantity, consumption base, status, version, current
  STANDARD price at the market default context, availability at Cebu Central).
- `setSkuPrice` inserts a new `price_version` (max version + 1) scoped to the market (location
  NULL, `STANDARD`), `valid_from` now; never mutates history.
- `setSkuAvailability` upserts `sku_location_availability` with a version guard (`STOCKED` default
  sourcing for Cebu Central's Instant-capable location, `PLANNED_PROCUREMENT` for Scheduled);
  sourcing mode is an explicit input.
- Inventory list: `inventory_balance` joined to pool/product/unit for one location; ledger is
  bounded keyset over `inventory_ledger_entries` for (location, pool).
- `createAdminSku` auto-creates nothing silently: it requires the product's existing inventory pool
  and a sellable unit whose dimension matches the pool's base unit dimension.

## Tasks

1. **Contracts** — failing tests, then `admin-catalog.ts` wired into `index.ts`/`core-service.ts`.
   Commit `feat(admin): define catalog contracts`.
2. **Catalog read models + commands** (categories, units, products/status, sku create/update,
   availability, price) with integration tests; wiring. Commit `feat(admin): add catalog commands`.
3. **Inventory reads** (location availability + ledger) with integration tests; wiring. Commit
   `feat(admin): add inventory read models`.
4. **BFF routes** + delegation tests. Commit `feat(web): proxy catalog administration`.
5. **Workspace UI** (catalog page, product detail, inventory page) + Playwright spec (gated
   honestly). Commit `feat(admin): add catalog and inventory workspace`.
6. **Docs + full gate + push.** Commit `docs(admin): record catalog slice`.

## Acceptance checklist

- [ ] Catalog surfaces are `catalog.read`/`catalog.manage` + global-scope gated; inventory reads
      are `inventory.read` + operational-location gated; adjustment keeps its existing guards.
- [ ] Prices are version-inserted (history immutable); availability upserts are version-guarded.
- [ ] Units, SKUs, and statuses validate closed vocabularies and same-dimension usage.
- [ ] Web is transport-only; workspaces cover loading/empty/permission/error states.
- [ ] No finance work begins; no media/R2 work begins; no owner-owned file touched; full gate passes.
