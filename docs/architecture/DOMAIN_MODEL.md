# FreshMarkets Domain Model

## Purpose

This document is authoritative for business terminology, relationships, and invariants. Bounded-context ownership is authoritative in `ARCHITECTURE.md`, lifecycle transitions in `STATE_MACHINES.md`, and persistence guidance in `DATA_MODEL.md`. This is a domain model, not a table inventory.

## Organizational and Geographic Model

### Organization

The top-level business entity. MVP has one organization, FreshMarkets, but organization identity remains explicit.

### Market

An operational geography with a currency, timezone, service configuration, and one or more fulfillment locations. MVP market is Metro Cebu, currency PHP, timezone `Asia/Manila`.

### FulfillmentLocation

An internal physical or operational site. It has independent capabilities such as receiving, inventory, procurement, picking, packing, dispatch, and pickup. A site may be a fulfillment center, satellite, cross-dock, dispatch-only site, or pickup point.

Invariant: customers never select a location. The application assigns one from eligible candidates.

Each active fulfillment location has exactly one effective `FulfillmentMode` configuration:

- `INSTANT` — current location inventory and an expiring checkout hold back the customer promise; normal replenishment procurement is outside the checkout path.
- `SCHEDULED` — a configured offering/window and optional cadence drive capacity, cutoff, planned demand, procurement, receiving, and scheduled delivery. MVP Scheduled cadence is `WEEKLY`.

`WEEKLY` is a cadence/configuration value, never a fundamental fulfillment mode. Mode configuration is versioned/effective-dated so a location may switch modes without mutating the fulfillment decision snapshotted on committed Orders. Market-level configuration may supply defaults or offering policy, but the resolved fulfillment location has one unambiguous active mode at checkout.

### ServiceArea and DeliveryZone

A `ServiceArea` is a versioned geographic polygon that establishes whether coordinates are serviceable. A `DeliveryZone` is a polygon/subdivision within a service area used for fees, capacity, batching, and operational assignment.

Serviceability and assignment are separate:

1. Coordinates must fall in an active service area.
2. Coordinates resolve to an active zone.
3. The system evaluates locations capable of serving that zone.
4. Assignment selects an eligible location/cycle based on operational rules.

Text fields such as city or barangay are descriptive and never authoritative geofence proof.

Coordinates used for a saved address must come from a provider candidate or user-positioned pin and record an explicit user confirmation time. A geocoder suggests coordinates; Core polygon evaluation remains authoritative. Polygon versions are returned with resolution so callers can detect and refresh stale geography.

### DeliveryCycle

A configurable `SCHEDULED` operational schedule containing cadence, order-open, cutoff, procurement, receiving, packing, dispatch, delivery date/window, zone/location participation, capacity, and lifecycle state. Weekend and `WEEKLY` behavior are configuration, not code. `INSTANT` fulfillment does not require or fabricate a DeliveryCycle.

Capacity is conceptually `DeliveryCycle x DeliveryZone`, with location context. MVP may initially configure the same capacity across zones but cannot collapse the model permanently to cycle-only capacity.

## Identity and Access

### AuthenticationIdentity

Better Auth's authentication users, credentials/linked accounts, sessions, email verification, password reset, OAuth, and configured authentication infrastructure answer who the user is. Better Auth is not a customer, staff, authorization, membership, promotion, payment, order, or operations domain.

### Customer

A global commerce profile linked to one Better Auth user ID. A customer is not duplicated by market or location. It owns preferences and saved `CustomerAddress` records and participates in subscriptions, carts, and orders.

### CustomerAddress

A customer-owned saved delivery address. Recipient name and phone are address-owned
delivery data, not customer or Better Auth identity fields. Core stores the latest
authoritative serviceability resolution, including service area, delivery zone, and
polygon resolution version, the resolver's serviceable outcome, and its existing
failure reason when unserviceable. Legacy rows without a persisted outcome remain
explicitly unresolved and are never inferred from area/zone codes. Coordinates are re-evaluated whenever an address update
changes location-relevant fields. Updates use optimistic version checks and never
rewrite historical order snapshots.

