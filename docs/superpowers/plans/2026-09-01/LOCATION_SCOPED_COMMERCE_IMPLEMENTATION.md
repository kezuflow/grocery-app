# Location-Scoped Commerce Implementation

## Goal

Implement the approved location-scoped commerce model from persistence through Core, shared contracts, Admin, marketplace behavior, tests, and local runtime verification.

## Phase 1: Canonical Decision Alignment

Update Architecture, Domain Model, Data Model, API Contracts, State Machines, Product Scope, Implementation Plan, and relevant Admin/marketplace design documents. Replace per-location mode selection, configurable sourcing modes, price fallback, and priority assignment with the approved model.

Validation: repository naming check and contradiction search across canonical documents.

## Phase 2: Persistence Migration

Add a forward-only D1 migration that:

1. creates the singleton global fulfillment-mode authority with Scheduled as the safe initial value;
2. preserves location-specific operational promise/capacity/readiness independently from mode selection;
3. backfills market-only prices to exact active locations without overwriting existing exact prices;
4. rejects future price records without a location;
5. rebuilds local Variant availability without sourcing mode; and
6. retains historical Order snapshots and any legacy compatibility columns that cannot safely be removed in this migration.

The migration must pass both fresh-database and populated-upgrade tests.

## Phase 3: Contracts and Core Domain

- Replace location-mode RPCs with global-mode queries and versioned activation commands.
- Remove sourcing mode from active Admin Catalog contracts and commands.
- Replace pricing context with an explicit Global or Location scope.
- Enforce exact-location price selection in Admin, catalog, cart, quote, amendments, and revalidation.
- Derive supply behavior from the global fulfillment mode.
- Keep shared Product inventory pools and Variant base-consumption calculations.
- Add deterministic Haversine location selection after polygon and operational eligibility filtering.
- Add a guarded Scheduled-to-Instant activation check and uncommitted quote/cart revalidation.

Validation: focused contract, domain, integration, migration, idempotency, CAS, and location-overlap tests.

## Phase 4: Admin Experience

- Global Product list/detail/edit surfaces show only catalog definition.
- Location Product list/detail surfaces show exact price, local active state, and shared Product stock.
- Remove `Resolved price`, `Pricing context`, `Catalog reference`, and sourcing controls.
- Move fulfillment-mode configuration to Global scope and show local readiness separately where useful.
- Preserve accessible loading, empty, unavailable, conflict, and permission states.

Validation: component tests and signed-in browser checks in Global and Central Cebu scopes.

## Phase 5: Marketplace and Checkout

- Resolve a confirmed address to one closest eligible location.
- Require that location before displaying authoritative price and availability.
- Apply Scheduled or Instant sellability from the global mode.
- Keep Instant locally active insufficient-stock Variants visible as out of stock.
- Re-resolve, reprice, and revalidate the full cart after address change.
- Snapshot and lock location at quote/commit; never stock-route or split an Order.

Validation: marketplace, address, serviceability, checkout, quote revalidation, stock hold, and committed-snapshot tests.

## Phase 6: Full Verification

Run naming checks, formatting/lint where configured, all package type checks, focused and full unit/integration suites, Worker-local migration tests, builds, and relevant Playwright flows. Apply the migration to the local D1 development database. Perform signed-in visual verification of Admin Global Product, Central Cebu Product, Inventory, global fulfillment-mode settings, and customer location behavior.

Record any unrelated pre-existing failure separately; do not treat incomplete verification as completion.

## Completion Boundary

The work is complete only when canonical documentation, D1 authority, Core behavior, typed RPC contracts, Admin, marketplace, tests, and local runtime agree on the same model. Committing and pushing are separate owner-authorized actions.
