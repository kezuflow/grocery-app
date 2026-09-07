# FreshMarkets Product Scope

This document is authoritative for the current release inclusion, exclusion, and acceptance only. Runtime/context ownership, business meaning, lifecycle transitions, persistence, and contracts remain authoritative in their corresponding architecture documents.

## Current Release Business Outcome

The current release is complete only when one customer can complete this real business loop in the initial Cebu operation:

```text
Browse marketplace
 -> create/login account
 -> use Instant or Scheduled pay-as-you-go without membership
 -> build cart
 -> choose a valid Cebu serviceable address
 -> pass global selling OPEN and receive the globally active Instant promise or Scheduled window
 -> pay
 -> create a locked committed order
 -> convert an Instant inventory hold to reservation, or record exact Scheduled preorder demand
 -> buy exactly the paid Scheduled demand
 -> pick/pack
 -> dispatch through Lalamove or Scheduled emergency manual fallback
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
- Controlled unit registry for active `MASS` and `COUNT`; authoritative active inventory/demand uses integer `GRAM` or `PIECE` base units.
- Current catalog authoring enables only `MASS` and `COUNT`; packaged liquids are sold by piece. Historical `VOLUME` definitions remain inactive compatibility data.
- Fixed sellable SKU sizes/packs persisted as configuration with SKU-specific integer base consumption; no universal pack/bunch/tray conversion.
- SKU plus exact-location authoritative pricing with historical snapshots, no Market/global fallback, and no silent zero-price fallback.
- Canonical product media in Cloudflare R2 with stable media references/object keys and alt/accessibility text; at minimum one primary image per sellable product, associated through a basic admin upload/association flow or controlled import/seed path. Arbitrary external URLs are not the canonical media source.
- Customer saved addresses with geocode coordinates and map confirmation where supported.
- Structured delivery instructions (building/unit, landmark, gate/guard instruction, delivery note, recipient/contact instruction where appropriate) captured separately from structured Address fields and snapshotted immutably onto each committed Order; later Address edits never rewrite historical Order instructions.
- Cebu City polygon serviceability and delivery-zone resolution.
- Separate versioned global selling (`OPEN|PAUSED`) and fulfillment (`INSTANT|SCHEDULED`) controls. Scheduled cadence starts with configurable `WEEKLY`; Instant does not require a cycle. Mode switches occur only while selling is paused and never rewrite commitments.
- Both modes use Lalamove checkout pricing and FreshMarkets delivery promises. Customers select no courier or hub. Scheduled customers select a window; manual delivery is an emergency Scheduled-only execution fallback, never a quote bypass.
- Instant current-availability policy and expiring checkout inventory holds. Scheduled is exact-demand preorder commerce with cycle/window/cutoff timing and no stock checks/deductions, incoming-stock netting, safety buffers, forecasts, or customer/order/cycle capacity.
- Introductory-trial abuse policy: one trial per application customer, enforced by Promotions grant/redemption history; no payment-method or mandatory SMS/phone prerequisite; residual promotional abuse is accepted at launch.
- Central eligibility requires authenticated enabled Customer access in both modes without membership.
- No FreshMarkets Service Fee or customer-facing PayMongo processing fee in new commerce. Historical committed Orders retain immutable legacy fee snapshots for accounting/refund accuracy.
- One Promotions context with controlled launch order percentage/fixed discount, and delivery fee waiver/discount benefits; closed configurable eligibility rules, grants/redemptions, limits, and deterministic one-order-plus-one-delivery stacking.
- Separate provider-neutral Payments boundary for grocery payments. Development uses PayMongo sandbox; application-accessible mock providers/simulation flows are excluded. Deterministic fakes remain test-only. The PayMongo adapter provides signed event ingestion, canonical state translation, idempotent provider resources, settlement-cost evidence, and reconciliation.
- Explicit Quote/Order monetary components and committed immutable SKU conversion, Promotion, fulfillment mode/location/zone/promise/window/ETA, delivery-instruction, and optional Scheduled-cycle snapshots.
- Committed order creation and additive paid-order amendments under mode-specific eligibility. Scheduled uses cutoff; the normal Instant amendment deadline remains fail-closed until approved.
- Customer Order Detail surface with an authoritative timeline derived from Order/Fulfillment/Delivery state, including amendments, delivery status, and next valid customer actions. Live rider GPS tracking is excluded.
- Reorder/buy-again from a historical Order: currently purchasable items are added to the current ordinary cart under current price, catalog state, serviceability, and availability; unavailable/discontinued items are skipped and clearly reported; historical pricing, inventory, or capacity is never restored; no recurring baskets.
- Customer order-issue intake for at least missing item, wrong item, damaged item, poor-quality produce, quantity discrepancy, delivery issue, and other-with-notes. Issue intake is separate from Refund/Credit authorization, never fabricates a refund, and feeds an admin operational queue.
- Minimal support/contact routing from relevant order and account surfaces.

### Operations

- Location-specific shared Product inventory with Instant holds/reservations, plus separate exact paid Scheduled purchase demand derived from the global mode.
- Exact Scheduled demand aggregation, purchase/receiving records, shortages, rejections, and discrepancy handling without stock/incoming/safety-buffer netting.
- Picking, packing, fulfillment readiness, external-delivery jobs, normalized provider states, delivery events, failure reasons, and retry/reconciliation commands.
- A provider-neutral external-courier boundary with Lalamove v3 and GrabExpress adapters, immutable
  outbound dispatch/idempotency evidence, exact-coordinate and customer-contact delivery payloads,
  one derived bag/box from snapshotted Order weight, and uncertain-outcome reconciliation. FreshMarkets
  collects the customer's delivery fee and separately pays the courier; courier COD and purchase
  service are excluded. Lalamove is the first activation target; production
  booking remains disabled until Cebu service keys, credentials/wallet, sender/Order-weight readiness,
  webhook configuration, and sandbox acceptance are verified. GrabExpress remains disabled until
  Grab enables the required Cebu access and its acceptance gates are satisfied.
- Admin Overview, Customers, Orders, Products, Inventory, Promotions, Payments, Delivery, Analytics, and Staff & Access primary workspaces using purpose-built Core commands/read models. The selector presents Global and Central Cebu for the current release. Global Products owns identity, Categories, media, Sell variants and exact-location price writes; Central Cebu Operations contains Products, Inventory, and external Delivery, with Products focused on read-only exact local retail price, local selling status, and the shared Product inventory pool. No sourcing selector, price fallback, Rider/batch/internal-map navigation, or internal delivery-fee configuration is exposed.
- A light-only clean-room Admin presentation aligned to the approved public Shadcn UI Kit dashboard geometry: a default 72px icon rail with remembered 252px expansion, responsive Sheet navigation, dense list/detail/editor/configuration archetypes, accessible charts, and FreshMarkets orange accents isolated under `.fm-admin`.
- A global `/admin/commerce-configuration` workspace for separate selling-state and fulfillment-mode controls. It never exposes Service Fee configuration, arbitrary history editing, or committed-snapshot mutation.
- Capability-based Application IAM and scoped customer summary/detail, operational queue, and read-only Analytics projections. Named metrics are unavailable until one canonical versioned formula is approved.
- Structured logs, correlation IDs, audit events, idempotency, webhook replay handling, and basic reconciliation.
- Time-driven execution via Cloudflare Cron Triggers dispatching an explicit scheduled-job registry of idempotent Core commands (checkout/payment-hold expiry, provider-inbox/reconciliation redrive, provider-action expiry, cycle cutoff/advancement/closeout, and notification outbox redrive). Active membership/recurring jobs are removed.
- Transactional notification emails backed by a D1 outbox and Cloudflare Queues with idempotent consumers, per-message acknowledgement/retry, bounded retries, dead-letter handling, and scheduled recovery. Notifications never mutate domain truth.
- BIR-compliant invoicing readiness: persistence seams for invoice identifier/serial, issuance timestamp, seller/taxpayer snapshot, taxable/VAT breakdown, immutable relationship to the committed Order/payment, and future external/electronic invoice references. Exact computation and retention rules remain gated on authoritative accounting/tax confirmation before go-live.

## Current Release Exclusions

- Customer-directed substitution engine.
- Variable-weight settlement, post-pick repricing, capture adjustment, or weight-based supplemental charge/refund.
- Customer-selectable hubs.
- Customer reviews/ratings.
- Live GPS/rider tracking.
- FreshMarkets-owned riders, Rider application/assignment, delivery batches, internal route planning, and internal-fleet capacity.
- Customer-initiated post-commitment delivery-window rescheduling; the supported current release route is the legally allowed cancellation path followed by reorder where applicable.
- Full multi-market rollout or multiple live locations, though schemas support them.
- Branch-to-branch transfers and automatic replenishment forecasting. Warehouse-to-site transfers and accepted receipts are included.
- Complex route optimization, map-based fleet routing, and a custom live-driver map.
- Pickup-point operations.
- Arbitrary promotion scripting, unlimited stacking, loyalty points, wallet, dynamic/surge pricing, and a general user-authored rules engine.
- Advanced tax/invoicing and unresolved accounting metric definitions until local/product authority is confirmed.
- Photo/signature/recipient identity proof beyond extensible metadata.
- Durable Object capacity coordinator or Workflow orchestration.
- Separate microservices, event sourcing, separate read database, or public general-purpose REST API.

## Current Release Acceptance Criteria

1. An unauthenticated browser can browse but cannot place an order.
2. A customer can create/verify/login with Better Auth and maintain a secure session through Web/Core boundaries.
3. A new customer without any subscription can complete either mode; active membership/trial/billing surfaces are removed.
4. Core permits both authenticated pay-as-you-go modes and rejects paused selling, unserviceable coordinates, invalid mode/window/cutoff/quote/hold/price, unavailable SKU, promotion conflicts and below-minimum merchandise.
5. A signed provider event maps to a canonical Payments outcome. An outcome sufficient under the configured commitment policy produces exactly one committed Order through an explicit idempotent command, or a visible recoverable finance exception. Browser return state and payment initiation are insufficient.
6. The committed order cannot be rewritten when catalog prices or saved addresses change.
7. Instant items hold/reserve exact-location shared Product inventory; Scheduled items create exact committed sold-unit/base-unit/shipping-gram demand without any inventory effect. No independent or hybrid sourcing selector exists.
8. Scheduled procurement requirements equal exact paid demand and never net stock, incoming supply, safety buffers, forecasts, or capacity.
9. Receiving discrepancies and supply shortages create explicit operational exceptions and auditable resolutions.
10. Fulfillment and external-delivery state machines reject illegal transitions and enforce staff/location scope.
11. Provider events and explicit Delivery commands advance normalized status or enter retry/reconciliation/escalation without an internal Rider workflow or fabricated provider state.
12. Admin read models answer current Instant/Scheduled operational questions without exposing raw persistence rows.
13. FreshMarkets has separate global `OPEN|PAUSED` and `INSTANT|SCHEDULED` authorities. Instant uses current exact-location availability and an expiring hold; Scheduled uses its window/cycle/cutoff with neither stock nor capacity. Mode switching requires selling paused, invalidates uncommitted commerce, and preserves committed snapshots.
14. Unit conversion is controlled and same-dimension; active inventory/demand quantities are integers in `GRAM` or `PIECE`, while historical `MILLILITER` rows remain inactive; sellable sizes and packaging consumption come from persisted SKU configuration.
15. Every quoteable SKU has a manually set positive authoritative exact-location retail price with no fallback. New Quote/Order snapshots preserve merchandise subtotal, item/order discounts, provider-quoted delivery fee/discount, approved tax, and final total, with no Service Fee or customer-facing processing fee. Historical fee snapshots remain immutable.
16. Promotions evaluates only approved benefit/rule types, applies at most one merchandise/order and one delivery benefit deterministically.
17. Admin actions require named capabilities/scopes. Customer/operational views and Analytics are purpose-built derived read models; Analytics cannot mutate source state or publish a named metric without one versioned canonical definition.
18. Delivery instructions applicable at commitment are snapshotted onto the committed Order; later Address edits never rewrite them.
19. No membership enrollment, trial, recurring billing or membership promotion rule is reachable through active UI/Core/jobs.
20. Notification emails are side effects only: a failed notification send never changes a committed domain outcome, and no notification handler mutates domain state.
21. Every sellable product presents a canonical R2-backed primary image (or an explicitly approved placeholder state); no arbitrary external URL acts as the canonical media source.
22. Reorder applies current price, catalog, serviceability, and availability; skipped items are reported; historical pricing, inventory, or capacity is never restored.
23. Order-issue intake records issues with typed categories and status without authorizing a refund; issues are visible in an admin operational queue.
24. Account closure disables authentication access without destroying required order/payment/audit history; data-subject/closure requests carry auditable status.
25. Invoicing seams are additive and immutable: issuance data references exactly one committed Order/payment outcome and can never be rewritten after creation.
26. Cart prices do not lock price or inventory. Before payment, Core resolves replay first and revalidates selling state, exact price, discount, Instant stock/hold or Scheduled window/cutoff, serviceability, provider quotation. A changed total or quotation creates no payment until explicit acceptance.
27. Lalamove prices both modes without customer courier choice. Accepted fees remain immutable; actual courier/manual costs and variance are separate and unavailable until known.
28. Customer grocery-order cancellation is ownership-, version-, and idempotency-guarded. Instant locks at `FULFILLMENT_PENDING`; Scheduled locks at the earlier of cutoff or fulfillment start and coordinates the original payment plus every committed addition. New commerce retains only a documented non-refundable courier cost when allowed, never a Service Fee. FreshMarkets-caused cancellation refunds in full.
29. The basket minimum is enforced authoritatively against pre-discount merchandise only in both Instant and Scheduled checkout. Payment readiness recalculates without creating a replacement Quote, and identical replay returns the original unexpired provider continuation before Quote-state checks.
30. Paid commitment atomically guards accepted-Quote consumption and the appropriate Instant reservation or Scheduled exact-demand write. Refund requests atomically reserve outstanding and successful refund value so concurrent requests cannot exceed captured funds.
31. Customer options require a confirmed serviceable address and current cart; they contain FreshMarkets promise/window with Lalamove quotation, never a hub/courier selector.
32. Customer Order detail exposes immutable commercial/fulfillment history, a safe timeline, current legal actions, typed issues, additive amendments, notification state, and invoice availability without provider, staff-only, or routing-authority leakage.
33. Additions cannot be canceled independently. Existing unrelated refund activity routes normal cancellation to financial review; post-lock staff exception refunds require global `refunds.manage`, a reason, and audit evidence without reopening the customer window. Pre-commit Quote abandonment remains separate.
34. Launch transactional notification intent is durable in D1 and delivered through Cloudflare Queues with idempotent per-message processing, explicit acknowledgement/retry, bounded exhaustion, dead-letter visibility, and scheduled redrive. Email configuration remains a deployment gate.
35. Invoice readiness records exact committed evidence but does not claim official issuance, tax computation, or BIR compliance before the owner-approved accounting policy and serial/retention implementation. The printable customer transaction summary always says `NOT AN OFFICIAL BIR INVOICE`.
36. A fully privileged global Administrator can reach every Admin workspace, every market/location scope, every Admin-safe record, and every legal command. Restricted principals remain capability- and scope-filtered, and denied or unavailable overview sections are never represented as fabricated zero values.
37. Global owns catalog and exact-location price writes with prices.manage. Local staff can read prices and control authorized activation/inventory. R2 publication uses a same-origin adapter backed by Core publication checks.
38. Overlapping eligible geofences choose the closest operational dispatch origin using exact Haversine distance and stable location-ID tie-break. Product stock never reroutes or splits an Order, and delivery providers never choose its owner.
39. Every store owns its pickup profile and authoritative coordinates; every customer delivery requires a phone and exact coordinate, while provider email is optional.
40. Lalamove is default; manual fallback is Scheduled-only after definite old-attempt closure. Booking occurs during authorized preparation; handover requires PACKED. No Rider accounts, fleet, route planning or maps are introduced.

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
- More detailed multi-location readiness and assignment evidence without Scheduled order/cycle capacity.
- Expanded procurement routing; the initial warehouse-to-site transfer workflow is already required by the current release.
- Rich delivery proof and improved dispatch tooling.
- Richer Analytics dimensions, saved filters, and measured read-model projections after canonical metric definitions exist.
- Durable Object escalation only if capacity/dispatch contention warrants it.

## Later

- Additional markets, pickup points, cross-dock and dispatch-only sites.
- Customer substitutions and substitution preferences.
- Variable-weight settlement.
- Provider-supported tracking/proof capabilities after official verification; no FreshMarkets internal fleet.
- Workflows for long-running exception/procurement orchestration.
- Advanced Promotions/experimentation beyond the controlled Current-release benefits and stacking policy.
- Dedicated analytics/data-lake infrastructure.

## Scope Governance

Any proposed product-scope addition must identify the business loop step it completes, its domain/data dependencies, its operational owner, and its failure/reconciliation behavior. “The architecture supports it” is not sufficient justification for adding speculative functionality.

## Commerce Alignment Release Acceptance

The owner-authorized [2026-09-07 completion plan](COMMERCE_ALIGNMENT_E2E_PLAN.md) requires Global location/address/serviceability and staff/customer onboarding, cycle/window creation, product/promotion R2 publication, Global exact-location pricing, central physical stock and tracked destination receipts, exact Scheduled purchasing and cycle goods, preparation-stage booking, Scheduled-only manual fallback, customer follow-up, notifications and recovery. These are current-release requirements, not future suggestions. Phases 0–7 in that plan replace earlier numbering for this work.

Demonstrate setup from a clean test database through reachable UI/Core commands, both customer modes and Scheduled manual fallback. Include authorization bypass attempts, races, replay, rejected-command atomicity, and unknown provider outcomes. Unit tests, fixtures, screenshots and documentation alone are insufficient. Provider sandbox and browser evidence are recorded separately; no deployment, remote reset or live payment/booking is authorized by implementation approval. Accounting and irreversible privacy erasure remain pending factual owner policy.
