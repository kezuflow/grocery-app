# FreshMarkets Domain Model

## Purpose

This document defines business terminology, ownership, relationships, and invariants. It is a domain model, not a table inventory. Persistence guidance is in `DATA_MODEL.md`.

## Organizational and Geographic Model

### Organization

The top-level business entity. MVP has one organization, FreshMarkets, but organization identity remains explicit.

### Market

An operational geography with a currency, timezone, service configuration, and one or more fulfillment locations. MVP market is Metro Cebu, currency PHP, timezone `Asia/Manila`.

### FulfillmentLocation

An internal physical or operational site. It has independent capabilities such as receiving, inventory, procurement, picking, packing, dispatch, and pickup. A site may be a fulfillment center, satellite, cross-dock, dispatch-only site, or pickup point.

Invariant: customers never select a location. The application assigns one from eligible candidates.

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

A configurable operational schedule containing order-open, cutoff, procurement, receiving, packing, dispatch, delivery date/window, zone/location participation, capacity, and lifecycle state. Weekend behavior is configuration, not code.

Capacity is conceptually `DeliveryCycle x DeliveryZone`, with location context. MVP may initially configure the same capacity across zones but cannot collapse the model permanently to cycle-only capacity.

## Identity and Access

### AuthenticationIdentity

Better Auth's user, account, session, and verification records answer who the user is. Better Auth is not a customer, staff, subscription, or permissions domain.

### Customer

A global commerce profile linked to one Better Auth user ID. A customer is not duplicated by market or location. It owns preferences and saved `CustomerAddress` records and participates in subscriptions, carts, and orders.

### CustomerAddress

A customer-owned saved delivery address. Recipient name and phone are address-owned
delivery data, not customer or Better Auth identity fields. Core stores the latest
authoritative serviceability resolution, including service area, delivery zone, and
polygon resolution version. Coordinates are re-evaluated whenever an address update
changes location-relevant fields. Updates use optimistic version checks and never
rewrite historical order snapshots.

A saved delivery destination with recipient, phone, structured components, barangay/city labels, coordinates, delivery notes, geocoder metadata, and most recently resolved service area/zone. Serviceability is revalidated for checkout.

Orders snapshot addresses. Editing a saved address never rewrites an existing order.

### Staff

An application-owned staff principal linked to a Better Auth user ID. Staff capabilities come from role assignments and explicit scopes, not from authentication metadata or a single `isAdmin` flag.

### Role, Permission, and Scope

Roles group capabilities such as catalog pricing, inventory adjustment, procurement approval, packing, dispatch, refund, or audit viewing. Assignments may be global, market-wide, or restricted to selected locations. Authorization evaluates capability plus resource scope.

### Rider

A task-focused operational identity, normally also linked to an authenticated user. A rider may have a preferred/home location but may be assigned across locations. Rider permissions are constrained to assigned jobs and legal delivery transitions.

## Membership

### Subscription

A recurring membership agreement separate from individual orders. A subscription may be `trialing` or `active` and eligible for checkout, or in a non-eligible state such as `past_due`, `paused`, `cancelled`, or `expired`.

The free trial waives only the membership fee. Merchandise and delivery remain payable according to normal rules.

Invariant: authentication alone never permits purchase. Core must resolve the Customer and validate subscription eligibility during checkout commitment.

A subscription is not bound permanently to a fulfillment location. Any future subscription-generated order resolves the current address, serviceability, zone, location, and cycle at generation time.

## Catalog, Units, Availability, and Pricing

### Product

A global catalog concept such as Red Onion or Eggs. Products are not duplicated per location. They contain customer-facing identity, categorization, and descriptive content.

### SKU / SellableVariant

A fixed purchasable variant such as 250 g, 1 kg, 6 pieces, or 12 pieces. A SKU defines:

- sellable label and quantity;
- base inventory unit;
- integer quantity consumed from that base pool;
- availability/status and current price references.

Invariant: variants do not create independent physical inventories. Red Onion 250 g and 1 kg both consume a shared gram-based inventory account.

### BaseInventoryUnit

The smallest integer unit used for physical stock and demand accounting for a product/inventory pool, such as gram or piece. Sellable units may include gram, kilogram, piece, pack, tray, bunch, or bottle, but conversion to inventory consumption is explicit and generic.

