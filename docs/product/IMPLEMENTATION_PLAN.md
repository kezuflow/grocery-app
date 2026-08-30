# FreshMarkets Dependency-Aware Implementation Plan

## Planning Rules

Implement vertical/domain foundations in dependency order, not page order. Each phase must preserve the architecture and must not silently change locked business decisions. A phase is complete only when its domain behavior, Core contracts, persistence, Web surface, tests, and operational acceptance criteria are complete enough for the next dependent phase.

Every phase below explicitly excludes work that belongs later.

This document is authoritative for implementation sequence and phase acceptance, not for redefining runtime ownership, business semantics, lifecycle vocabulary, conceptual persistence, or API boundaries. Those decisions remain authoritative in `ARCHITECTURE.md`, `DOMAIN_MODEL.md`, `STATE_MACHINES.md`, `DATA_MODEL.md`, and `API_CONTRACTS.md`. Historical remediation-pass notes below describe prior work and never override those documents or accept a draft migration.

## Remediation Pass 1 — P0/P1 Foundations (2026-08-25)

This bounded remediation pass is applied across the existing product slice before
further phase expansion. It preserves compatibility behavior and the locked
business invariants. Its recorded decisions are historical implementation
context, not an additional authority:

- `docs/architecture/REMEDIATION_DECISIONS.md` records historical naming,
  configuration, capacity, pricing, and migration decisions for this pass; the
  canonical document set supersedes any conflict.
- `STATE_MACHINES.md` remains authoritative for lifecycle vocabulary and legal
  transitions; `API_CONTRACTS.md` remains authoritative for target RPC shapes.
- Existing launch RPCs remain compatibility adapters until their replacement
  contracts are implemented in the relevant phase.

Completed foundations include boundary validation, operational scope checks,
canonical Cebu configuration, clock injection, safe transition errors,
expected-version fields/checks, idempotency primitives, and corrective
migration `0007_remediation_foundations.sql`. These changes do not claim that
the later commerce phases are complete.

Still explicitly deferred to their owning phases are full replay/idempotency
coverage, trigger replacement, cycle-zone capacity, checkout attempts and quote
snapshots, payment events/webhooks, the inventory ledger, and complete flow and
concurrency test coverage.

## Architecture and Security Hardening Pass (2026-08-30)

The integrated post-Admin/post-Maps baseline now enforces contract/runtime conformance,
TypeScript dependency direction, bounded auth/webhook/customer command bodies, one-ID Web/Core
correlation, environment-safe browser headers, separate liveness/readiness, redacted telemetry,
explicit Worker log/trace sampling, generated-binding freshness, and zero lint warnings. Core's
non-Admin/non-Maps auth, catalog, membership, checkout, payment, customer-order, inventory,
procurement, and fulfillment transports are bounded adapters over a shared dependency context.
Admin and Maps behavior remains independently pinned while its transport awaits owner-authorized
mechanical extraction. This pass changes no locked business invariant and does not claim that later
customer product phases are complete.

## Remediation Pass 2 — Commerce Invariants (2026-08-26)

The second bounded pass moves the existing compatibility checkout path onto the
canonical persistence foundations without extracting domains or expanding UI.
It adds cycle-zone-location capacity/allocation records, persisted checkout
attempts and quote snapshots, historical mock payment events, inventory holds and ledger
entries, and persisted Cebu minimum-basket/zone-fee policy. The historical D1
triggers are removed by append-only migration after the compatibility command
path takes ownership of those checks and writes.

The historical synthetic paid-order compatibility RPC coordinated
idempotency, quote persistence, conditional capacity and stock holds, payment and
order snapshots, and failure compensation; it has since been replaced by the provider-neutral
payment-intent/reaction path. Production payment integration,
all-command idempotency, broader lifecycle implementations, and complete
database-backed concurrent flow tests remain owned by their later phases.

## Phase 0 — Repository, Cloudflare, and Tooling Foundation

### Purpose

Establish a buildable monorepo, Workers deployment shape, typed RPC foundation, testing, and vinext compatibility evidence.

### Dependencies

None.

### Domain/application work

- Create workspace/package conventions and contract/validation/domain-shared packages.
- Establish Core module conventions, command/query result/error conventions, correlation IDs, idempotency primitives, and clock abstraction.
- Define provider ports without choosing production payment/geocoding/email vendors.

