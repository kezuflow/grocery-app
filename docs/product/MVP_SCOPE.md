# FreshMarkets MVP Scope

This document is authoritative for MVP inclusion, exclusion, and acceptance only. Runtime/context ownership, business meaning, lifecycle transitions, persistence, and contracts remain authoritative in their corresponding architecture documents.

## MVP Business Outcome

MVP is complete only when one customer can complete this real business loop in the initial Cebu operation:

```text
Browse marketplace
 -> create/login account
 -> activate the one-month promotional trial or paid membership
 -> build cart
 -> choose a valid Cebu serviceable address
 -> receive an Instant promise or choose a Scheduled window under the location's one active mode
 -> pay
 -> create a locked committed order
 -> convert an Instant inventory hold to reservation, or record Scheduled reservation/planned demand
 -> procure/receive where Scheduled sourcing requires it
 -> pick/pack
 -> dispatch
 -> rider delivery
 -> completed order
```

The MVP may operate one live fulfillment location, but its domain/data model must retain markets, zones, location capabilities, location availability, and location inventory from the beginning.

## MVP Included

### Platform and identity

- Monorepo with `apps/web` vinext Worker and `apps/core` authoritative Worker.
- Typed Web -> Core Service Binding.
- Better Auth in Core with D1 persistence.
- Google OAuth, email/password, email verification, password reset, persistent secure sessions.
- Customer/staff application records linked to Better Auth user IDs.
- Capability-based RBAC with global/market/location scopes.

### Customer commerce

- Public discovery, search, categories, product detail, database-configured fixed variants, cart, account, order history, upcoming delivery, and delivery status.
- Global catalog and categories.
- Controlled unit registry for `MASS`, `VOLUME`, and `COUNT`; authoritative inventory/demand uses integer `GRAM`, `MILLILITER`, or `PIECE` base units.
- Fixed sellable SKU sizes/packs persisted as configuration with SKU-specific integer base consumption; no universal pack/bunch/tray conversion.
- SKU plus market/location authoritative pricing with historical snapshots and no silent zero-price fallback.
- Customer saved addresses with geocode coordinates and map confirmation where supported.
- Cebu City polygon serviceability and delivery-zone resolution.
- `INSTANT` and `SCHEDULED` fulfillment with exactly one active mode per fulfillment location. Scheduled cadence starts with configurable `WEEKLY`; Instant does not require a cycle.
- Instant current-availability policy and expiring checkout inventory holds; Scheduled cycles/windows, fees, cutoff, capacity, planned demand, and procurement compatibility.
- One paid membership at PHP 299.00 per calendar billing month, with basic lifecycle management using the canonical Subscription states.
- One introductory Promotions grant that waives the membership fee for exactly one calendar billing month; calendar arithmetic uses the configured business timezone and persists UTC start/end instants.
- Central checkout eligibility service.
- One Promotions context with controlled MVP membership-fee-waiver, order percentage/fixed discount, and delivery fee waiver/discount benefits; closed configurable eligibility rules, grants/redemptions, limits, and deterministic one-order-plus-one-delivery stacking.
- Separate provider-neutral Payments boundary for membership and grocery payments. Sandbox/mock adapters are local-only; production requires a selected provider, signed event ingestion, canonical state translation, and reconciliation before launch.
- Explicit Quote/Order monetary components and committed immutable SKU conversion, Promotion, fulfillment mode/location/zone/promise/window/ETA, and optional Scheduled-cycle snapshots.
- Committed order creation and additive paid-order amendments under mode-specific eligibility. Scheduled uses cutoff; the normal Instant amendment deadline remains fail-closed until approved.

### Operations

- Location-specific inventory with stocked reservation and planned procurement committed-demand semantics.
- Hybrid sourcing calculation.
- Demand aggregation, procurement requirements, purchase/receiving records, shortages, rejections, and discrepancy handling.
- Picking, packing, fulfillment readiness, delivery batches/jobs/stops, rider assignment, delivery events, failure reasons, and retry/reschedule commands.
- Admin Overview, Customers, Orders, Catalog, Inventory, Promotions, Memberships, Payments, Fulfillment, Delivery, Procurement, Analytics, and Staff & Access workspaces using purpose-built Core commands/read models.
- Capability-based Application IAM and scoped customer summary/detail, operational queue, and read-only Analytics projections. Named metrics are unavailable until one canonical versioned formula is approved.
- Structured logs, correlation IDs, audit events, idempotency, webhook replay handling, and basic reconciliation.

## MVP Exclusions