A saved delivery destination with recipient, phone, structured components, barangay/city labels, coordinates, delivery notes, geocoder metadata, and most recently resolved service area/zone. Serviceability is revalidated for checkout.

Orders snapshot addresses. Editing a saved address never rewrites an existing order.

### Staff

An application-owned staff principal linked to a Better Auth user ID. Staff capabilities come from role assignments and explicit scopes, not from authentication metadata or a single `isAdmin` flag.

### Role, Permission, and Scope

Roles group closed application capabilities such as `customers.read`, `customers.manage`, `orders.read`, `orders.manage`, `catalog.read`, `catalog.manage`, `inventory.read`, `inventory.adjust`, `promotions.read`, `promotions.manage`, `memberships.read`, `memberships.manage`, `payments.read`, `refunds.manage`, `fulfillment.read`, `fulfillment.manage`, `delivery.read`, `delivery.manage`, `procurement.read`, `procurement.manage`, `analytics.read`, `staff.read`, and `staff.manage`. Assignments may be global, market-wide, or restricted to selected locations. Roles are configurable collections of capabilities; names such as `SUPER_ADMIN`, `OPERATIONS`, `CUSTOMER_SUPPORT`, `MARKETING`, and `FINANCE` are examples, not hard-coded authorization logic. Authorization evaluates capability plus resource scope and never a single `isAdmin` flag.

### Rider

A task-focused operational identity, normally also linked to an authenticated user. A rider may have a preferred/home location but may be assigned across locations. Rider permissions are constrained to assigned jobs and legal delivery transitions.

## Membership

### MembershipOffer

The current commercial membership is a single paid offer priced at PHP 299.00 (`29900` minor units) per calendar billing month. An offer defines the recurring membership fee and billing interval; it does not embed trial entitlement. A free trial is not a separate zero-price plan and is never inferred from an offer field such as `trial_days`.

### Subscription

A recurring membership agreement separate from individual orders. Its canonical states are `PENDING`, `TRIALING`, `ACTIVE`, `PAST_DUE`, `PAUSED`, `CANCELED`, and `EXPIRED`; `STATE_MACHINES.md` is authoritative for legal transitions. Only `TRIALING`, `ACTIVE`, and `PAST_DUE` inside its grace window may be checkout-eligible, and effective timestamps still apply.

`CANCELED` and `EXPIRED` are distinct terminal states. `CANCELED` records intentional termination by a customer, staff member, policy, or an effective scheduled cancellation. `EXPIRED` records entitlement that naturally ended without continuation. Cancel-at-period-end is intent metadata (`cancelAtPeriodEnd`, `scheduledCancellationAt`/`endsAt`) while the subscription remains in its currently entitled state; an explicit time-driven command transitions it to `CANCELED` at the effective instant.

The introductory free trial is a Promotions-owned grant over the paid membership. It waives only the membership fee for exactly one calendar billing month; merchandise and delivery remain payable according to normal rules. Membership may enter `TRIALING` only after consuming a valid promotion grant/redemption, and only when a recurring-capable payment authorization already exists. Establishing that authorization is not payment success; Core never synthesizes a zero-value payment for the trial, and the first paid charge becomes due at `trialEndsAt`.

Renewal, trial conversion, and dunning are Membership lifecycle behavior driven by canonical Payments outcomes. Paid renewal requires a provider-confirmed canonical `SUCCEEDED` result; a failed renewal moves the subscription to `PAST_DUE`, which carries a 7-calendar-day grace window during which entitlement remains usable. Verified successful recovery returns the subscription to `ACTIVE`; grace exhaustion without verified success transitions `PAST_DUE -> EXPIRED`; customer cancellation while `PAST_DUE` transitions immediately to terminal `CANCELED` and terminates future renewal attempts. Retry ownership prefers provider-native recurring/retry behavior; where the application must drive attempts, approximately +1/+3/+6-day retries inside the grace window are the approved default, finalized by the provider integration specification. Calendar-month subscription semantics and the nominal billing anchor are preserved across short-month clamping.