MVP supports fixed variants. Arbitrary requested weights and final-weight settlement are later capabilities.

### LocationAvailability

The relationship that declares whether a global SKU/product can be sold/fulfilled at a location and how it is sourced there. It may also hold safety-buffer and operational configuration.

### Price

Current selling price is global/market-based initially, with optional location override support later. Procurement cost, selling price, promotional adjustment, and historical order price are distinct. Orders snapshot all financial values; catalog price changes never rewrite history.

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
- eligible fulfillment location and delivery cycle;
- cutoff and concurrency-safe capacity;
- promotion eligibility/stacking;
- payment readiness.

A quote is time/version-bound and must be revalidated at commitment.

### Order

An immutable commercial and fulfillment commitment created after successful payment. It contains human-readable global order number, customer/market/cycle/zone/location context, monetary totals, and historical snapshots.

`OrderItem` snapshots product/SKU names, sellable unit, quantity, base-unit consumption, sourcing mode, unit price, discount, and total.

Payment success is the customer commitment boundary. A committed order cannot be casually reopened, delete lines, or inherit later catalog/address changes.

### OrderAmendment

An additive transaction linked to a committed order, available only before cycle cutoff under normal customer policy. It has its own item snapshots, payment attempt, demand/reservation effects, and audit history. It may be presented as part of one customer order timeline without rewriting the original transaction.

### Payment and Refund

`Payment`/`PaymentAttempt` represent provider interactions and financial state separately from the Order. A checkout may have multiple attempts; an order may have multiple payments through amendments. Provider-specific behavior sits behind an integration port.

A `Refund` is an explicit financial adjustment with amount, reason, state, provider identity, and links to affected order/payment/lines where applicable. Refunds never erase the original transaction.

### Promotion

An eligibility and price-adjustment policy supporting an intentionally limited MVP subset. The domain can represent fixed/percentage discounts, free delivery, timing, minimum spend, product/category/customer restrictions, codes/automatic application, redemption limits, and stacking modes (`STACKABLE`, `EXCLUSIVE`, `BEST_ELIGIBLE`) without implementing a general rules engine.

## Supply and Inventory

### SourcingMode

- `PLANNED_PROCUREMENT`: paid demand is procured after aggregation.
- `STOCKED_INSTANT`: paid demand reserves existing location stock.
- `HYBRID`: usable stock covers demand first and procurement tops up the remainder.

The mode is resolved for a SKU/location and snapshotted on order lines.

### LocationInventory

The current location-specific physical position for a shared base-unit pool. It tracks on-hand, reserved, usable, and confirmed incoming quantities, guarded by version/concurrency rules. There is no global physical stock quantity.

All mutations create append-only inventory ledger entries. A balance row is a materialized current position, not the only evidence of movement.

### InventoryReservation

A claim on physical stocked inventory created at successful order commitment. Cancellation or approved supply resolution may release it. Cart activity alone creates no permanent reservation.

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

## Audit Event

An immutable operational record containing actor, action, resource, timestamp, correlation ID, reason/metadata, and before/after values where useful. Audit events cover price changes, inventory adjustments, cancellations, refunds, procurement/receiving changes, fulfillment/delivery transitions, subscription modifications, promotion changes, and role/scope changes.

Audit logging is not event sourcing and is distinct from application diagnostics.

## Cross-Domain Invariants

1. Core is authoritative for all business transitions and eligibility.
2. Authentication identity never directly grants business permissions or checkout rights.
3. Customer identity and catalog are global; serviceability, availability, inventory, capacity, fulfillment, and staff scope are location/market-aware.
4. Customers provide an address and delivery choice, not a hub selection.
5. A committed order has one immutable commercial history even when later adjustments/amendments occur.
6. Payment success and cycle cutoff are separate commitment boundaries.
7. Physical reservation and committed procurement demand cannot be represented by the same state/quantity.
8. All quantities used for stock and demand are exact integer base units.
9. All money uses integer minor units and explicit currency.
10. Operational state changes require explicit commands, legal transitions, authorization, idempotency where replayable, and audit where material.
