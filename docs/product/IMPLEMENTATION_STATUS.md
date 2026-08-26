# FreshMarkets Implementation Status

> **Program 2 (2026-08-26, Scheduled Jobs & Reconciliation).** Cloudflare Cron
> Triggers now drive time-driven work through an explicit job registry
> (`apps/core/src/scheduling/`; `scheduled()` contains no business policy):
> checkout hold expiry, scheduled membership cancellations, guarded
> `OPEN -> CUTOFF_REACHED` claims, completion-guarded cycle closeout through the
> legal transition chain, pending payment-reaction redrive with attempt-bound
> escalation to visible finance exceptions, and provider-lookup reconciliation
> of stale pre-commitment payments. Run records (`0019`) power the
> capability-gated `adminScheduledJobRuns` read model and `/api/admin/jobs`.
> Verification: full `pnpm check` green (format/naming/lint/typecheck/all
> suites/recursive builds), `check:vinext` exit 0, migration `0019` applies
> fresh; scheduler repeat-fire/overlap/failure-isolation covered by integration
> tests.

> **Remediation update (2026-08-26, isolated branch `remediation/2026-08-26`).**
> Remediation Plans 01–07 and the Plan 08 P1 core are implemented: static
> trusted origins, fail-closed redacted auth email port, Better Auth/IAM schema
> split, sandbox payment containment, atomic replay-safe inventory/receiving,
> canonical provider-neutral Payments (intents, signed inbox with dedupe/CAS,
> non-synthetic refunds, reconciliation), one-calendar-month Promotions-consumed
> trials with versioned lifecycle and Payments-driven activation, authoritative
> expiring quotes with commitment only from canonical payment reactions (mock
> commitment removed), capability/location-scoped operational commands, and
> domain routes replacing `/api/operations`. Verification: 180 Core + 27 Web +
> 15 contracts + 2 validation tests green; typecheck/lint/format/naming/build/
> vinext exit 0; migrations `0001`–`0018` apply fresh; concurrency suites ran
> three times each.

> **Plan 08 completion (2026-08-26, Program 1).** All remaining Plan 08 scope
> is implemented on `main`: the Core composition-root extraction
> (`apps/core/src/index.ts` is transport/composition/delegation only; domain
> behavior lives in its bounded-context modules), purpose-built scoped
> operational read models (`adminOperationsBoard` fulfillment/delivery/
> procurement sections plus a derived exception queue; `riderJobs`;
> `assignRider`), commitment now seeds `fulfillment_record` and an unassigned
> `delivery_job` inside the atomic reaction batch, riders are restricted to
> their own assigned jobs during delivery commands, the admin operations board
> and rider console render Core-derived queues with legal actions only, the
> `LegacyOperationsService` shim is retired from contracts, and Playwright
> operational specs exist (unauthenticated paths verified live against
> `pnpm dev:stack`; authenticated journeys are gated on provisioning a
> development auth-email transport, since that port is fail-closed by design).
> Verification: pnpm check green (187 core + 27 web + 15 contracts tests),
> recursive builds, vinext check, naming/lint/format clean.

> **Blockers: two distinct categories.** (1) Remediation blockers: none — every
> remediation plan executed above passes its verification gate with no open
> defects attributable to this branch. (2) Production-launch blockers: still
> open and intentionally out of scope for this branch — production payment-
> provider integration (only the test fake exists; live checkout fails closed),
> renewal/dunning/grace policy automation, the default immediate-vs-period-end
> cancellation UX choice, the paid-success downstream recovery policy, the
> post-clamp recurring billing anchor, and the deferred Plan 08 items listed
> above. This branch does not resolve or implement any of them.


This is a descriptive implementation snapshot for `IMPLEMENTATION_PLAN.md`. It is non-authoritative and may lag the worktree. It does not define or weaken the canonical architecture, ownership, domain invariants, state machines, data model, contracts, MVP scope, or sequencing. When this file conflicts with the canonical set named in `AGENTS.md`, the canonical set wins.

> **2026-08-26 architecture reconciliation.** The canonical documents now define
> one PHP 299.00/calendar-month membership, a Promotions-owned one-calendar-month
> introductory trial, separate Payments ownership, terminal `CANCELED` and
> `EXPIRED` subscription states, and provider-event inbox/CAS semantics. No
> application code or migration was changed by that reconciliation. The dirty
> Phase 4C implementation and untracked `0015_phase4c_subscriptions.sql` remain
> incomplete worktree state and are not accepted architecture.

