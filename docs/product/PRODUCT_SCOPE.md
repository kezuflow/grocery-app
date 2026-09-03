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
 -> receive the globally active Instant promise or choose its Scheduled window
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
- Privacy/account-closure baseline: Core retains data-subject request intake, account-closure request status, audit trail, an explicit distinction between disabling account access, deletion, and anonymization, and retention-policy hooks. The current Admin release intentionally exposes no standalone privacy queue or customer-detail privacy controls until an owner-approved intake, identity-verification, retention, and escalation procedure exists. Closing authentication access never silently destroys legally or operationally required order/payment/audit history; exact Philippine retention/anonymization rules remain gated on authoritative legal/accounting confirmation.

### Customer commerce

- Public discovery, search, categories, product detail, database-configured fixed variants, cart, account, order history, upcoming delivery, and delivery status.
- Global catalog and categories.
- Controlled unit registry for `MASS`, `VOLUME`, and `COUNT`; authoritative inventory/demand uses integer `GRAM`, `MILLILITER`, or `PIECE` base units.
- Fixed sellable SKU sizes/packs persisted as configuration with SKU-specific integer base consumption; no universal pack/bunch/tray conversion.
- SKU plus exact-location authoritative pricing with historical snapshots, no Market/global fallback, and no silent zero-price fallback.
- Canonical product media in Cloudflare R2 with stable media references/object keys and alt/accessibility text; at minimum one primary image per sellable product, associated through a basic admin upload/association flow or controlled import/seed path. Arbitrary external URLs are not the canonical media source.
- Customer saved addresses with geocode coordinates and map confirmation where supported.
- Structured delivery instructions (building/unit, landmark, gate/guard instruction, delivery note, recipient/contact instruction where appropriate) captured separately from structured Address fields and snapshotted immutably onto each committed Order; later Address edits never rewrite historical Order instructions.
- Cebu City polygon serviceability and delivery-zone resolution.
- `INSTANT` and `SCHEDULED` fulfillment with exactly one versioned global active mode. Scheduled cadence starts with configurable `WEEKLY`; Instant does not require a cycle. Locations retain independent operational readiness but never select a customer mode.
- Instant current-availability policy and expiring checkout inventory holds; Scheduled cycles/windows, fees, cutoff, capacity, planned demand, and procurement compatibility.
- One paid calendar-month membership with a global effective-dated price/currency, per-Subscription agreed-price grandfathering, and lifecycle management using the canonical Subscription states. New price versions apply only to new Subscriptions unless an explicit migration is separately authorized.
- One introductory Promotions grant that waives the membership fee for exactly one calendar billing month; calendar arithmetic uses the configured business timezone and persists UTC start/end instants. The trial requires no payment authorization, creates no Payment, ends in `EXPIRED` at `trialEndsAt`, and never automatically converts or charges.
- Explicit post-trial paid enrollment using PayMongo Scheduled Subscriptions: a customer who chooses to subscribe creates a separate `PENDING` Subscription at the then-current price; provider-confirmed initial success activates it. PayMongo owns invoice generation and payment retries. Provider `past_due` preserves entitlement while that retry cycle is active; recovery returns `ACTIVE`; exhausted retries map to non-entitled `UNPAID`. FreshMarkets records the agreed commercial snapshot and provider plan/subscription/invoice evidence but never initiates a second renewal attempt.
- Introductory-trial abuse policy: one trial per application customer, enforced by Promotions grant/redemption history; no payment-method or mandatory SMS/phone prerequisite; residual promotional abuse is accepted at launch.
- Central mode-aware checkout eligibility service: authenticated Instant is pay-as-you-go without membership; Scheduled requires eligible membership at quote, payment revalidation, and commitment.
- One global effective-dated FreshMarkets Service Fee for Instant only, configurable as flat, percentage of the complete payable pre-fee total, or mixed flat plus percentage. Scheduled has no Service Fee. Quote and Order snapshots preserve the exact configuration/calculation, and stale fee evidence requires explicit re-acceptance.
- One Promotions context with controlled launch membership-fee-waiver, order percentage/fixed discount, and delivery fee waiver/discount benefits; closed configurable eligibility rules, grants/redemptions, limits, and deterministic one-order-plus-one-delivery stacking.
- Separate provider-neutral Payments boundary for membership and grocery payments. The deterministic mock adapter is development/test-only. The owner-approved PayMongo adapter provides signed event ingestion, canonical state translation, idempotent provider resources, and reconciliation; production launch still requires enabled account capabilities, deployed credentials/webhook configuration, and live acceptance evidence.
- Explicit Quote/Order monetary components and committed immutable SKU conversion, Promotion, fulfillment mode/location/zone/promise/window/ETA, delivery-instruction, and optional Scheduled-cycle snapshots.
- Committed order creation and additive paid-order amendments under mode-specific eligibility. Scheduled uses cutoff; the normal Instant amendment deadline remains fail-closed until approved.
- Customer Order Detail surface with an authoritative timeline derived from Order/Fulfillment/Delivery state, including amendments, delivery status, and next valid customer actions. Live rider GPS tracking is excluded.
- Reorder/buy-again from a historical Order: currently purchasable items are added to the current ordinary cart under current price, catalog state, serviceability, and availability; unavailable/discontinued items are skipped and clearly reported; historical pricing, inventory, or capacity is never restored; no recurring baskets.
- Customer order-issue intake for at least missing item, wrong item, damaged item, poor-quality produce, quantity discrepancy, delivery issue, and other-with-notes. Issue intake is separate from Refund/Credit authorization, never fabricates a refund, and feeds an admin operational queue.
- Minimal support/contact routing from relevant order and account surfaces.