Introductory-trial abuse policy: one introductory trial per application customer; the recurring-capable authorization precondition above; and, where the provider exposes a stable authorization/payment-instrument identity, prevention of repeated introductory grants against the same identity. Address/device/risk signals may support review or risk scoring but are not undocumented identity rules, and SMS/phone verification is not mandatory for trial abuse prevention. Some residual promotional abuse is accepted rather than building a fraud platform before launch.

Calendar-month calculation uses the Market's configured business timezone. Core converts the activation instant to that timezone, adds one calendar month while preserving local wall-clock time, clamps a day that does not exist in the target month to that month's final valid day, then persists `trialStartsAt` and `trialEndsAt` as UTC instants. For the MVP market this timezone is `Asia/Manila`. A fixed 14-day or 30-day duration is not equivalent.

Invariant: authentication alone never permits purchase. Core must resolve the Customer and validate subscription eligibility during checkout commitment.

Paid activation requires a provider-confirmed canonical Payments outcome sufficient under the configured payment commitment policy. Payment initiation, a browser return, or a vendor status copied directly into Membership cannot activate a paid subscription. For MVP, a provider's captured/success outcome maps through its adapter to canonical Payments `SUCCEEDED`, after which an explicit idempotent Membership command may transition the subscription.

A subscription is not bound permanently to a fulfillment location. Any future subscription-generated order resolves the current address, serviceability, zone, location, and cycle at generation time.

## Catalog, Units, Availability, and Pricing

### Product

A global catalog concept such as Red Onion or Eggs. Products are not duplicated per location. They contain customer-facing identity, categorization, and descriptive content.

### SKU / SellableVariant

A database-configurable fixed purchasable variant such as 250 g, 1 kg, 6 pieces, or 12 pieces. Sizes are operational data managed through Catalog commands and never hard-coded application branches. A SKU defines:

- product and stable SKU identity;
- display/packaging label, integer sell quantity, and controlled sell unit;
- authoritative integer quantity consumed from the Product's base inventory pool;
- active/inactive state and sort/display order;
- location availability and market/location price references.

Invariant: variants do not create independent physical inventories. Red Onion 250 g and 1 kg both consume a shared gram-based inventory account.

### BaseInventoryUnit

The canonical integer unit used for physical stock and demand accounting for a Product/inventory pool. MVP base units are `GRAM` (`MASS`), `MILLILITER` (`VOLUME`), and `PIECE` (`COUNT`). Authoritative balances never use floating-point quantities.

Catalog owns a controlled, data-driven unit registry. A unit has identifier, code, display name, dimension, exact conversion to its dimension's canonical base unit, and active status. Initial controlled sell-unit codes include `G`, `KG`, `ML`, `L`, and `PC`. Conversions use exact integer/rational factors and may occur only within the same dimension; kilograms convert to grams, liters to milliliters, and pieces remain count-based.

Packaging words such as pack, bunch, tray, head, or bottle are SKU-specific merchandising labels, not global units with universal conversion. A 12-piece egg tray records `12 PIECE` consumption on that SKU; another Product's pack may consume a different base quantity. The persisted SKU conversion is the authority used by Cart, Inventory, Quote, and Order snapshots.

MVP supports fixed variants only. Variable-weight settlement, post-pick repricing, capture adjustment, and weight-driven supplemental charge/refund flows are explicitly out of scope.

### LocationAvailability

The relationship that declares whether a global SKU can be sold at a location under the currently resolved FulfillmentMode and how its inventory is sourced there. It may also hold safety-buffer and operational configuration. `INSTANT` presentation is sellable only when the approved current-availability policy can fulfill the SKU's exact base-unit consumption; ordinary replenishment is not inserted into checkout to manufacture availability.

