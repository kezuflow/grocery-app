# FreshMarkets Product Scope

This document is authoritative for the current release inclusion, exclusion, and acceptance only. Runtime/context ownership, business meaning, lifecycle transitions, persistence, and contracts remain authoritative in their corresponding architecture documents.

## Current Release Business Outcome

The current release is complete only when one customer can complete this real business loop in the initial Cebu operation:

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

The The current release may operate one live fulfillment location, but its domain/data model must retain markets, zones, location capabilities, location availability, and location inventory from the beginning.

## Current Release Included

### Platform and identity

- Monorepo with `apps/web` vinext Worker and `apps/core` authoritative Worker.
- Typed Web -> Core Service Binding.
- Better Auth in Core with D1 persistence.
- Google OAuth, email/password, email verification, password reset, persistent secure sessions.
- Customer/staff application records linked to Better Auth user IDs.
- Capability-based RBAC with global/market/location scopes.
- Privacy/account-closure baseline: data-subject request intake, account-closure request, request status, audit trail, an explicit distinction between disabling account access, deletion, and anonymization, and retention-policy hooks. Closing authentication access never silently destroys legally or operationally required order/payment/audit history; exact Philippine retention/anonymization rules remain gated on authoritative legal/accounting confirmation.

### Customer commerce

- Public discovery, search, categories, product detail, database-configured fixed variants, cart, account, order history, upcoming delivery, and delivery status.
- Global catalog and categories.
- Controlled unit registry for `MASS`, `VOLUME`, and `COUNT`; authoritative inventory/demand uses integer `GRAM`, `MILLILITER`, or `PIECE` base units.
- Fixed sellable SKU sizes/packs persisted as configuration with SKU-specific integer base consumption; no universal pack/bunch/tray conversion.
- SKU plus market/location authoritative pricing with historical snapshots and no silent zero-price fallback.
- Canonical product media in Cloudflare R2 with stable media references/object keys and alt/accessibility text; at minimum one primary image per sellable product, associated through a basic admin upload/association flow or controlled import/seed path. Arbitrary external URLs are not the canonical media source.
- Customer saved addresses with geocode coordinates and map confirmation where supported.
- Structured delivery instructions (building/unit, landmark, gate/guard instruction, delivery note, recipient/contact instruction where appropriate) captured separately from structured Address fields and snapshotted immutably onto each committed Order; later Address edits never rewrite historical Order instructions.
- Cebu City polygon serviceability and delivery-zone resolution.
- `INSTANT` and `SCHEDULED` fulfillment with exactly one active mode per fulfillment location. Scheduled cadence starts with configurable `WEEKLY`; Instant does not require a cycle.
- Instant current-availability policy and expiring checkout inventory holds; Scheduled cycles/windows, fees, cutoff, capacity, planned demand, and procurement compatibility.
- One paid membership at PHP 299.00 per calendar billing month, with basic lifecycle management using the canonical Subscription states.
- One introductory Promotions grant that waives the membership fee for exactly one calendar billing month; calendar arithmetic uses the configured business timezone and persists UTC start/end instants. Introductory trial activation requires an existing recurring-capable payment authorization — establishing authorization is not payment success, no zero-value payment is synthesized, and the first paid charge becomes due at `trialEndsAt`.
- Membership renewal, trial conversion, and dunning lifecycle: paid renewal requires provider-confirmed canonical Payments success; an explicit failed-renewal outcome enters `PAST_DUE` with a 7-calendar-day grace window preserving entitlement; verified recovery returns `ACTIVE`; grace exhaustion transitions to `EXPIRED`; customer cancellation during `PAST_DUE` terminates immediately to `CANCELED`. Production automatic charge initiation, retry ownership, and retry timing are unresolved and unapproved; current automated behavior is a mock-tested seam only.
- Introductory-trial abuse policy: one trial per application customer, the authorization precondition above, and provider authorization-identity reuse prevention where the provider exposes a stable identity; no mandatory SMS/phone verification; residual promotional abuse is accepted at launch.
- Central checkout eligibility service.
- One Promotions context with controlled launch membership-fee-waiver, order percentage/fixed discount, and delivery fee waiver/discount benefits; closed configurable eligibility rules, grants/redemptions, limits, and deterministic one-order-plus-one-delivery stacking.
- Separate provider-neutral Payments boundary for membership and grocery payments. The deterministic mock adapter is development/test-only; production requires a separately owner-approved provider, signed event ingestion, canonical state translation, and reconciliation before launch.
- Explicit Quote/Order monetary components and committed immutable SKU conversion, Promotion, fulfillment mode/location/zone/promise/window/ETA, delivery-instruction, and optional Scheduled-cycle snapshots.
- Committed order creation and additive paid-order amendments under mode-specific eligibility. Scheduled uses cutoff; the normal Instant amendment deadline remains fail-closed until approved.
- Customer Order Detail surface with an authoritative timeline derived from Order/Fulfillment/Delivery state, including amendments, delivery status, and next valid customer actions. Live rider GPS tracking is excluded.
- Reorder/buy-again from a historical Order: currently purchasable items are added to the current ordinary cart under current price, catalog state, serviceability, and availability; unavailable/discontinued items are skipped and clearly reported; historical pricing, inventory, or capacity is never restored; no recurring baskets.
- Customer order-issue intake for at least missing item, wrong item, damaged item, poor-quality produce, quantity discrepancy, delivery issue, and other-with-notes. Issue intake is separate from Refund/Credit authorization, never fabricates a refund, and feeds an admin operational queue.
- Minimal support/contact routing from relevant order and account surfaces.