### D1/data changes

- Establish migration runner conventions, local D1 test database, and schema ownership policy.
- Do not create product schema yet.

### RPC contracts

- Service Binding entrypoint, request metadata, error envelope, health/readiness, versioning policy.

### Web/UI work

- Create vinext Cloudflare app shell, route groups, CSS/design token baseline, and typed Core client.
- Run `vinext check`, production build, local Worker smoke test, and Service Binding invocation.

### Cloudflare resources

- Web -> Core Service Binding.
- Core D1 binding placeholder, observability config, secrets convention, and optional local Queue/R2 test bindings.

### Tests and acceptance

- Workspace typecheck/lint/test commands.
- Contract compile test from both apps.
- Web production build/deploy dry run.
- Core local invocation and structured error/correlation smoke test.

### Not in this phase

Authentication behavior, business tables, marketplace pages, checkout, payments, inventory, procurement, and delivery.

## Phase 1 — Better Auth and RBAC Foundation

### Purpose

Make Core authoritative for identity and establish application authorization separately.

### Dependencies

Phase 0.

### Domain/application work

- Integrate Better Auth in Core with Google OAuth, email/password, verification, password reset, and secure persistent sessions.
- Define auth-user linkage, customer/staff principal provisioning, capability model, role assignments, market/location scopes.
- Build authorization policies that consume Core session context.

### D1/data changes

- Apply only Better Auth-supported schema/migrations. Better Auth 1.7 account identity is issuer-qualified, so the migration includes the supported `issuer` field and `(issuer, account_id)` uniqueness.
- Add application customer/staff/role/capability/assignment tables; do not modify Better Auth-owned records beyond supported configuration.

### RPC/contracts

- Session/application context DTO.
- Auth proxy boundary documentation and safe session-context query.

### Web/UI work

- Browser login/register/verify/reset/logout flows.
- Web auth proxy/callback routes preserving cookies, `Set-Cookie`, origin/host, redirect, and CSRF semantics.
- Authenticated route shells and capability-aware navigation.

### Cloudflare resources

- Core D1 Better Auth/application tables.
- Core secrets for Google OAuth and the production email delivery provider. Local tests may capture verification/reset links through an explicit test-only sink; production and shared logs must never contain bearer URLs or authentication tokens.

### Tests and acceptance

- Google OAuth callback, email/password, verification, reset, session persistence, logout, and expired-session tests.
- Web/Core cookie preservation and public-origin tests.
- Authorization capability/scope tests; verify authentication does not grant checkout/admin rights.

### Not in this phase

Subscriptions, customer addresses, commerce, catalog, payment, or product UI.

## Phase 2 — Markets, Locations, Serviceability, and Geofencing

### Purpose

Make address coordinates and operational geography authoritative.

### Dependencies

Phase 1 for customer linkage; Phase 0 provider ports.

### Domain/application work

- Organization, market, fulfillment locations/capabilities, versioned service-area and zone polygons.
- Geocoder port and coordinate confirmation policy. Phase 2 accepts confirmed coordinates directly; a production geocoder provider remains configuration/integration work.
- Serviceability query and location candidate resolution.

### D1/data changes

- Geography tables plus indexes/version columns. Saved customer-address persistence remains Phase 4 so the customer/address domain is introduced as one coherent unit.
- Seed one Metro Cebu market, Cebu City service area, initial zone, and Cebu Central location.

### RPC/contracts

- Coordinate resolution, versioned serviceability result, and eligible location summary. Address CRUD remains Phase 4.

### Web/UI work

- Coordinate confirmation/coverage form, immediate serviceability feedback, and unavailable-state guidance. Saved-address UI and provider-backed map search remain Phase 4/provider work.

### Cloudflare resources

- No new binding is required for direct-coordinate evaluation. A future provider adapter may use a Core secret; optional cache remains non-authoritative.

### Tests and acceptance

- Boundary-inside/outside polygon tests, invalid coordinates, stale polygon version, address snapshot behavior, and location capability filtering.

### Not in this phase

Delivery cycles, inventory, catalog, checkout, and customer hub selection.

## Phase 3 — Catalog, SKUs, Units, Availability, and Pricing

