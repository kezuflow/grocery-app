# FreshMarkets Implementation Status

This is the implementation record for `IMPLEMENTATION_PLAN.md`. It does not weaken the canonical architecture, domain invariants, state machines, or MVP scope.

> **2026-08-25 correction.** A per-phase architecture review found that earlier
> "IMPLEMENTED" labels over-stated maturity for Phases 4–14 and hid BLOCKER-class
> invariant violations. This document has been corrected to reflect actual code.
> See `docs/product/PHASE_REVIEW_2026_08_25.md` for the full findings and citations.
> Pass 1 decisions are recorded in `docs/architecture/REMEDIATION_DECISIONS.md`.
> Structural reality: Phases 0–3 have dedicated Core domain modules and are
> implemented; Phases 4–14 remain partial and retain compatibility command paths
> in `apps/core/src/index.ts`. Phase 4A/4B boundary and checkout flow,
> concurrency, and reconciliation tests now provide focused coverage, but they do
> not establish production readiness for the later commerce phases.

## Phase Status

The **Maturity** column is the breadth/vendor label. The **Actual state** column is
the 2026-08-25 review verdict against `IMPLEMENTATION_PLAN.md` acceptance criteria.

| Phase | Title | Maturity | Actual state (2026-08-25) |
|---|---|---|---|
| Phase 0 | Repository, Cloudflare, and Tooling Foundation | IMPLEMENTED | IMPLEMENTED — sound; clock and idempotency foundations added in Remediation Pass 1 |
| Phase 1 | Better Auth and RBAC Foundation | IMPLEMENTED LOCALLY; PROVIDER CONFIG REQUIRED | IMPLEMENTED (real module); auth-flow acceptance tests largely absent |
| Phase 2 | Markets, Locations, Serviceability, and Geofencing | IMPLEMENTED LOCALLY; APPROVED POLYGON/GEOCODER REQUIRED | IMPLEMENTED (real module) — cleanest phase |
| Phase 3 | Catalog, SKUs, Units, Availability, and Pricing | IMPLEMENTED MVP SLICE | IMPLEMENTED (real module); pricing drops `market_id`/`price_type`; ~1 test vs 6-item acceptance list |
| Phase 4 | Customers, Addresses, Subscriptions, and Trials | IMPLEMENTED MVP SLICE; BILLING PROVIDER REQUIRED | PARTIAL — Phase 4A customer-principal boundary and Phase 4B addresses are implemented with migration and flow tests; subscriptions remain for the next phase |
| Phase 5 | Delivery Cycles, Fees, Cutoff, and Capacity | IMPLEMENTED MVP SLICE | PARTIAL (inline) — cycle-zone-location capacity/allocation and persisted zone-fee foundations added; cycle administration remains seed-only |
| Phase 6 | Cart and Checkout Eligibility | IMPLEMENTED MVP SLICE | PARTIAL (inline) — checkout attempts and quote snapshots now persist through the compatibility commit path; full quote lifecycle and promotion policy remain incomplete |
| Phase 7 | Payments, Orders, Commitment Boundary, and Amendments | IMPLEMENTED WITH SANDBOX PAYMENT; PRODUCTION PROVIDER REQUIRED | PARTIAL (inline) — sandbox only; `order_amendment` table has no code; no webhook verification; `paymentTransitions` dead code |
| Phase 8 | Location Inventory, Reservations, and Committed Demand | IMPLEMENTED MVP SLICE | PARTIAL (inline) — inventory holds and `inventory_ledger_entries` foundations added; full reservation consumption/reconciliation remains incomplete |
| Phase 9 | Procurement, Receiving, and Supply Exceptions | IMPLEMENTED FOUNDATION | PARTIAL (inline) — `supplier`/`purchase_order` tables unused; no demand aggregation; `procurementTransitions` dead code |
| Phase 10 | Fulfillment and Packing | IMPLEMENTED FOUNDATION | PARTIAL (inline) — order-level status only; no task/line tables or pick quantities |
| Phase 11 | Delivery Operations and Rider Experience | IMPLEMENTED FOUNDATION | PARTIAL (inline) — `delivery_batch`/`delivery_stop`/`rider_user_id`/`proof_json` unused |
| Phase 12 | Admin Operations UI | IMPLEMENTED FOUNDATION | PARTIAL — single command form; no read-model workspaces or audit views |
| Phase 13 | Marketplace Implementation and Polish | IMPLEMENTED MVP SLICE | PARTIAL — customer surfaces exist; no order timeline/notifications; SEO/perf unverified |
| Phase 14 | Promotions, Analytics, and Later Capabilities | IMPLEMENTED FOUNDATION ONLY | SCHEMA-ONLY — `promotion` never applied; `domain_event` has no writer |

## Known architectural defects (2026-08-25 review)

These are open BLOCKER/HIGH items from `PHASE_REVIEW_2026_08_25.md`. They must be
resolved before the commerce phases (4–11) can be considered cleanly done, and
before any production deployment.

- **BLOCKER — mega-migrations.** `0005_mvp_commerce_operations.sql` spans Phases
  4–11 and `0006_phase14_promotions_audit.sql` spans Phases 7/9/11/14, violating the
  per-phase migration discipline in `AGENTS.md`.