- Customer-directed substitution engine.
- Variable-weight settlement, post-pick repricing, capture adjustment, or weight-based supplemental charge/refund.
- Customer-selectable hubs.
- Full multi-market rollout or multiple live locations, though schemas support them.
- Internal stock transfers UI/workflow.
- Complex route optimization or map-based fleet routing.
- Pickup-point operations.
- Arbitrary promotion scripting, unlimited stacking, loyalty points, wallet, dynamic/surge pricing, and a general user-authored rules engine.
- Advanced tax/invoicing and unresolved accounting metric definitions until local/product authority is confirmed.
- Photo/signature/recipient identity proof beyond extensible metadata.
- Durable Object capacity coordinator or Workflow orchestration.
- Separate microservices, event sourcing, separate read database, or public general-purpose REST API.

## MVP Acceptance Criteria

1. An unauthenticated browser can browse but cannot place an order.
2. A customer can create/verify/login with Better Auth and maintain a secure session through Web/Core boundaries.
3. The PHP 299.00/month membership can enter `TRIALING` only through a one-per-customer introductory Promotion grant/redemption. The trial ends exactly one calendar billing month later under the configured business timezone, and merchandise/delivery remain charged.
4. Core rejects checkout for an ineligible subscription, non-serviceable coordinate, unavailable active fulfillment mode/option, invalid or expired Instant hold, invalid/closed/cutoff/full Scheduled cycle, invalid SKU/context price, unavailable SKU, Promotion conflict/ineligibility, or below-minimum basket.
5. A signed provider event maps to a canonical Payments outcome. An outcome sufficient under the configured commitment policy produces exactly one paid Membership activation or committed Order through an explicit idempotent command, or a visible recoverable finance exception. Browser return state and payment initiation are insufficient.
6. The committed order cannot be rewritten when catalog prices or saved addresses change.
7. Stocked items reserve location inventory; planned items create committed base-unit demand; hybrid items do both as calculated.
8. Procurement requirements reconcile demand, safety buffer, usable inventory, and incoming stock.
9. Receiving discrepancies and supply shortages create explicit operational exceptions and auditable resolutions.
10. Fulfillment and delivery state machines reject illegal transitions and enforce staff/rider scope.
11. A rider can complete a delivery or record a failure that enters an explicit retry/reschedule/escalation path.
12. Admin read models answer current Instant/Scheduled operational questions without exposing raw persistence rows.
13. A location has exactly one active `INSTANT`/`SCHEDULED` configuration. Instant checkout uses current exact-base-unit availability and an expiring hold without a synthetic cycle; Scheduled checkout uses its configured window/cycle/cutoff/capacity. Switching configuration does not change committed Order snapshots.
14. Unit conversion is controlled and same-dimension; inventory/demand quantities are integers in `GRAM`, `MILLILITER`, or `PIECE`; sellable sizes and packaging consumption come from persisted SKU configuration.
15. Every quoteable SKU has a positive authoritative market/location price. Quote and Order snapshots preserve merchandise subtotal, item/order discounts, delivery fee/discount, optional service fee/tax, and final total.
16. Promotions evaluates only approved benefit/rule types, applies at most one merchandise/order and one delivery benefit deterministically, and preserves Membership-fee Promotion independence.
17. Admin actions require named capabilities/scopes. Customer/operational views and Analytics are purpose-built derived read models; Analytics cannot mutate source state or publish a named metric without one versioned canonical definition.

## Phase 1.5

- Extend the production payment provider and local methods after the MVP commitment paths are operational.
- Notifications and customer operational messaging.
- Supplier master data and richer procurement approval/reconciliation.
- Recurring subscription-generated orders.
- More complete refunds, credits, and finance reconciliation.
- Product media in R2 and stronger image workflows.
- Approved accounting definitions for currently blocked GMV/revenue/AOV/refund-rate metrics and renewal/cohort definitions for MRR, churn, and trial conversion.

## Phase 2

- Multiple Metro Cebu locations with ranked fulfillment candidates.
- Zone-level capacities and more detailed location assignment.
- Central/local procurement routing and stock transfers.
- Rich delivery proof and improved dispatch tooling.
- Richer Analytics dimensions, saved filters, and measured read-model projections after canonical metric definitions exist.
- Durable Object escalation only if capacity/dispatch contention warrants it.

## Later

- Additional markets, pickup points, cross-dock and dispatch-only sites.
- Customer substitutions and substitution preferences.
- Variable-weight settlement.
- Route optimization and richer fleet capabilities.
- Workflows for long-running exception/procurement orchestration.
- Advanced Promotions/experimentation beyond the controlled MVP benefits and stacking policy.
- Dedicated analytics/data-lake infrastructure.

## Scope Governance

Any proposed MVP addition must identify the business loop step it completes, its domain/data dependencies, its operational owner, and its failure/reconciliation behavior. “The architecture supports it” is not sufficient justification for adding speculative functionality.