### Operations

- Location-specific shared Product inventory with Instant holds/reservations and Scheduled committed-demand/procurement semantics derived from the global mode.
- Demand aggregation, procurement requirements, purchase/receiving records, shortages, rejections, and discrepancy handling.
- Picking, packing, fulfillment readiness, delivery batches/jobs/stops, rider assignment, delivery events, failure reasons, and retry/reschedule commands.
- A provider-neutral external-courier boundary with a GrabExpress adapter, immutable outbound
  dispatch/idempotency evidence, exact-coordinate and customer-contact delivery payloads, and
  uncertain-outcome reconciliation. Production booking remains disabled until Grab enables Cebu
  access and the sender/package/webhook acceptance gates are satisfied.
- Admin Overview, Customers, Orders, Products, Inventory, Promotions, Payments, Delivery, Analytics, and Staff & Access primary workspaces using purpose-built Core commands/read models. The selector presents Global and Central Cebu for the current release. Global Products owns identity, Categories, media, and Sell variants only; Central Cebu Operations contains Products, Inventory, and Delivery, with Products focused on exact local price, local selling status, and the one shared Product inventory pool. No sourcing selector, resolved-price fallback, pricing-context label, or catalog-reference label is exposed. Memberships lives under Customers, Categories lives under Global Products, and the default Inventory flow is dated stock in/out. Procurement, Receiving, and Fulfillment remain contextual advanced workflows over their independent Core state machines.
- A light-only clean-room Admin presentation aligned to the approved public Shadcn UI Kit dashboard geometry: a default 72px icon rail with remembered 252px expansion, responsive Sheet navigation, dense list/detail/editor/configuration archetypes, accessible charts, and FreshMarkets orange accents isolated under `.fm-admin`.
- A global `/admin/commerce-configuration` workspace with independently authorized Membership Price and Instant Service Fee tabs over the existing effective-dated Core configuration commands. No arbitrary history editing or committed-snapshot mutation is included.
- Capability-based Application IAM and scoped customer summary/detail, operational queue, and read-only Analytics projections. Named metrics are unavailable until one canonical versioned formula is approved.
- Structured logs, correlation IDs, audit events, idempotency, webhook replay handling, and basic reconciliation.
- Time-driven execution via Cloudflare Cron Triggers dispatching an explicit scheduled-job registry of idempotent Core commands (checkout/payment-hold expiry, introductory-trial expiry, scheduled membership cancellation, provider-inbox and reconciliation redrive, provider-action expiry, cycle cutoff/advancement/closeout, notification scheduling). PayMongo—not Cron—owns paid subscription invoice and retry timing. Cron owns no business state and contains no business policy.
- Transactional notification emails as the launch channel (order/payment/delivery/membership events plus cancellation requested, refund progressing/completed/exception, and cancellation completed). Notifications are side effects that communicate authoritative state and never mutate domain truth.
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
3. The global effective-dated calendar-month membership offer can enter `TRIALING` only through a one-per-customer introductory Promotion grant/redemption. The trial ends exactly one calendar billing month later under the configured business timezone, and merchandise/delivery remain charged. Each Subscription retains its agreed amount/currency across ordinary price changes.
4. Core permits authenticated Instant checkout without membership and requires eligible membership for Scheduled. It rejects checkout for a mode-specific entitlement failure, non-serviceable coordinate, unavailable active fulfillment mode/option, invalid or expired Instant hold, invalid/closed/cutoff/full Scheduled cycle, invalid SKU/context price, unavailable SKU, Promotion conflict/ineligibility, or below-minimum basket.
5. A signed provider event maps to a canonical Payments outcome. An outcome sufficient under the configured commitment policy produces exactly one paid Membership activation or committed Order through an explicit idempotent command, or a visible recoverable finance exception. Browser return state and payment initiation are insufficient.
6. The committed order cannot be rewritten when catalog prices or saved addresses change.
7. Instant items hold/reserve exact-location shared Product inventory; Scheduled items create committed base-unit demand for procurement. No independent or hybrid sourcing selector exists.
8. Procurement requirements reconcile demand, safety buffer, usable inventory, and incoming stock.
9. Receiving discrepancies and supply shortages create explicit operational exceptions and auditable resolutions.
10. Fulfillment and delivery state machines reject illegal transitions and enforce staff/rider scope.
11. A rider can complete a delivery or record a failure that enters an explicit retry/reschedule/escalation path.
12. Admin read models answer current Instant/Scheduled operational questions without exposing raw persistence rows.
13. FreshMarkets has exactly one global active `INSTANT`/`SCHEDULED` configuration. Instant checkout uses current exact-location base-unit availability and an expiring hold without a synthetic cycle; Scheduled checkout uses its configured window/cycle/cutoff/capacity without requiring stock. Switching configuration revalidates uncommitted commerce and does not change committed Order snapshots.
14. Unit conversion is controlled and same-dimension; inventory/demand quantities are integers in `GRAM`, `MILLILITER`, or `PIECE`; sellable sizes and packaging consumption come from persisted SKU configuration.
15. Every quoteable SKU has a positive authoritative exact-location price with no fallback. Quote and Order snapshots preserve merchandise subtotal, item/order discounts, delivery fee/discount, tax, pre-Service-Fee total, optional Instant Service Fee configuration/calculation, and final total. Scheduled Service Fee is zero.
16. Promotions evaluates only approved benefit/rule types, applies at most one merchandise/order and one delivery benefit deterministically, and preserves Membership-fee Promotion independence.
17. Admin actions require named capabilities/scopes. Customer/operational views and Analytics are purpose-built derived read models; Analytics cannot mutate source state or publish a named metric without one versioned canonical definition.
18. Delivery instructions applicable at commitment are snapshotted onto the committed Order; later Address edits never rewrite them.
19. An introductory trial requires no payment authorization, creates no Payment or zero-value payment, expires at `trialEndsAt`, and never converts in place. A later paid membership requires separate explicit enrollment and provider-confirmed initial success. PayMongo owns paid renewal invoices and retries; `PAST_DUE` remains eligible only during that provider retry cycle, recovery returns `ACTIVE`, and exhausted retries map to non-entitled `UNPAID`. FreshMarkets never initiates a parallel renewal attempt.
20. Notification emails are side effects only: a failed notification send never changes a committed domain outcome, and no notification handler mutates domain state.
21. Every sellable product presents a canonical R2-backed primary image (or an explicitly approved placeholder state); no arbitrary external URL acts as the canonical media source.
22. Reorder applies current price, catalog, serviceability, and availability; skipped items are reported; historical pricing, inventory, or capacity is never restored.
23. Order-issue intake records issues with typed categories and status without authorizing a refund; issues are visible in an admin operational queue.
24. Account closure disables authentication access without destroying required order/payment/audit history; data-subject/closure requests carry auditable status.
25. Invoicing seams are additive and immutable: issuance data references exactly one committed Order/payment outcome and can never be rewritten after creation.
26. Cart prices do not lock price or inventory. Before payment, Core recalculates price, discount, stock, serviceability, route-based delivery fee, mode-specific membership entitlement, and the active Instant Service Fee. A changed total or stale fee configuration creates no payment until the customer explicitly accepts the new quote.
27. Delivery fee configuration is versioned per market/location using integer minimum and per-kilometer minor-unit values. External route/configuration failure fails closed, and the committed Order snapshots provider-neutral route meters, fee inputs/result, and configuration version.
28. Customer grocery-order cancellation is ownership-, version-, and idempotency-guarded. Instant locks at `FULFILLMENT_PENDING` and retains only the snapshotted Service Fee; Scheduled locks at the earlier of cutoff or fulfillment start and coordinates the original payment plus every committed addition. FreshMarkets-caused cancellation refunds in full. Partial refund success never marks the Order canceled.
29. The basket minimum is enforced authoritatively against pre-discount merchandise only in both Instant and Scheduled checkout. Payment readiness recalculates without creating a replacement Quote, and identical replay returns the original unexpired provider continuation before Quote-state checks.
30. Paid commitment atomically guards accepted-Quote consumption and Scheduled capacity. Refund requests atomically reserve outstanding and successful refund value so concurrent requests cannot exceed captured funds.
31. Customer checkout lists opaque Core-routed Instant/Scheduled options only after a confirmed serviceable address and nonempty current cart; stale address/cart/routing/cycle evidence fails closed and no customer selects a hub.
32. Customer Order detail exposes immutable commercial/fulfillment history, a safe timeline, current legal actions, typed issues, additive amendments, notification state, and invoice availability without provider, staff-only, or routing-authority leakage.
33. Additions cannot be canceled independently. Existing unrelated refund activity routes normal cancellation to financial review; post-lock staff exception refunds require global `refunds.manage`, a reason, and audit evidence without reopening the customer window. Pre-commit Quote abandonment remains separate.
34. Launch transactional notification intent is durable in D1 and retried independently of domain success. Core uses its Cloudflare Send Email adapter only when `EMAIL` and `AUTH_EMAIL_FROM` are configured; `notifications@freshmarkets.ph` remains disabled until the domain is owned, onboarded, and authenticated.
35. Invoice readiness records exact committed evidence but does not claim official issuance, tax computation, or BIR compliance before the owner-approved accounting policy and serial/retention implementation. The printable customer transaction summary always says `NOT AN OFFICIAL BIR INVOICE`.
36. A fully privileged global Administrator can reach every Admin workspace, every market/location scope, every Admin-safe record, and every legal command. Restricted principals remain capability- and scope-filtered, and denied or unavailable overview sections are never represented as fabricated zero values.
37. Admin Product lists use an explicit authorized Global or Location scope. Global owns catalog definition and exposes no local commerce facts; Central Cebu receives a non-duplicating operational projection with exact local price, local selling status, and shared inventory. Selling status and stock status are displayed separately, and no Product detail defaults or falls back to another price target. Protected media loads only through a same-origin Web adapter over a Core-authorized content read; R2 keys never reach Web or browser contracts.
38. Overlapping eligible geofences choose the closest operational dispatch origin using exact Haversine distance and stable location-ID tie-break. Product stock never reroutes or splits an Order, and routing providers never choose its owner.

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