### Price

Authoritative selling price belongs to the sellable SKU and applicable market/location price context, never merely to Product. Resolution uses a versioned active location price when configured and the applicable market price otherwise. A missing, overlapping, invalid-currency, or nonpositive authoritative price makes the SKU unquoteable; price never silently becomes zero. Procurement cost, selling price, promotional adjustment, and historical Order price are distinct. Quotes and Orders snapshot all financial values; catalog price changes never rewrite history.

## Cart, Checkout, and Commerce Commitment

### Cart

An editable pre-commit basket associated with a customer/market. Cart contents are advisory demand only: they do not permanently reserve physical inventory or delivery capacity.

### Checkout

An application orchestration, not a database entity exposed to UI. The authoritative eligibility service validates:

- authenticated Customer;
- eligible subscription;
- cart and current SKU availability;
- current pricing and minimum merchandise amount;
- address coordinates and active service area/zone;
- eligible fulfillment location, its single active `INSTANT`/`SCHEDULED` mode, and a mode-specific delivery promise;
- for `INSTANT`, current exact base-unit availability and an expiring checkout inventory hold;
- for `SCHEDULED`, an eligible cycle/window, cutoff, concurrency-safe capacity, and demand/procurement policy;
- promotion eligibility/stacking;
- payment readiness.

A quote is time/version-bound and must be revalidated at commitment. Its financial breakdown keeps merchandise subtotal, item discount, order discount, delivery fee, delivery discount, service fee where applicable, tax where applicable, and final total as distinct integer-minor-unit components.

### Order

An immutable commercial and fulfillment commitment created after a provider-confirmed canonical Payments outcome satisfies the configured commitment policy and the explicit idempotent Order command completes. It contains human-readable global order number, customer/market/cycle/zone/location context, monetary totals, and historical snapshots.

Every Order snapshots the resolved `fulfillmentMode`, fulfillment location, service area/zone, delivery promise, delivery window, ETA/promised time where applicable, and the cycle/schedule identifiers required only by `SCHEDULED`. Later configuration changes cannot alter those semantics.

`OrderItem` snapshots product/SKU names, sellable label/unit/quantity, exact base-unit consumption, sourcing mode, unit price, item/order discount allocation, and total. The Order also snapshots applied Promotion/redemption identities and the same explicit monetary components as its Quote.

The sufficient canonical Payments outcome is the customer commitment boundary. A committed order cannot be casually reopened, delete lines, or inherit later catalog/address changes.

### OrderAmendment

An additive transaction linked to a committed order, available only before cycle cutoff under normal customer policy. It has its own item snapshots, payment attempt, demand/reservation effects, and audit history. It may be presented as part of one customer order timeline without rewriting the original transaction.

### Payment and Refund

Payments is a bounded context separate from Membership and Orders. `PaymentIntent`/`PaymentAttempt` represent provider-neutral purpose, amount, attempts, and canonical financial state. A membership enrollment, checkout, amendment, or refund may have its own payment purpose and stable application reference; an order may have multiple payments through amendments. Provider customers, methods, references, payloads, and status mappings live behind Payments-owned integration ports.

A provider adapter translates vendor states into canonical Payments states. The configured payment commitment policy decides which canonical outcome is sufficient for a paid commitment; MVP treats canonical `SUCCEEDED` as captured commercial success. Membership and Orders react to that outcome through explicit idempotent application commands rather than sharing or mutating Payments state.

A `Refund` is an explicit financial adjustment with amount, reason, state, provider identity, and links to affected order/payment/lines where applicable. Refunds never erase the original transaction.

### Promotion

An eligibility and benefit policy supporting a closed application vocabulary with database-configurable parameters. Promotions is one bounded context for membership fee waivers, order discounts, and delivery discounts; it owns definitions, status/effective time, eligibility, grants, redemptions, limits, deterministic selection, and stacking. It never executes user-authored JavaScript, SQL, expressions, or a general scripting/rules engine.