### Purpose

Create the global product model and exact base-unit pricing/availability semantics.

### Dependencies

Phase 2 location model.

### Domain/application work

- Products/categories, fixed SKU variants, unit definitions, inventory pools, location availability, price versions, customer display projections.

### D1/data changes

- Catalog/unit/availability/price tables and active-price indexes.
- Seed representative produce and unit conversions.

### RPC/contracts

- Marketplace search/detail/category read models.
- Admin catalog/product/price/availability commands.

### Web/UI work

- Public browse/search/category/product surfaces with fixed variant selection and location-aware availability messaging.

### Cloudflare resources

- Optional R2 product-media metadata only if media is included in the vertical slice.

### Tests and acceptance

- Conversion tests for grams/pieces/packs, shared inventory-pool identity, price versioning, unavailable locations, and historical price isolation.

### Not in this phase

Cart, subscriptions, checkout, procurement, or physical inventory balances.

## Phase 4 — Customers, Addresses, Membership, and Introductory Trial

### Purpose

Add commerce customer state, paid membership semantics, and the introductory promotional entitlement required for purchase eligibility.

### Dependencies

Phases 1–3.

### Domain/application work

- Customer profile and address domain.
- One paid membership offer at PHP 299.00 per calendar billing month.
- Subscription aggregate, canonical lifecycle/eligibility policy, scheduled-cancellation metadata, and guarded lifecycle commands.
- Promotions-owned one-per-customer introductory grant/redemption that permits `TRIALING` for exactly one calendar billing month. Calculate in the Market business timezone, clamp to the target month's final valid day when necessary, and persist UTC instants.
- Membership reaction ports for canonical Payments outcomes; no payment-provider payload or vendor state enters Membership.

### D1/data changes

- Customer/address/membership-offer/subscription tables and indexes.
- The minimal promotion definition, grant, and redemption persistence required for the introductory membership trial. Membership offers contain no `trial_days` authority.

### RPC/contracts

- Customer/account/address/subscription queries and commands, including immediate and period-end cancellation intent.
- Subscription eligibility DTO for checkout consumers.

### Web/UI work

- Account, addresses, paid membership offer, introductory promotion terms, billing state, scheduled-cancellation state, and gated purchase messaging.

### Cloudflare resources

- No payment provider is owned by this phase. Define only the Membership-side application port consumed later by canonical Payments outcomes; provider secrets and adapters belong to Phase 7.

### Tests and acceptance

- Exact calendar-month trial boundary cases, grant/redemption replay, one-trial eligibility, terminal `CANCELED`/`EXPIRED` behavior, scheduled cancellation that preserves the current entitled state until its effective instant, eligible/ineligible states, address edits, and secure session/authorization integration.
- Domain tests prove that only a valid promotion redemption enters `TRIALING` and only a canonical sufficient Payments outcome can enter/recover `ACTIVE`; no provider integration is implemented in this phase.

### Not in this phase

Payment-provider integration, paid membership activation orchestration, paid grocery order commitment, or delivery execution.

## Phase 5 — Delivery Cycles, Fees, Cutoff, and Capacity

### Purpose

Represent scheduled delivery and concurrency-safe eligibility.

### Dependencies

Phases 2–4.

### Domain/application work

- Configurable cycles/windows, zone fees/rules, cycle lifecycle, capacity allocation, alternate-cycle policy.

### D1/data changes

- Cycle, fee, cycle-zone capacity, and allocation tables.

### RPC/contracts

- Available cycles, cycle summaries, admin schedule/capacity commands.

### Web/UI work

- Delivery-cycle selection and full-capacity alternatives.

### Cloudflare resources

- D1 atomic conditional allocation; no DO in the current release.

### Tests and acceptance

- Exactly-at-cutoff, full-capacity concurrency, duplicate allocation, cycle cancellation, timezone, and alternate-cycle tests.

### Not in this phase

Payment capture or order commitment.

## Phase 6 — Cart and Checkout Eligibility

### Purpose

Centralize all pre-payment validation and quote computation.

### Dependencies

Phases 2–5.

### Domain/application work

- Versioned cart, quote, eligibility policy, minimum basket, price revalidation, provider-neutral route distance, versioned integer delivery fee, and promotion seam. Cart prices are advisory and have no guarantee countdown.

