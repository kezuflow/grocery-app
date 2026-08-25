# FreshMarkets Phase Review — 2026-08-25

Review type: implementation-drift + per-phase completion audit across Phases 1–14.
Method: canonical docs (`AGENTS.md`, `docs/architecture/*`, `docs/product/*`) compared
against actual code in `apps/core`, `apps/web`, `packages/*`, and
`apps/core/migrations`. Every finding cites repository evidence.

Caveat: `pnpm check` could not be executed in the review environment (Windows-built
`node_modules`, `pnpm` absent, Node 22 vs required 24). Test adequacy is assessed by
reading the test files, not by running them. Claims that the suite "passes" are
therefore unverified here.

## Headline

The codebase splits cleanly at Phase 3. Phases 0–3 have dedicated Core domain
modules (`auth/`, `geography/`, `catalog/`) and are genuinely implemented. Phases
4–14 have **no dedicated domain modules**: all commerce, order, payment, inventory,
procurement, fulfillment, and delivery logic is inline SQL inside
`apps/core/src/index.ts` (~lines 155–785), several migration tables have no code
behind them, and there are no flow-level tests. `docs/product/IMPLEMENTATION_STATUS.md`
marks all 14 phases IMPLEMENTED and claims a "proven local business loop" — this
over-claims relative to what exists and hides BLOCKER-class invariant violations.

## Per-phase verdict

| Phase | Actual state | Verdict |
|---|---|---|
| 1 Better Auth + RBAC | Implemented (real module) | SOUND WITH FIXES |
| 2 Geography / Serviceability | Implemented (real module) | SOUND |
| 3 Catalog / SKUs / Pricing | Implemented (real module) | SOUND WITH FIXES |
| 4 Customers / Subscriptions | Partial (inline) | INCOMPLETE |
| 5 Delivery Cycles / Capacity | Partial (inline) | INCOMPLETE |
| 6 Cart / Checkout Eligibility | Partial (inline) | INCOMPLETE |
| 7 Payments / Orders / Amendments | Partial (inline, sandbox) | INCOMPLETE |
| 8 Inventory / Reservations | Partial (inline) | INCOMPLETE |
| 9 Procurement / Receiving | Partial (inline) | INCOMPLETE |
| 10 Fulfillment / Packing | Partial (inline) | INCOMPLETE |
| 11 Delivery Operations | Partial (inline) | INCOMPLETE |
| 12 Admin Operations UI | Partial | INCOMPLETE |
| 13 Marketplace | Partial | INCOMPLETE |
| 14 Promotions / Analytics | Schema-only | NOT STARTED (schema only) |

## Findings by severity

### BLOCKER

- **Phase-discipline violation — mega-migrations.** `apps/core/migrations/0005_mvp_commerce_operations.sql`
  creates tables spanning Phases 4–11 in one file (`customer`, `customer_address`,
  `subscription_offer`, `subscription`, `delivery_cycle`, `cart`, `cart_item`,
  `payment_attempt`, `grocery_order`, `order_item`, `inventory_balance`,
  `inventory_reservation`, `committed_demand`, `procurement_requirement`,
  `receiving_record`, `fulfillment_record`, `delivery_job`).
  `0006_phase14_promotions_audit.sql` is named for Phase 14 but also provisions
  Phase 7/9/11 tables (`refund`, `order_amendment`, `supplier`, `purchase_order`,
  `supply_exception`, `delivery_batch`, `delivery_stop`). This breaks the AGENTS.md
  Phase Execution Rules ("Implement only the authorized phase") and the per-schema
  migration convention.

- **Optimistic-concurrency invariant broken (DATA_MODEL.md:13).** These mutable
  tables have no `version` column: `customer`, `subscription_offer`, `subscription`,
  `payment_attempt`, `grocery_order`, `inventory_balance`, `inventory_reservation`,
  `committed_demand`, `procurement_requirement`, `receiving_record`,
  `fulfillment_record`, `delivery_job` (`0005`), plus `refund`, `order_amendment`,
  `purchase_order`, `supply_exception`, `delivery_batch`, `delivery_stop` (`0006`).
  The transition commands `advanceOrder` (`apps/core/src/index.ts:596`),
  `advanceFulfillment` (`:734`), `advanceDelivery` (`:757`), and `adjustInventory`
  (`:663`) use bare `UPDATE … SET status=? WHERE id=?` with no expected-version and
  no affected-row check — the generic-setter pattern STATE_MACHINES.md forbids.

- **Business logic in D1 triggers.** `0005:41-72` implements stock-availability
  guarding, reservation increments, cycle-capacity guarding, and allocation as
  `CREATE TRIGGER`s using `unixepoch('now')` for cutoff. This violates the
  UI→command→domain→repository layering (ARCHITECTURE.md), AGENTS.md "model
  meaningful writes as explicit commands," and DATA_MODEL.md:94 (capacity must be a
  Core conditional update + allocation insert in one `batch()` with affected-row
  verification).

### HIGH

- **No append-only inventory ledger.** DOMAIN_MODEL.md:173 / DATA_MODEL.md:128
  require an `inventory_ledger_entries` row per movement; no ledger table exists and
  `adjustInventory` / `receiveProcurement` / the reservation trigger mutate balances
  in place.
- **Cycle×zone capacity collapsed to cycle-only.** `0005` `delivery_cycle` carries
  `capacity`/`allocated` on the cycle row instead of `delivery_cycle_zones`;
  DOMAIN_MODEL.md:42 explicitly locks capacity as cycle × zone and forbids collapsing
  it.