MVP benefit types are:

- `MEMBERSHIP_FEE_WAIVER`;
- `ORDER_PERCENT_DISCOUNT`;
- `ORDER_FIXED_DISCOUNT`;
- `DELIVERY_FEE_WAIVER`;
- `DELIVERY_FEE_DISCOUNT`.

Controlled eligibility rule types include `FIRST_ORDER`, `NEW_CUSTOMER`, `MEMBER`, `NON_MEMBER`, `MINIMUM_SUBTOTAL`, `CUSTOMER_SEGMENT`, and `SPECIFIC_CUSTOMERS`. Parameters may configure code, status, effective window, amount/percentage, minimum subtotal, maximum discount, customer target/segment, global limit, and per-customer limit. Core validates each benefit/rule parameter schema; unknown types fail closed.

For an Order, at most one merchandise/order benefit and one delivery benefit may apply. A valid explicitly selected code/campaign wins its price component over automatically selected candidates; otherwise the highest-value eligible benefit for that component wins, with stable promotion ID as the final deterministic tie-breaker. Two merchandise/order discounts or two delivery discounts never stack. Membership-fee benefits are evaluated separately from Order/delivery stacking.

Order percentage/fixed benefits apply only to the approved merchandise subtotal basis. Delivery waiver/discount benefits modify only delivery fee. No benefit silently discounts delivery, service fee, or tax unless its controlled type explicitly owns that component.

`FIRST_MONTH_FREE` is a `MEMBERSHIP_FEE_WAIVER` for one `CALENDAR_MONTH`. A valid grant/redemption remains the sole authority that allows Membership to enter `TRIALING`; generalized Promotions does not change Membership states, fee, timing, or Payments ownership.

## Supply and Inventory

### SourcingMode

- `STOCKED`: demand is fulfilled from existing location stock.
- `PLANNED`: paid demand enters planned procurement/replenishment aggregation.
- `ON_DEMAND`: supply is acquired for a specific committed demand through a configured operational path rather than assumed available.
- `MIXED`: usable stock covers an exact portion and another configured sourcing path covers the remainder.

Sourcing answers how inventory is obtained; FulfillmentMode answers when/how the customer receives it. The two vocabularies are independent and the resolved combination is snapshotted. `INSTANT + STOCKED` and `SCHEDULED + PLANNED` are valid examples, not the only structurally representable combinations. A configured combination is eligible only when its owning policies can actually fulfill it; MVP does not infer an unimplemented `ON_DEMAND` path.

### LocationInventory

The current location-specific physical position for a shared base-unit pool. It tracks on-hand, reserved, usable, and confirmed incoming quantities, guarded by version/concurrency rules. There is no global physical stock quantity.

All mutations create append-only inventory ledger entries. A balance row is a materialized current position, not the only evidence of movement.

### InventoryReservation

A claim on physical stocked inventory created at successful order commitment. Cancellation or approved supply resolution may release it. Cart activity alone creates no permanent reservation.

### InventoryHold

A short-lived claim created for an `INSTANT` checkout attempt before Quote/payment so current stock is not promised twice. Cart activity alone creates no hold. Creation, expiry, release, and conversion into the committed Order reservation are idempotent and concurrency-safe. A hold never becomes a paid Order and its expiry never mutates historical commitments.

### CommittedProcurementDemand

Paid planned demand expressed in base units for a cycle, location, SKU/inventory pool, order, and line. It is not physical inventory and not an inventory reservation. Cancellation treatment depends on cutoff and procurement state.

### Procurement

A cycle/destination operational aggregate that converts committed demand into procurement requirements:

```text
committed demand
+ safety buffer
- usable physical inventory
- confirmed incoming inventory
= procurement requirement
```

The model supports central or local procurement and destination locations without requiring both in MVP.