- **BLOCKER — optimistic-concurrency invariant.** 12 tables in `0005` (and 6 in
  `0006`) lack the required `version` column (DATA_MODEL.md:13); state-transition
  commands use bare status setters with no expected-version/affected-row checks.
- **RESOLVED FOUNDATION — trigger ownership.** Corrective migration `0008` drops
  the historical stock/reservation/capacity triggers. The compatibility checkout
  command now uses conditional D1 updates, explicit holds/allocations, and
  compensation on failed claims.
- **RESOLVED FOUNDATION — inventory ledger.** `inventory_ledger_entries` records
  checkout holds, manual adjustments, receiving, and cancellation releases.
- **RESOLVED FOUNDATION — capacity granularity.** New allocations use
  cycle × delivery zone × fulfillment location. Historical cycle counters remain
  compatibility data and are no longer the commitment authority.
- **HIGH — idempotency is not yet integrated across every replayable command.**
- **HIGH — flow coverage is still narrow.** The customer checkout loop,
  customer-address ownership/versioning, D1 capacity/inventory races, and
  checkout-expiry reconciliation now have automated tests; payment-provider,
  refund/amendment, procurement, fulfillment, delivery, and scheduled
  reconciliation flows remain uncovered.

## Remediation Pass 1 Status

- **P0:** Scope authorization, boundary validation, canonical Cebu configuration, safe transition errors, and compatibility-preserving RPC behavior are implemented in the current working tree.
- **P1 foundations:** Clock abstraction, request hashing/idempotency foundation, expected-version contract fields, and corrective migration `0007_remediation_foundations.sql` are implemented.
- **P1 commerce foundations:** Migrations `0008` through `0010` add canonical capacity,
  allocations, checkout attempts/quotes, sandbox payment events, persisted policy,
  inventory holds, the inventory ledger, persisted default market/location/offer
  selection, and scoped price metadata. `commitMockOrder`, order operations,
  manual inventory adjustment, and receiving use these foundations.
- **P1 remaining:** Full idempotency integration for every replayable operational
  command, production webhook verification/recovery, full canonical lifecycle
  vocabulary, and scheduled expiry/reconciliation execution remain unfinished.
  Checkout-expiry reconciliation is implemented as a reusable Core utility and is
  invoked before checkout; it is not yet wired to a production scheduler.
- **Verification note:** Existing unrelated Web/admin work in the working tree required a syntax correction before typechecking. Formatting, naming, typecheck, lint, tests, and recursive builds now pass locally after the remediation edits.

## Proven Local Business Loop

The local Worker stack has automated integration coverage through the sequence
below. This is focused compatibility-path coverage, not a certified production
capability: provider payment, complete lifecycle, and scheduled reconciliation
behavior remain outside this proof.

```text
email/password session
 -> trial subscription
 -> serviceable Cebu address
 -> priced cart
 -> valid delivery cycle
 -> sandbox payment success
 -> one idempotent committed order
 -> immutable item/address snapshots
 -> stocked inventory reservation or planned procurement demand
 -> fulfillment and delivery records
```

D1 guards capacity and stocked reservation at write time through conditional Core
command updates and explicit hold/allocation records. Duplicate checkout
idempotency returns the original order through the persisted idempotency record.
Admin and operations commands require Core capabilities.


## Production Launch Blockers

- Configure and verify Google OAuth credentials and production Better Auth base URL/cookie behavior.
- Configure transactional verification/reset email delivery; development currently logs generated links.
- Replace the bootstrap Cebu polygon and direct-coordinate flow with approved service boundaries and a production geocoder/map confirmation integration.
- Select and implement the production grocery and recurring membership payment provider, signed webhooks, reconciliation, and provider-specific refund behavior.
- Expand procurement supplier/purchase workflows, fulfillment exception resolution, rider proof/offline behavior, and admin read models before real operations.
- Add broader concurrent D1 integration tests, provider contract tests, and complete Playwright coverage with provisioned staff/rider identities.

## Verification

> **2026-08-26 note.** The commands below were re-run after the subsequent
> remediation edits. Passing tests do not imply production readiness: provider,
> lifecycle, and scheduled-operations coverage remains incomplete.

- All D1 migrations through `0014_phase4b_address_serviceability_outcome.sql` apply to the local database.
- `pnpm format:check`, `pnpm naming:check`, `pnpm typecheck`, `pnpm lint`,
  `pnpm test`, and `pnpm -r build` pass locally. Core deploy dry run and vinext
  production build are included in the recursive build.
- `vinext check` reports 100% compatibility for used imports/libraries and the current route structure.
- `wrangler check startup` succeeds.
- Web/Core local Service Binding routes and desktop/mobile marketplace rendering were smoke-tested.
- Phase 4B owner-scoped address reads and optimistic-version updates have integration coverage.
- Phase 4B address views persist Core's serviceability outcome and resolver reason; legacy
  rows remain explicitly unresolved until re-resolved.
- Checkout flow, D1 concurrency guards, and checkout-expiry reconciliation have focused integration coverage.