- **Phase 0 named deliverables absent.** No clock abstraction (`Date.now()` used
  directly ~15× in `apps/core/src/index.ts`, e.g. `:220,:247,:406,:413,:471`) and no
  idempotency primitive / `idempotency_records` / `payment_events(provider_event_id
  UNIQUE)`. This makes the injected-clock cutoff tests in STATE_MACHINES.md
  unsatisfiable.
- **No flow-level tests for Phases 4–11.** Domain tests exist only for auth,
  geography (×3), catalog, contracts, and the generic `transition()` helper. The
  inline cart/checkout/commit/inventory/procurement/fulfillment/delivery RPCs are
  untested, despite the STATUS "proven local business loop" claim.
- **Phase 1 auth-flow acceptance tests largely absent.** `auth/authorization.test.ts`
  only covers `can`/`hasScope`; OAuth callback, email/password, verification, reset,
  session persistence, logout, expired session, and cookie preservation are claimed
  smoke-tested only.

### MEDIUM

- **Duplicate customer identity.** `0001.customer_principal` (FK to `user`, written by
  the Better Auth hook, `auth/service.ts:54-71`) vs `0005.customer` (no FK, lazily
  created `index.ts:122-137`) model one Customer aggregate. The Phase-1
  `customer_principal` is effectively dead for commerce.
- **Pricing diverges from DATA_MODEL.** `0004.price_version` drops `market_id` and
  `price_type`; no overlapping-active-price prevention (`catalog/service.ts:100-103`
  just selects the highest active `version`). Weakens the multi-market invariant.
- **Missing eligibility persistence.** No `checkout_attempts`, `quote_snapshots`, or
  `capacity_allocations` tables; quotes are computed on the fly and never persisted;
  minimum basket hardcoded (`index.ts:416`).
- **Three declared state machines are dead code.** `subscriptionTransitions`,
  `paymentTransitions`, `procurementTransitions` (`commerce/state-machines.ts:8,21,25`)
  are exported but never called.
- **Unused later-phase schema.** `order_amendment`, `supplier`, `purchase_order`,
  `delivery_batch`, `delivery_stop`, `delivery_job.rider_user_id`, `proof_json`,
  `promotion`, and `domain_event` have no code paths.

### LOW

- Table-name divergence from DATA_MODEL (singular vs documented plural; `permission`
  vs `capabilities`) — snake_case still satisfied, so a doc drift, not a naming
  violation.
- `cart` binds a `location_id` (`0005:6`, `index.ts:297`), contradicting "customers
  never select a location."
- Catalog search loads all rows then slices in memory; `nextCursor` always null
  (`catalog/service.ts:123-131`).
- `packages/config` `DEFAULT_MARKET_CODE = "metro-cebu"` vs DB `METRO_CEBU`.
- `0006.domain_event` resembles event-sourcing scaffolding cautioned against by
  ARCHITECTURE.md / DOMAIN_MODEL.md:227.

## What is correct

- **Phase 0:** clean pnpm monorepo; typed Web→Core Service Binding with no CORS/REST
  and no D1 binding on Web; `RpcResult`/`AppError` envelope; `CONTRACT_VERSION`;
  structured logs with request IDs; money/units/timezone value objects; contracts
  import no D1/infra types.
- **Phase 1:** Better Auth authoritative in Core; capability+scope authorization
  independent of authentication; `ApplicationContext` DTO excludes tokens; admin RPCs
  gate on `requireCapability`; Web auth proxy preserves multiple `Set-Cookie` and
  forwards origin/host/proto; `0002` issuer column + `(issuer, account_id)`
  uniqueness as documented.
- **Phase 2 (cleanest):** correct hole-aware ray-cast point-in-polygon; versioned
  polygons with stale-resolution detection; market→area→zone→capable-location
  resolution with capability filtering; geocoder port + coordinate-confirmation
  policy; address persistence correctly deferred to Phase 4; tests match the
  acceptance list.
- **Phase 3:** global products/categories, fixed SKU variants, shared inventory-pool
  identity, active-window + version-desc price selection, integer minor units and
  base-unit consumption, purpose-built read-model DTOs.

## Recommended remediation (ordered)

1. Correct `IMPLEMENTATION_STATUS.md` to reflect actual state and record the known
   defects (done alongside this report).
2. Introduce the Phase 0 `Clock` port and an idempotency primitive in
   `packages/domain-shared`; inject the clock into commerce services and remove
   wall-clock logic from triggers.
3. Back-fill `version` columns on all mutable aggregates; convert trigger-based
   eligibility/capacity into Core commands using conditional updates with
   expected-version + affected-row checks inside `batch()`.
4. Add the missing invariant-critical tables: `inventory_ledger_entries`,
   `delivery_cycle_zones` (cycle×zone capacity + allocation), `checkout_attempts`,
   `quote_snapshots`, `payment_events`/`idempotency_records`.
5. Extract Phases 4–11 inline SQL into dedicated domain modules with named commands,
   and add flow-level + concurrency integration tests.
6. Converge the duplicate customer identity onto one aggregate linked by
   `auth_user_id`; align pricing with the multi-market model.

Note: migrations are append-only. Fixes 3–4 should be delivered as new corrective
migrations (or, if the local database is disposable, by rewriting the affected
migrations before any production deployment) — not by editing already-applied files
in place.