### Operations

- Location-specific inventory with stocked reservation and planned procurement committed-demand semantics.
- Hybrid sourcing calculation.
- Demand aggregation, procurement requirements, purchase/receiving records, shortages, rejections, and discrepancy handling.
- Picking, packing, fulfillment readiness, delivery batches/jobs/stops, rider assignment, delivery events, failure reasons, and retry/reschedule commands.
- Admin Overview, Customers, Orders, Catalog, Inventory, Promotions, Memberships, Payments, Fulfillment, Delivery, Procurement, Analytics, and Staff & Access workspaces using purpose-built Core commands/read models.
- Capability-based Application IAM and scoped customer summary/detail, operational queue, and read-only Analytics projections. Named metrics are unavailable until one canonical versioned formula is approved.
- Structured logs, correlation IDs, audit events, idempotency, webhook replay handling, and basic reconciliation.
- Time-driven execution via Cloudflare Cron Triggers dispatching an explicit scheduled-job registry of idempotent Core commands (checkout/payment-hold expiry, scheduled membership cancellation, renewal initiation only behind the explicit ownership gate, confirmed-outcome/dunning/grace processing, provider-inbox and reconciliation redrive, provider-action expiry, cycle cutoff/advancement/closeout, notification scheduling). Cron owns no business state and contains no business policy.
- Transactional notification emails as the launch channel (order confirmed; payment action required; payment failed; Scheduled cutoff reminder; out for delivery; delivered; failed delivery; renewal payment failed/action required; introductory trial ending; upcoming first paid renewal). Notifications are side effects that communicate authoritative state and never mutate domain truth.
- BIR-compliant invoicing readiness: persistence seams for invoice identifier/serial, issuance timestamp, seller/taxpayer snapshot, taxable/VAT breakdown, immutable relationship to the committed Order/payment, and future external/electronic invoice references. Exact computation and retention rules remain gated on authoritative accounting/tax confirmation before go-live.

## Current Release Exclusions

- Customer-directed substitution engine.
- Variable-weight settlement, post-pick repricing, capture adjustment, or weight-based supplemental charge/refund.
- Customer-selectable hubs.
- Customer reviews/ratings.
- Live GPS/rider tracking.
- Customer-initiated post-commitment delivery-window rescheduling; the supported current release route is the legally allowed cancellation path followed by reorder where applicable.
- Full multi-market rollout or multiple live locations, though schemas support them.
- Internal stock transfers UI/workflow.
- Complex route optimization or map-based fleet routing.
- Pickup-point operations.
- Arbitrary promotion scripting, unlimited stacking, loyalty points, wallet, dynamic/surge pricing, and a general user-authored rules engine.
- Advanced tax/invoicing and unresolved accounting metric definitions until local/product authority is confirmed.
- Photo/signature/recipient identity proof beyond extensible metadata.
- Durable Object capacity coordinator or Workflow orchestration.
- Separate microservices, event sourcing, separate read database, or public general-purpose REST API.