### D1/data changes

- Cart, cart-item, checkout-attempt, quote snapshot, delivery-fee configuration and immutable delivery-calculation snapshot tables.

### RPC/contracts

- Cart commands/queries, eligibility evaluation, quote refresh, stable error/recovery DTOs.

### Web/UI work

- Cart, address/cycle context, quote breakdown, subscription gate, and checkout readiness states.

### Cloudflare resources

- Core D1 only; optional short-lived cache for public catalog reads.

### Tests and acceptance

- Every eligibility condition, price changes requiring explicit total re-acceptance, unavailable SKU, expired quote, stale cart, cycle cutoff, route timeout/NoRoute/malformed/missing configuration, integer minimum/per-kilometer fee, and subscription gate.

### Not in this phase

Actual payment provider side effects or committed orders.

## Phase 7 — Payments, Orders, Commitment Boundary, and Amendments

### Purpose

Implement the separate Payments context and convert provider-confirmed canonical outcomes into exactly one paid membership activation or immutable order commitment.

### Dependencies

Phase 6; provider integration port from Phase 0.

### Domain/application work

- Provider-neutral Payments context, payment intents/attempts by purpose, provider mappings/adapters, signed durable event inbox, canonical payment state, and reconciliation.
- Explicit idempotent reactions from canonical sufficient Payments outcomes to Membership activation/recovery and Order commitment.
- Order commitment transaction, immutable snapshots, amendments, and internal cancellation/refund policy seams. Customer grocery cancellation remains unexposed for the mock-payment launch.

### D1/data changes

- Checkout/order/order-item/amendment/payment-intent/payment-attempt/provider-mapping/provider-event-inbox/refund/idempotency tables. Provider references remain Payments-owned rather than Subscription fields.

### RPC/contracts

- Membership and grocery payment actions, checkout/membership commitment recovery, customer orders, amendments, and admin payment/order commands.

### Web/UI work

- Membership/grocery payment handoff and return, pending/success/failure/recovery pages, committed order detail, and pre-cutoff add-on flow. Browser return state never asserts payment success.

### Cloudflare resources

- Core payment secrets and signed webhook ingress; Queue only for non-critical follow-up.

### Tests and acceptance

- Duplicate checkout/application commands, duplicate/out-of-order provider events, signature failure, provider-to-canonical mapping, handler compare-and-swap conflict/retry/reconciliation, lost response after payment, paid-success/order-commitment recovery using the same payment, bounded exception escalation, membership activation replay, price/capacity race, immutable snapshots, amendment payment, and internal refund paths. Provider events do not supply `expectedVersion`.
- Financial-safety acceptance specifically covers exact-instant Membership entitlement, pre-discount merchandise minimum enforcement, explicit monetary-component equality, replay-before-revalidation, durable payment/authorization continuations, ambiguous-outcome reconciliation, guarded Quote/capacity commitment, and atomic outstanding-refund budget reservation.

### Not in this phase

Procurement execution, packing, rider operations, or production recurring billing. This phase is not accepted for production until an owner-approved provider is selected and the configured commitment policy is proven with signed provider events and reconciliation. Mock evidence is local acceptance only.

## Phase 8 — Location Inventory, Reservations, and Committed Demand

### Purpose

Make stocked and planned sourcing semantics operationally real.

### Dependencies

Phases 3, 5, and 7.

### Domain/application work

- Location inventory pools/balances, reservations, ledger, committed demand, hybrid calculation, release/adjustment commands.

### D1/data changes

- Inventory, reservation, ledger, committed-demand tables and indexes.

### RPC/contracts

- Admin inventory read models and adjustment commands; order-commit internal application operations.

### Web/UI work

- Customer availability states; admin inventory/ledger/exception views.

### Cloudflare resources

- Core D1; no global stock cache as authority.

### Tests and acceptance

- Shared base-unit consumption, concurrent reservations, cancellation releases, planned demand, hybrid shortfall, and ledger/audit invariants.

### Not in this phase

Supplier purchasing or receiving.

## Phase 9 — Procurement, Receiving, and Supply Exceptions

### Purpose

Turn committed demand into received usable supply with operational exception handling.

### Dependencies

Phase 8.