> **2026-08-26 product-rulings reconciliation.** Product decisions D1-D11 plus the
> delivery-instruction, order-detail/tracking, and minimal-support rulings are
> now encoded in the canonical set: `MVP_SCOPE.md` (launch inclusions,
> exclusions, Phase 1.5, acceptance criteria 18-25), `STATE_MACHINES.md` and
> `DOMAIN_MODEL.md` (trial authorization precondition, renewal/dunning with
> 7-calendar-day `PAST_DUE` grace that preserves checkout eligibility, retry
> ownership, trial-abuse policy), `ARCHITECTURE.md` (Cron Triggers mechanism,
> Notifications bounded context, Catalog-owned R2 media records, inline launch
> email clarification), and the marketplace design documents (Instant restored
> as a first-class mode pending its dedicated design specification). The program
> decomposition lives in
> `docs/superpowers/plans/2026-08-26/PRODUCT_FEATURE_PROGRAMS.md`. Documentation
> only: no application code or migration changed. The remediation state above is
> unaffected; production-launch blockers remain open with two policy deltas now
> resolved by ruling: the post-clamp billing anchor (nominal anchor preserved)
> and the renewal/dunning policy itself (approved; automation unbuilt).

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
| Phase 4 | Customers, Addresses, Membership, and Introductory Trial | IMPLEMENTED MVP SLICE; BILLING PROVIDER REQUIRED | PARTIAL — Phase 4A customer-principal boundary and Phase 4B addresses are implemented with migration and flow tests; Membership/Promotions reconciliation is not implemented or accepted |
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
- **BLOCKER — payment commitment is still a compatibility mock.** The current
  route can synthesize sandbox payment success without a production provider,
  signed event, or canonical Payments-to-Membership/Order reaction.
- **BLOCKER — Phase 4C is not reconciled.** The dirty code/contracts and untracked
  `0015` draft conflict with the canonical membership, trial, cancellation, and
  payment-ownership decisions and currently fail workspace typechecking.
- **BLOCKER — auth production safety remains unproven.** Dynamic trusted-origin
  behavior and authentication bearer URLs in logs require correction before launch.
- **BLOCKER — inventory/receiving/refund command integrity remains incomplete.**
  Atomic ledger/idempotency, bounded replay-safe receiving, and provider-confirmed
  refund behavior are not established.
- **HIGH — flow coverage is still narrow.** The customer checkout loop,
  customer-address ownership/versioning, D1 capacity/inventory races, and
  checkout-expiry reconciliation now have automated tests; payment-provider,
  refund/amendment, procurement, fulfillment, delivery, and scheduled
  reconciliation flows remain uncovered.

## Historical Remediation Pass Status

The bullets in this section describe earlier implementation passes. They are not
architecture authority or proof that the audited commerce phases are production-ready.

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
- **Historical verification note:** Earlier remediation snapshots reported formatting, naming, typecheck, lint, tests, and recursive builds passing. That statement does not describe the current dirty Phase 4C worktree; see the current verification section below.

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

> **2026-08-26 documentation-reconciliation note.** Only read-only checks relevant
> to this documentation phase were run. Passing tests do not imply production
> readiness, and the current dirty Phase 4C worktree does not typecheck.

- Migration history through `0014_phase4b_address_serviceability_outcome.sql` is the last tracked migration baseline. The untracked `0015` draft is excluded from accepted architecture.
- `pnpm naming:check` passes.
- `pnpm test` passes across the workspace, including 14 Core test files and 42 Core tests.
- `pnpm typecheck` fails because the dirty Phase 4C contract requires an idempotency key missing from the Web trial route and the Web Core-binding mock lacks the newly declared subscription methods.
- Formatting, lint, recursive build, vinext compatibility, Wrangler startup, and UI smoke checks were not re-run for this documentation-only reconciliation; earlier results remain historical evidence only.
- Phase 4B owner-scoped address reads and optimistic-version updates have integration coverage.
- Phase 4B address views persist Core's serviceability outcome and resolver reason; legacy
  rows remain explicitly unresolved until re-resolved.
- Checkout flow, D1 concurrency guards, and checkout-expiry reconciliation have focused integration coverage.