## Current Release Acceptance Criteria

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
18. Delivery instructions applicable at commitment are snapshotted onto the committed Order; later Address edits never rewrite them.
19. No introductory trial activates without an existing recurring-capable payment authorization and no zero-value payment is synthesized; the first paid charge becomes due at `trialEndsAt`; failed renewal enters `PAST_DUE` with a 7-calendar-day grace window preserving checkout eligibility; verified recovery returns `ACTIVE`; grace exhaustion transitions to `EXPIRED`; cancellation during `PAST_DUE` transitions immediately to `CANCELED` with no further renewal attempts.
20. Notification emails are side effects only: a failed notification send never changes a committed domain outcome, and no notification handler mutates domain state.
21. Every sellable product presents a canonical R2-backed primary image (or an explicitly approved placeholder state); no arbitrary external URL acts as the canonical media source.
22. Reorder applies current price, catalog, serviceability, and availability; skipped items are reported; historical pricing, inventory, or capacity is never restored.
23. Order-issue intake records issues with typed categories and status without authorizing a refund; issues are visible in an admin operational queue.
24. Account closure disables authentication access without destroying required order/payment/audit history; data-subject/closure requests carry auditable status.
25. Invoicing seams are additive and immutable: issuance data references exactly one committed Order/payment outcome and can never be rewritten after creation.
26. Cart prices do not lock price or inventory. Before payment, Core recalculates price, discount, stock, serviceability, and route-based delivery fee; a changed total creates no payment until the customer explicitly accepts the new total.
27. Delivery fee configuration is versioned per market/location using integer minimum and per-kilometer minor-unit values. External route/configuration failure fails closed, and the committed Order snapshots provider-neutral route meters, fee inputs/result, and configuration version.
28. Customer grocery-order cancellation is absent from the mock-payment launch. A successful payment followed by commitment failure is retried idempotently against the same payment and escalates visibly after bounded failure without a duplicate payment/order or inferred automatic refund.
29. The basket minimum is enforced authoritatively against pre-discount merchandise only in both Instant and Scheduled checkout. Payment readiness recalculates without creating a replacement Quote, and identical replay returns the original unexpired provider continuation before Quote-state checks.
30. Paid commitment atomically guards accepted-Quote consumption and Scheduled capacity. Refund requests atomically reserve outstanding and successful refund value so concurrent requests cannot exceed captured funds.
31. Customer checkout lists opaque Core-routed Instant/Scheduled options only after a confirmed serviceable address and nonempty current cart; stale address/cart/routing/cycle evidence fails closed and no customer selects a hub.
32. Customer Order detail exposes immutable commercial/fulfillment history, a safe timeline, current legal actions, typed issues, additive amendments, notification state, and invoice availability without provider, staff-only, or routing-authority leakage.
33. Committed grocery-order cancellation remains unavailable to customers until cancellation/refund policy is approved. Pre-commit Quote abandonment is explicit, idempotent, and releases only provisional Instant holds or Scheduled capacity.
34. Launch transactional notification intent is durable in D1 and retried independently of domain success. Core uses its Cloudflare Send Email adapter only when `EMAIL` and `AUTH_EMAIL_FROM` are configured; production delivery is not launch-ready until that sender domain is onboarded and verified.
35. Invoice readiness records exact committed evidence but does not claim official issuance, tax computation, or BIR compliance before the owner-approved accounting policy and serial/retention implementation.

## Phase 1.5

- Extend the production payment provider and local methods after the current release commitment paths are operational.
- SMS/push notification channels, notification preferences, and richer operational messaging beyond the launch email set.
- Favorites.
- Supplier master data and richer procurement approval/reconciliation.
- Recurring subscription-generated orders.
- More complete refunds, credits, and finance reconciliation, including fuller customer credit/refund self-service.
- Richer product-media administration and additional image workflows beyond the primary-image baseline.
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
- Advanced Promotions/experimentation beyond the controlled Current-release benefits and stacking policy.
- Dedicated analytics/data-lake infrastructure.

## Scope Governance

Any proposed product-scope addition must identify the business loop step it completes, its domain/data dependencies, its operational owner, and its failure/reconciliation behavior. “The architecture supports it” is not sufficient justification for adding speculative functionality.