### Domain/application work

- Procurement aggregation/requirements, supplier/purchase abstractions, receiving, shortages, quality rejection, discrepancies, alternate-source and refund resolution commands.

### D1/data changes

- Procurement, supplier, purchase order, receiving, and supply-exception tables.

### RPC/contracts

- Requirements, approval, purchase, receiving, and exception queues/commands.

### Web/UI work

- Admin procurement and receiving workspaces.

### Cloudflare resources

- R2/Queue only for documents or non-critical notifications; D1 remains truth.

### Tests and acceptance

- Demand calculation, partial fill, rejection, receiving discrepancy, duplicate receipt command, and order-line resolution/refund behavior.

### Not in this phase

Stock transfers, supplier optimization, or customer substitutions.

## Phase 10 — Fulfillment and Packing

### Purpose

Prepare committed orders for dispatch through explicit location-scoped work.

### Dependencies

Phase 9.

### Domain/application work

- Fulfillment task/line state, pick quantities, shortage exceptions, pack/handoff transitions.

### D1/data changes

- Fulfillment task/line tables and operational indexes.

### RPC/contracts

- Queue/detail read models and picker/packer commands.

### Web/UI work

- Admin fulfillment queues, detail, scan/manual workflows, workload summary.

### Cloudflare resources

- Core D1; optional R2 media later.

### Tests and acceptance

- Legal transitions, location scopes, exact packed quantity, shortages, reservation consumption, and duplicate worker action.

### Not in this phase

Dispatch routing, rider assignment, or route optimization.

## Phase 11 — Delivery Operations and Rider Experience

### Purpose

Move ready orders through batches, assigned riders, stops, delivery proof, and failures.

### Dependencies

Phase 10 and Phase 1 staff/rider identity.

### Domain/application work

- Delivery batch/job/stop state, rider assignments, stop sequencing, failure/retry/reschedule/escalation, proof metadata.

### D1/data changes

- Delivery/batch/rider/event/proof tables.

### RPC/contracts

- Dispatch summaries/commands and rider task commands.

### Web/UI work

- Admin dispatch board, rider mobile task UI, customer delivery status.

### Cloudflare resources

- R2 only for optional proof files; Queue for notifications.

### Tests and acceptance

- Assignment scope, duplicate rider events, failed-delivery reasons, retry/reschedule, proof metadata, and order/delivery projection consistency.

### Not in this phase

Live route optimization, real-time fleet tracking, or automatic refunds for every failure.

## Phase 12 — Admin Operations UI

### Purpose

Turn Core operational read models/commands into decision-focused admin workspaces.

### Dependencies

Phases 1 and 7–11.

### Domain/application work

- Fill read-model gaps, exception summaries, audit views, permission-aware action availability, and Core-provided hierarchical navigation metadata.
- Complete Catalog administration for product create/update/status, customer-facing detail fields, primary/ordered media association, persisted SKU variants, exact inventory consumption, price/location availability, and category create/detail/update/status/hierarchy. Referenced catalog records are deactivated, never generically deleted.

### D1/data changes

- Add category hierarchy and optimistic-version storage required by the canonical model, plus canonical product-media storage/association required by current release. Add indexes or rebuildable projections only where measured admin queries require them.

### RPC/contracts

- Finalize admin query DTOs and command result/error UX metadata.
- Extend Admin Context navigation with Core-authorized section and parent metadata; Web renders the hierarchy without inventing links or permissions.
- Add purpose-built category detail/update/status and product create/update/detail/media contracts with idempotency and expected-version guards. Preserve explicit SKU, price-version, availability, and status commands rather than exposing arbitrary row updates.

### Web/UI work

- Apply the light-only `.fm-admin` neutral/orange design system and fixed five-step orange chart palette, adapted from the Shadcn UI Kit reference and isolated from storefront styling.
- Build the collapsible grouped admin navigation and responsive Sheet with Overview; Commerce; Operations; Finance; and Administration sections.
- Catalog: Product List, Add Product, Product Detail, Edit Product, Category List, Add Category, Category Detail, and Edit Category, including variants, prices, availability, media, customer-facing details, hierarchy, status, contained products, and audit context.
- Orders: Order List, Order Detail, and Order Issues, including items, financial snapshots, payment, fulfillment, delivery, amendments, timeline, exceptions, allowed actions, and audit context. Do not add admin Order creation.
- Payments: Payment Overview, Transactions, Payment Detail, and Reconciliation, with contextual refund/retry/reconcile commands.
- Customers, Privacy Queue, Memberships, Promotions, Inventory, Procurement Requirements, Receiving, Fulfillment, Delivery, Operational Exceptions, Analytics, Staff, Roles, Audit Log, and Fulfillment Mode Settings list/detail/configuration flows as applicable.