### Receiving

The controlled recording of purchased goods received, rejected, or short. Receiving updates inventory only through explicit, auditable movements. Expected, received, and rejected quantities remain distinguishable.

### OperationalException

A shortage, partial supplier fill, quality rejection, receiving discrepancy, unexpected unavailability, fulfillment shortage, or delivery failure requiring resolution. Allowed resolutions are domain-specific and may include alternate sourcing, operator-approved replacement, affected-line cancellation, retry/reschedule, partial refund, refund, or escalation.

MVP does not include a customer-directed substitution engine.

## Fulfillment and Delivery

### Fulfillment

The location-scoped process that turns a committed order into picked, packed, ready goods. It owns picking/packing state and fulfillment exceptions, not financial truth.

### DeliveryJob, DeliveryBatch, and DeliveryStop

- `DeliveryJob` represents the delivery work created for an order.
- `DeliveryStop` snapshots the destination, contact, instructions, sequence, events, and result.
- `DeliveryBatch` groups jobs/stops for dispatch and rider assignment.

Route execution is not encoded by mutating raw order rows. Delivery events advance the delivery state machine and may cause order projections to change.

MVP proof is delivered timestamp, rider, and delivery event. Photo, recipient identity, and signature are future metadata.

## Admin and Analytics Read Side

### AdminApplication

Admin is a first-class application surface over purpose-built Core commands and read models, not a bounded context that owns business state and not a raw CRUD console. Its sections are Overview, Customers, Orders, Catalog, Inventory, Promotions, Memberships, Payments, Fulfillment, Delivery, Procurement, Analytics, and Staff & Access. Every action is authorized by Application IAM capability plus market/location scope.

`AdminCustomerSummary` composes the Customer-owned profile fields permitted for staff with location, committed-order count, last order, lifetime spend, average order value, Membership/trial state, and creation date. `AdminCustomerDetail` may compose addresses, Orders, Membership, Promotion grants/redemptions, Payments summaries, delivery history, support-visible events, and audit history. These are read models over their authoritative contexts; Admin and Analytics never become Customer owners, and Better Auth rows are never used as the Customer database.

Operational read models answer immediate-action questions such as orders waiting/picking/packing/out for delivery, late orders, failed payments, refund attention, shortages, receiving exceptions, rider assignments, and fulfillment exceptions. They expose legal `allowedActions` derived in Core, not arbitrary status setters.

### Analytics and MetricDefinition

Analytics is a derived read-side concern inside the Core modular monolith for MVP. It may aggregate, calculate, project, summarize, and serve dashboards from Customers, Orders, Payments, Membership, Promotions, Inventory, Fulfillment, and Delivery. It owns no source lifecycle, eligibility, balance, or identity state. Rebuildable projections may improve read performance but cannot become mutation authority.

Every published metric name has exactly one versioned `MetricDefinition` containing formula, source records/events, event-time field, reporting timezone, dimensions, inclusion/exclusion rules, and rounding/empty-denominator behavior. A metric without an approved definition is unavailable rather than calculated differently by separate dashboards.

The initial metric catalog is:

| Metric | Canonical formula or required status |
|---|---|
| Order count | Count Orders whose first successful commitment instant is in the reporting window; amendments are not additional Orders. |
| Refund amount | Sum canonical `SUCCEEDED` Refund amount by refund-success instant and currency in the reporting window. |
| New customers | Count Customer aggregates created in the reporting window. |
| Active customers | Count distinct Customers with at least one first Order commitment instant in the reporting window. |
| Repeat customer rate | Active Customers who had a committed Order before their first in-window commitment divided by Active Customers; empty denominator returns null. |
| Orders per customer | Order count divided by Active Customers; empty denominator returns null. |
| Active members / trialing members | Point-in-time count of effective `ACTIVE` / `TRIALING` subscriptions after timestamp eligibility rules. |
| Promotion redemptions | Count Promotion redemption records by `redeemedAt`, grouped by benefit type/promotion as requested. |
| Discount spend | Sum snapshotted applied benefit amounts by merchandise, delivery, and membership-fee components; components and currencies are never silently combined. |
| Promotion-influenced Order revenue | Sum committed Order `finalTotalMinor` for Orders with at least one Order/delivery Promotion redemption; this is influence labeling, not causal attribution. |
| Fulfillment time | `fulfillmentCompletedAt - committedAt` for completed fulfillments. |
| Picking time | `pickingCompletedAt - pickingStartedAt` where both events exist. |
| Packing time | `packedAt - packingStartedAt` where both events exist. |
| Delivery time | `deliveredAt - dispatchedAt` for delivered jobs. |
| Late-delivery rate | Delivered jobs after their snapshotted promised time plus unresolved jobs past that promise, divided by jobs whose promise elapsed in the window. |
| Cancellation rate | Orders first committed in the window that later reach `CANCELED`, divided by Order count for the same commitment cohort. |
| Out-of-stock rate | Availability evaluations that reject an active SKU for insufficient usable location stock divided by evaluated active-SKU availability checks; instrumentation/version is part of the definition. |
| Stockouts | Count location inventory-pool transitions from usable quantity above zero to zero, deduplicated by ledger transition. |
| Inventory adjustments/shrinkage | Sum signed base-unit adjustment ledger movements, grouped by Product base unit, location, and reason; unlike dimensions are never summed. |

The following names are required but blocked from publication until the named authority is approved: GMV, revenue/net sales, AOV, and refund rate require an accounting definition of gross/net components, cancellations, refunds, fees, tax, and event-time recognition; trial-to-paid conversion requires a cohort and conversion-window definition; MRR and churn additionally depend on renewal, grace/dunning, fee-waiver, and effective-cancellation policy; Promotion redemption rate needs an approved denominator; substitution rate remains unavailable while substitutions are out of scope. Inventory turnover is deferred until its cost/period basis is approved.

## Audit Event

An immutable operational record containing actor, action, resource, timestamp, correlation ID, reason/metadata, and before/after values where useful. Audit events cover price changes, inventory adjustments, cancellations, refunds, procurement/receiving changes, fulfillment/delivery transitions, subscription modifications, promotion changes, and role/scope changes.

Audit logging is not event sourcing and is distinct from application diagnostics.

## Cross-Domain Invariants

1. Core is authoritative for all business transitions and eligibility.
2. Authentication identity never directly grants business permissions or checkout rights.
3. Customer identity and catalog are global; serviceability, fulfillment mode, availability, SKU price, inventory, capacity, fulfillment, and staff scope are location/market-aware.
4. Customers provide an address and delivery choice, not a hub selection.
5. A committed order has one immutable commercial history even when later adjustments/amendments occur.
6. A canonical Payments outcome sufficient under the configured payment commitment policy and cycle cutoff are separate commitment boundaries.
7. Fulfillment mode (`INSTANT`/`SCHEDULED`) and sourcing mode (`STOCKED`/`PLANNED`/`ON_DEMAND`/`MIXED`) answer different questions and cannot be represented by one field.
8. A temporary Instant checkout hold, committed physical reservation, and planned procurement demand cannot be represented by the same state/quantity.
9. All quantities used for stock and demand are exact integer `GRAM`, `MILLILITER`, or `PIECE` base units; SKU-specific consumption is immutable in committed snapshots.
10. All money uses integer minor units, explicit currency, and auditable component breakdowns.
11. Operational state changes require explicit commands, legal transitions, authorization, idempotency where replayable, and audit where material.
12. Client/application/admin lifecycle commands use stable idempotency and expected aggregate versions where concurrent mutation is possible; provider events use unique provider-event identity and handler-side conditional updates instead of supplied versions.
13. Admin and Analytics are read/application surfaces; neither owns or directly mutates source-context state.
