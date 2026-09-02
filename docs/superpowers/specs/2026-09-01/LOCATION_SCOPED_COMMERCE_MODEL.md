# Location-Scoped Commerce Model

## Status

Approved on 2026-09-01. This design replaces per-location fulfillment-mode selection, configurable sourcing modes, market-price fallback, and priority-based location assignment.

## Objective

FreshMarkets operates in exactly one customer fulfillment mode at a time. The global catalog defines what can be sold; each fulfillment location defines whether a variant is locally offered, its exact price, and the Product inventory available there. Customer location determines the single fulfillment location that owns the entire Order.

## Global Fulfillment Mode

- One global configuration has the active mode `SCHEDULED` or `INSTANT`.
- The modes are mutually exclusive. Locations do not independently select a customer fulfillment mode.
- The launch mode is `SCHEDULED`; a later explicit administrative command may switch the business to `INSTANT`.
- A mode switch affects new and uncommitted commerce only. Committed Orders keep their snapshotted mode, location, cycle/window, promise, prices, and financial evidence.
- Switching invalidates or revalidates open carts and quotes. Switching to Instant is rejected until outstanding Scheduled commitments are protected from sale and active locations satisfy Instant readiness.

## Derived Supply Behavior

There is no administrator-configured sourcing mode.

- Scheduled commerce derives supply from committed demand, delivery cycles, cutoffs, capacity, and procurement planning. Current physical stock is not a customer sellability requirement.
- Instant commerce derives supply from exact-location Product inventory and expiring holds/reservations.
- Historical sourcing snapshots may remain for existing Orders, but sourcing is not an editable catalog or location property.

## Catalog, Variants, Prices, and Inventory

Global Product configuration owns identity, category, media, canonical base dimension/unit, and sellable Variant definitions. Each Variant has a stable internal SKU identity, an active flag, label, sell unit, and integer base-unit consumption.

Location configuration owns:

- the local active flag for each Variant;
- the exact-location positive price for each Variant; and
- the shared Product inventory pool balance at that location.

Prices never fall back from a location to a market or global value. Missing, expired, overlapping, zero, or invalid exact-location price evidence makes the Variant unavailable.

Variants consume from the same Product inventory pool. A 250 g, 500 g, and 750 g Zucchini Variant all decrement the same location-specific Zucchini balance by 250, 500, and 750 grams respectively. Variants never own independent physical stock.

## Customer Visibility and Sellability

A Product is visible at a resolved location when the global Product is active and at least one globally active Variant is locally active.

For Scheduled mode, a Variant is sellable when it is globally active, locally active, has an exact positive location price, and the selected cycle is open before cutoff with capacity. Physical stock is not required.

For Instant mode, a Variant is sellable when it is globally active, locally active, has an exact positive location price, and the shared Product available balance can cover the Variant's integer base-unit consumption.

- A locally inactive Variant is hidden.
- An active Instant Variant with insufficient balance remains visible as `Out of stock`.
- A Product with locally active Variants that are all out of stock remains visible as out of stock.
- A Product with no locally active Variants is hidden.

## Location Resolution

The customer supplies a delivery coordinate through a confirmed address. Core validates the coordinate and serviceability polygons, then produces all operationally eligible fulfillment locations whose assigned geofence contains the coordinate.

Candidates must be active, open, capable of picking/packing/dispatching, ready for the current global mode, and within applicable capacity. Product or Variant stock never changes candidate ordering and never causes an Order to route to a farther location.

Core ranks eligible candidates by exact Haversine great-circle distance from the customer coordinate to each location's dispatch-origin coordinate. The smallest distance wins; equal distances use stable ascending location ID. Mapbox driving-time or route APIs are not called for ownership assignment.

Mapbox remains appropriate for address search, geocoding, map presentation, and geofence authoring. A separate delivery-fee estimate or a later Grab route may use routing data, but neither may change the owning location.

One Order is owned by one location and is never split. Address changes re-resolve the entire cart, then reprice and revalidate it. Quote and Order snapshots lock the chosen location. A committed Order never silently reroutes.

## Administration

Global scope exposes Product, category, media, and Variant definition only. It must not expose price, price readiness, selling status, stock, resolved price, pricing context, or catalog-reference labels.

Location scope exposes the exact location price, local Variant active flag, shared Product inventory, and resulting availability. It does not expose sourcing controls. The fulfillment-mode setting is global and is visible only in Global scope; local operational readiness remains location-specific.

## Data and Concurrency Rules

- Authoritative quantities are integer `GRAM`, `MILLILITER`, or `PIECE` base units.
- Prices are integer minor units with one exact location target.
- Local availability changes, price changes, inventory mutations, and the global mode switch use expected versions where concurrent mutation is possible.
- Mode activation, price changes, availability changes, and inventory changes emit immutable audit evidence.
- Customer-facing read models contain purpose-built availability reasons and never expose raw persistence rows.

## Transition Rules

The migration backfills a market-level active price to each active location in that market only when an exact location price does not already exist. Exact prices win. After migration, new market-only prices are forbidden.

Legacy sourcing columns may survive temporarily only as non-authoritative compatibility data where destructive table reconstruction would endanger historical foreign keys. Runtime commands, queries, contracts, and UI must stop reading or writing them.

## Acceptance Criteria

- One global mode drives every new checkout.
- Global Product administration contains no local commerce facts.
- Location Product administration has exact price, local activation, and shared Product stock.
- Customer catalog and checkout never use a market/global price fallback.
- Overlapping geofences deterministically choose the closest operational location using Haversine distance.
- Instant out-of-stock behavior does not reroute or hide an otherwise locally offered Product.
- Scheduled sellability does not require current stock.
- Existing committed Orders retain their snapshots through a global mode switch.