### Cloudflare resources

- Observability and optional cache for non-sensitive read acceleration.

### Tests and acceptance

- Playwright operational flows, capability/location scopes, keyboard/accessibility, loading/empty/error states, and no raw-row leakage.
- Catalog coverage includes category hierarchy and lifecycle, product create/detail/edit/deactivate, variants, media, price/availability, stale-version and permission failures, and list-to-detail breadcrumb/filter preservation.
- Navigation coverage includes capability-filtered sections/children, specific-route active state, collapsed icon rail, mobile Sheet, keyboard/focus behavior, and strict storefront/admin token isolation.

### Not in this phase

New domain capabilities such as transfers or advanced analytics.

## Phase 13 — Marketplace Implementation and Polish

### Purpose

Complete customer-facing product surfaces against stable contracts and operations.

### Dependencies

Phases 1–11; marketplace designs.

### Domain/application work

- Close customer read-model gaps, notification/order timeline consistency, and graceful unavailable/cutoff/error states.

### D1/data changes

- Only measured query indexes or projections.

### RPC/contracts

- Stabilize marketplace DTO versions and analytics/event hooks.

### Web/UI work

- Responsive discovery/search/category/product/cart/checkout/account/order/subscription/status flows, SEO metadata, performance/accessibility polish.

### Cloudflare resources

- Validate vinext image/ISR/cache behavior in production-like environment.

### Tests and acceptance

- End-to-end browse-to-delivery journey, mobile breakpoints, auth boundary, Core authorization, price/capacity races, and recovery UX.

### Not in this phase

Restaurant-specific interactions, customer hub selection, arbitrary weight, or speculative features.

## Phase 14 — Promotions, Analytics, and Later Capabilities

### Purpose

Add explicitly prioritized post-launch capabilities without destabilizing the committed business loop.

### Dependencies

Stable current release operations and observability.

### Implemented Customer launch work

- Controlled grocery Order/Delivery Promotion rules, deterministic two-component stacking, Quote claims, and commit-time redemptions.
- Customer Membership experience, immutable Order detail/timeline, current-state reorder, typed issue intake, pre-commit abandonment, and Scheduled-before-cutoff paid additive amendments.
- D1 notification outbox/attempt processing and invoice-readiness evidence. Production sender and official accounting/tax issuance remain owner-gated.
- Opaque Core-routed Instant/Scheduled fulfillment options bound to confirmed address/cart versions.
- Versioned Analytics definitions and read-side projections/events.

### Remaining candidate work

- Recurring subscription orders.
- Multi-location candidates, transfers, richer proof, and capacity escalation.

### Tests and acceptance

- Promotion precedence/redemption, analytics reconciliation, multi-location assignment, transfer ledger correctness, and migration/backfill safety.

### Not in this phase

Unapproved scope expansion or a general promotion engine by default.

## Cross-Phase Definition of Done

- Core is the only business authority.
- Deployed runtime configuration is a closed, typed decision set that fails on unknown environments, insecure origins, incomplete credentials, or forbidden adapters; production capabilities are never inferred from local defaults.
- Contracts are typed, validated, versioned, and tested from both apps.
- Client/application/admin lifecycle commands have legal transitions, authorization, stable idempotency where replayable, expected-version checks where concurrent mutation is possible, and audit where material. Provider events instead have unique provider-event inbox identity, handler-side compare-and-swap, and safe retry/reconciliation.
- D1 changes are migration-based and tested as both fresh installs and populated upgrades across every destructive/rebuild boundary relevant to the change.
- Web UI handles loading, empty, unavailable, permission, cutoff, payment pending, and recovery states.
- Structured logs and correlation IDs make the critical flow traceable.
- Documentation is updated when behavior or contracts change.
