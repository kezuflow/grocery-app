# Commerce and External Delivery Realignment Implementation Plan

## Status

Approved product and architecture plan as of 2026-09-05. This document authorizes planning and
sequencing only. Runtime, contract, schema, and UI implementation must be performed in the bounded
phases below and must update the complete canonical document set before the corresponding code is
treated as authoritative.

This plan supersedes every conflicting active assumption about:

- a FreshMarkets Service Fee;
- Scheduled order or cycle capacity;
- Scheduled stock, incoming-stock, or safety-buffer calculations;
- customer selection of a courier during Scheduled checkout;
- FreshMarkets-owned riders, batches, or internal fleet execution;
- internally calculated customer delivery fees when a courier quotation is available; and
- application-accessible mock payment flows.

Historical migrations, committed Order snapshots, audit evidence, and old implementation-plan
records remain historical facts. They do not remain active business authority.

## Goal

Align FreshMarkets around two deliberately different commerce models while preserving one paid
Order spine:

```text
Global selling OPEN
  -> one global mode: INSTANT or SCHEDULED
  -> exact store + SKU retail price
  -> provider-priced delivery
  -> PayMongo customer payment
  -> immutable Order
  -> store fulfillment
  -> external courier delivery
```

`INSTANT` sells from physical store inventory and lets the customer choose an enabled external
delivery partner. `SCHEDULED` is preorder commerce: FreshMarkets accepts paid demand before cutoff,
buys exactly what customers ordered, packs it, and lets store operations choose the external
courier execution. FreshMarkets has no internal delivery fleet in the active product.

## Approved Decisions

### 1. Global commerce controls

FreshMarkets has two separate global controls:

1. `sellingState`: `OPEN` or `PAUSED`;
2. `fulfillmentMode`: `INSTANT` or `SCHEDULED`.

`PAUSED` blocks new fulfillment options, Quotes, and payment initiation. It does not block browsing,
an already-started payment from being reconciled and committed exactly once, customer Order reads,
fulfillment of committed Orders, refunds, or delivery operations. This distinction prevents a
selling pause from orphaning money that the payment provider already accepted.

The operating procedure for a mode switch is:

1. pause selling;
2. allow or explicitly resolve work committed under the current mode;
3. activate the new global mode with an expected version;
4. verify mode-specific readiness at every active store location;
5. reopen selling.

A mode switch never mutates a committed Order's mode, promise, price, or delivery evidence.

### 2. Exact retail pricing and margin

The authorized selling price is set manually for each exact `FulfillmentLocation x SKU`. There is
no global or Market fallback, and there is no automatic global markup rule in this plan. Admin users
enter the final customer-facing retail price for each SKU at each store. This is where FreshMarkets
places its merchandise margin, including the desired large markup.

Procurement cost, retail price, discount, provider delivery cost, PayMongo processing cost, and net
settlement remain separate financial facts. A later purchase-cost change never reprices an accepted
and paid Scheduled Order.

### 3. Customer price breakdown

FreshMarkets removes the Service Fee from all new commerce, including Instant. The customer total
is:

```text
merchandise at exact store/SKU retail prices
- merchandise/order promotion
+ quoted delivery fee
- delivery promotion
+ approved tax, when an accounting policy exists
= customer total
```

PayMongo processing fees are absorbed by FreshMarkets and are never shown as a customer charge.
Provider settlement evidence records gross, processing cost, adjustments, and net internally.

New Quotes, Orders, receipts, customer pages, and Admin commerce configuration contain no active
FreshMarkets Service Fee. Transitional physical fields may remain zero/null while historical
committed Orders retain their original Service Fee snapshots for accounting and refund accuracy.

### 4. Instant commerce

Instant commerce:

- requires authentication but not membership;
- resolves the customer's confirmed address to one store location;
- requires globally active Product/SKU, active store selling status, and an exact positive store/SKU
  price;
- validates physical on-hand inventory and creates an expiring checkout hold;
- lists enabled and currently quoteable external delivery partners after location resolution;
- lets the customer choose one opaque courier offer, such as Lalamove or GrabExpress;
- re-quotes before payment and requires explicit acceptance if the price changes; and
- snapshots the chosen provider, service, provider quotation, delivery fee, store, promise, and
  inventory evidence into the paid Order.

Core never silently substitutes a different Instant courier after the customer accepts one. A
provider that becomes unavailable produces an explicit recovery or re-selection flow.

### 5. Scheduled preorder commerce

Scheduled commerce:

- requires an eligible membership under the existing membership policy;
- offers an open delivery window before its cutoff;
- has no customer-count, order-count, zone, seat, or cycle capacity;
- does not check, reserve, decrement, or net against physical inventory;
- does not use incoming stock, safety allowance, minimum stock, forecasting, or hybrid sourcing;
- requires only active Product/SKU/store selling status and an exact positive store/SKU price;
- records each paid line's exact sold-unit quantity, base-unit quantity, and shipping grams;
- aggregates committed paid demand into the exact purchase list;
- lets operations buy those quantities, pack them on the purchase day, and dispatch them; and
- retains cutoff and cycle/window lifecycle because those are operational boundaries, not capacity.

For example, an Order line of 100 chili-pepper packs where one pack is configured as 50 grams
records 100 sold units and 5,000 grams of committed purchase demand. No stock balance is read or
reduced.

Product quantity still matters in Scheduled mode for customer totals, procurement quantity,
packing, shipping weight, and immutable history. It simply does not represent store stock.

### 6. External couriers only

FreshMarkets removes active internal fleet delivery completely:

- no Rider customer-delivery application;
- no Rider assignment or internal delivery batches;
- no `INTERNAL_FLEET`/`STORE_FLEET` execution choice;
- no internal route planning or live driver map; and
- no internal fleet capacity affecting checkout.

Legacy tables and snapshots are preserved long enough to migrate or read historical data safely,
but active contracts, commands, navigation, and readiness do not expose internal delivery.

### 7. Scheduled delivery pricing and later dispatch choice

During Scheduled checkout, the customer chooses the FreshMarkets delivery window, not a courier.
Core requests a real future Lalamove quotation using `scheduleAt` and the store/customer coordinates.
The returned amount becomes the delivery-fee component charged through FreshMarkets' PayMongo
payment on checkout day.

Lalamove is the initial default Scheduled quotation provider. A Scheduled quote fails closed when:

- the selected window is outside the provider's verified scheduling horizon;
- the provider cannot quote the route/service;
- store pickup profile or coordinates are incomplete;
- customer address, coordinates, or required phone are incomplete;
- Order shipping weight is unresolved; or
- currency, quotation, or provider configuration is invalid.

On dispatch day, the store operator may choose any enabled external provider and may request an
immediate or provider-scheduled pickup that still satisfies the committed customer window. Core
re-quotes before booking. The customer is never charged again: FreshMarkets absorbs a higher final
courier cost and retains the difference if the final cost is lower.

The accepted checkout quote and the final courier payable are separate immutable financial facts.

### 8. Typed provider capabilities, not a general rules engine

Core implements a typed provider capability/policy layer. It is not user-authored code, a generic
expression evaluator, or an arbitrary rule engine.

Each adapter declares verified capabilities such as:

- immediate quote and booking support;
- scheduled quote and booking support;
- maximum scheduling horizon;
- quotation expiry/TTL handling;
- supported cities/markets and configured service types;
- required package weight or dimensions;
- phone and address wire formats;
- pickup and recipient instruction fields;
- status, tracking-link, cancellation, and proof support; and
- webhook identity/authentication behavior.

A small delivery-provider selection policy chooses Lalamove for Scheduled checkout pricing. Instant
options are generated from enabled adapters that can quote the resolved route. Provider-specific
constraints stay inside adapters/capabilities instead of being scattered through Checkout, Orders,
Admin, and Web.

Provider capabilities and payload mappings must be reverified against official documentation at
the start of their implementation phase:

- Lalamove: <https://developers.lalamove.com/>
- GrabExpress: <https://developer.grab.com/docs/grab-express/>

### 9. Store and customer delivery data

Every store location owns its own courier pickup profile:

- sender/store name;
- required normalized E.164 phone;
- optional provider email;
- structured pickup address;
- authoritative existing store latitude/longitude; and
- optional pickup instructions.

No store may borrow another store's profile or coordinates.

Every delivery destination requires:

- recipient name;
- required reachable phone;
- structured address and formatted address;
- exact confirmed latitude/longitude;
- building/unit, when applicable;
- landmark, when applicable;
- gate/guard/access guidance, when applicable;
- delivery note, when applicable; and
- recipient/call instruction, when applicable.

The Better Auth account email remains required by the authentication flow. It is not automatically
a required courier delivery field, and delivery email remains optional unless a verified provider
capability requires it.

### 10. Shipping weight and package policy

Each SKU records an estimated shipping weight in grams per sold unit when its inventory base unit
does not already supply grams. Total Order shipping weight is the sum of `ordered quantity x grams
per sold unit` across the original Order and paid additions.

FreshMarkets may classify the packed Order internally as one `BAG` below 10,000 grams or one `BOX`
at or above 10,000 grams. This is internal fulfillment information. The Lalamove PH payload omits
the optional `item` object, package dimensions, thermal-bag requests, perishable flags,
temperature-sensitive flags, keep-dry facts, and the internal bag/box classification unless a
future verified API requirement makes a particular field necessary.

Active catalog authoring supports mass and count only. Packaged liquids are sold as pieces.
Historical `VOLUME`, `MILLILITER`, and `LITER` data remains inactive compatibility history.

### 11. Provider payload boundary

The provider-neutral request contains only data required to quote, book, reconcile, or operate the
delivery:

- merchant/Order reference and service assertion;
- store sender profile and exact origin coordinate;
- customer recipient, required phone, full destination, and exact coordinate;
- applicable pickup and destination instructions in distinct internal fields;
- positive total shipping grams and provider-required package facts only; and
- immediate pickup or an exact supported future pickup time.

For Lalamove, Core creates a quotation and then creates the order using returned quotation/stop
identities. Customer destination instructions are combined into labeled recipient `remarks` only
where Lalamove has no separate supported field. Store pickup instructions are not inserted into
recipient remarks; they remain operational/internal unless an official Lalamove pickup-instruction
field is verified. FreshMarkets requests no courier COD, purchase service, cash collection,
autodeduct COD, thermal-bag option, or route optimization.

For GrabExpress, pickup instructions use the verified sender instruction field. Customer
instructions are mapped only to documented supported fields. Exact decimal provider money is
converted to integer minor units without floating-point multiplication.

Protected provider bodies, contact/address data, credentials, tracking links, and pickup PINs never
enter diagnostic logs or ordinary read models.

### 12. Delivery status without a custom map

The customer and Admin see normalized delivery progress, not raw provider vocabulary and not a
FreshMarkets driver-location map. The desired customer progression is:

```text
confirmed -> picking -> packed/ready -> finding courier -> courier assigned
          -> out for delivery -> delivered
```

Provider events update provider-dispatch observation first. Explicit Delivery commands then advance
legal FreshMarkets delivery/order projections. The adapter must not fabricate states a provider
does not report. Failure, cancellation, return, expiry, rejection, and uncertain creation remain
visible exception states with reconciliation actions.

A provider tracking/share link may be stored and selectively exposed later, but a custom map and
live driver coordinates are out of scope for this implementation plan.

### 13. Promotions

Promotions supports controlled, database-configured benefits:

- free delivery;
- percentage or fixed-amount delivery discount;
- percentage or fixed-amount merchandise/order discount; and
- the existing membership fee waiver.

Usage policy includes optional global maximum and an integer per-customer maximum, allowing one use,
two uses, or another configured positive limit. Promotions may be code-based or automatic and may
include active dates and a minimum merchandise subtotal. Current stacking remains at most one
merchandise/order benefit plus one delivery benefit; membership benefits are separate. Arbitrary
promotion scripting remains forbidden.

### 14. Payments, refunds, and PayMongo fees

PayMongo remains the payment provider. Processing cost is absorbed by FreshMarkets and recorded
only as settlement/analytics evidence. Core does not enable a pass-on-fee customer charge.

Application refund states align to provider reality and reconciliation needs:

```text
REQUESTED -> PROCESSING -> SUCCEEDED
                    \-> FAILED -> PROCESSING / ESCALATED
```

Provider webhooks and reconciliation remain authoritative; browser return state never proves
payment or refund success.

With no Service Fee, a customer cancellation never retains a fabricated FreshMarkets fee. If a
courier booking has produced an actual documented non-refundable charge, customer-caused
cancellation may retain only that exact provider cost under the approved cancellation stage policy.
FreshMarkets-caused cancellation refunds the customer's remaining paid amount in full. Historical
Orders continue to use their immutable historical monetary snapshots.

### 15. Notifications on the Cloudflare stack

Transactional domain writes atomically create a D1 notification-outbox record. A publisher sends a
small JSON Queue message containing the outbox identity; the Queue consumer acquires a conditional
D1 lease, performs the idempotent email send, records an immutable attempt, and explicitly
acknowledges or retries that message. Cloudflare Queues is at-least-once delivery, so duplicate
delivery is expected and safe.

The Queue consumer handles each message independently, classifies transient/permanent failures,
uses bounded retry/backoff, and routes exhausted work to a dead-letter/operational exception path.
A scheduled redrive repairs due outbox rows whose Queue publication or consumer lease was lost.
Critical payment, Order commitment, inventory, and provider-booking state never moves to the Queue.

### 16. Remove runtime mock payments

Local and shared development use PayMongo sandbox credentials. Remove the mock payment provider,
simulation RPC/route/page, mock runtime configuration, and application-accessible mock outcomes.
Deterministic fakes remain allowed inside automated tests only.

### 17. Reliability and compatibility corrections

The implementation also completes these approved corrections while touching the same boundaries:

- replay/idempotency lookup occurs before mutable validation for externally replayable commands;
- every new Web JSON route uses shared byte bounds, media-type validation, JSON parsing, and schema
  validation;
- uncertain courier creation is reconciled and never blindly recreated;
- provider events use durable provider-event identity and compare-and-swap application;
- human-readable public Order numbers are populated for new commitments and safely backfilled for
  history where a deterministic policy is possible;
- legacy `sourcingMode` stops being written and is later removed from active schemas/contracts;
- historical Service Fee, volume-unit, internal-fleet, and mock-payment data remains readable only
  where required for immutable history or migration safety; and
- no migration rewrites previously applied migration files.

## Implementation Phases

### Phase 1 — Canonical decision alignment

Update `AGENTS.md`, Architecture, Domain Model, State Machines, Data Model, API Contracts, Product
Scope, marketplace/Admin design references, and the master Implementation Plan so they all express
the approved decisions above. Mark older dated plans as historical where they conflict rather than
rewriting their recorded implementation history.

Acceptance:

- contradiction searches find no active canonical authority for a Service Fee, Scheduled capacity,
  internal fleet, Scheduled inventory netting, internal route-based customer fees when a provider
  quote is required, or runtime mock payments;
- the global selling gate and exact store/SKU retail price are explicit; and
- current/replacement behavior is distinguishable from preserved historical snapshots.

### Phase 2 — Forward-only persistence realignment

Add migrations that:

1. add/version the global `OPEN|PAUSED` selling state alongside the global fulfillment mode;
2. add immutable provider quotation evidence to Checkout/Order delivery snapshots;
3. retain separate checkout delivery charge and final courier payable/variance evidence;
4. stop active capacity allocation and Scheduled inventory-demand netting;
5. simplify Scheduled committed demand/procurement to exact paid Order quantities;
6. preserve exact location/SKU retail price authority;
7. preserve historical Service Fee fields but make them inactive for new commerce;
8. align refund processing/reconciliation fields;
9. support Cloudflare Queue publication/lease/DLQ evidence on the D1 outbox;
10. support deterministic historical public Order-number backfill; and
11. preserve legacy Rider/fleet/mock rows until active callers are removed and data retention is
    proven.

Run both fresh-database and populated-upgrade migration tests. Every table rebuild must copy and
validate historical rows before replacing an old table.

### Phase 3 — Global selling gate and mode transition

Implement Core-owned queries/commands for the singleton commerce configuration. The activation
command is expected-version and idempotency guarded. Pausing and reopening are explicit audited
commands. Mode switching while `OPEN` fails closed; operators pause, resolve readiness, switch, and
reopen.

Acceptance covers concurrent updates, exact replay, changed replay, stale version, invalidation of
unpaid/unstarted Quotes, safe completion of already-started payment reactions, committed work
protection, and mode-specific readiness.

### Phase 4 — Catalog, exact retail pricing, and Scheduled availability

Finish active-unit retirement, shipping grams, Product/SKU/store active status, and exact
location/SKU price administration. Remove active sourcing-mode controls. Implement two availability
policies:

- Instant: active + exact price + sufficient physical stock;
- Scheduled: active + exact price + open pre-cutoff window, with no stock or capacity query.

Acceptance proves 100 configured units produce 100 units of Scheduled demand, shipping weight
multiplies per sold unit, Scheduled checkout is independent of inventory balances, and missing store
price never falls back or becomes zero.

### Phase 5 — Provider capability layer and Lalamove quotation

Define the typed provider capabilities and the small selection policy. Complete and verify the
Lalamove adapter first, including sandbox authentication, city/service discovery, quotation,
scheduled quotation, order creation, get/status, cancel, webhook verification, exact money parsing,
request identifiers, rate-limit handling, and uncertain-outcome reconciliation.

Do not invent unsupported fields. Record the official-document version/date and sandbox evidence in
the provider decision/runbook. Keep Grab disabled until its Cebu access, pricing, auth, webhook, and
sandbox gates are verified.

### Phase 6 — Provider-priced Checkout

Replace internally configured customer delivery-fee calculation with provider quotation evidence:

- Instant fulfillment options quote every enabled eligible partner and let the customer select one;
- Scheduled fulfillment options show only the window and use Lalamove as the internal pricing
  provider with a supported future pickup time;
- quote refresh/payment readiness re-quotes and requires explicit acceptance on any customer-total
  change;
- Quotes fail closed on invalid provider, horizon, contact, profile, address, coordinate, currency,
  weight, expiry, or routing evidence; and
- selling `PAUSED` blocks new Quote/payment creation.

Remove active Service Fee calculations and PayMongo fee pass-on. Preserve explicit merchandise,
discount, delivery, tax, and final-total arithmetic in integer minor units.

### Phase 7 — Commitment, exact Scheduled purchasing, and fulfillment

Commit Instant stock holds/reservations exactly once. Commit Scheduled lines as exact paid purchase
demand without capacity or inventory effects. Build operations read models that aggregate the exact
purchase list, allow procurement recording, and feed picking/packing status without incoming-stock
or safety-buffer formulas.

Retain clear customer progress: confirmed, picking, packed/ready, courier assigned, out for delivery,
delivered. Preserve shortage/quality exceptions without converting the preorder model into an
inventory forecast system.

### Phase 8 — External-only dispatch and normalized tracking

Remove active Rider/batch/internal-fleet commands and UI. Implement store-scoped external dispatch:

- Instant books only the customer-selected provider/service;
- Scheduled lets the operator select an enabled provider and immediate/scheduled pickup;
- the booking command checks exact replay before mutable validation;
- quote, create, get, cancel, webhook, manual refresh, and reconciliation are explicit operations;
- provider status maps to legal FreshMarkets status without fabricating missing states; and
- customer/Admin render state and exceptions without a driver map.

Acceptance covers provider unavailability, quote expiry, price variance, duplicate/out-of-order
events, webhook signature failure, local persistence uncertainty, cancellation limits, and customer
status projection.

### Phase 9 — Payments, refunds, promotions, and customer totals

Remove new Service Fee configuration/use, absorb PayMongo fees, retain settlement cost internally,
align refund states, and implement the approved cancellation-cost rule. Finish controlled promotion
benefits and integer global/per-customer usage limits.

Acceptance proves customer totals never contain Service Fee or processing fee, promotion stacking
is deterministic, usage limits are concurrency-safe, settlement arithmetic reconciles exactly, and
historical Service Fee Orders remain accurate.

### Phase 10 — Cloudflare Queues notifications

Configure producer, consumer, retry, and dead-letter bindings. Keep D1 as the transactional source
of notification intent. Publish only stable outbox identities as JSON. The consumer uses
per-message try/catch, explicit `ack()`/`retry()`, conditional lease acquisition, and idempotent send
evidence. Add scheduled recovery for unpublished/stuck outbox rows.

Acceptance covers duplicate delivery, consumer crash after send, producer failure after domain
commitment, expired leases, transient and permanent provider failures, retry exhaustion, DLQ
visibility, and no mutation of source domain state.

### Phase 11 — Compatibility removal and interface cleanup

After every active caller is migrated:

- remove mock payment runtime/routes/pages;
- remove Service Fee Admin/customer surfaces and active contracts;
- remove internal Rider/fleet navigation, commands, read models, and readiness checks;
- remove active Scheduled capacity configuration and errors;
- remove legacy sourcing-mode writes and controls;
- keep only intentionally versioned historical DTO fields required to render old Orders; and
- update operational runbooks for selling pause/switch/reopen and provider incidents.

### Phase 12 — Full verification and activation

Run naming, architecture, lint, type, focused/full unit/integration, migration, Worker-local, build,
and relevant Playwright checks. Perform signed-in browser validation for:

1. store/SKU price administration;
2. pause/switch/reopen behavior;
3. Instant inventory and courier selection;
4. Scheduled no-stock/no-capacity checkout with Lalamove-priced delivery;
5. PayMongo sandbox payment and provider-confirmed commitment;
6. exact Scheduled purchase aggregation;
7. external provider dispatch and status progression;
8. customer totals with no Service Fee/processing fee;
9. promotions and usage limits; and
10. notification Queue retry/recovery.

Lalamove production activation remains fail-closed until Cebu service availability, store pickup
profiles, wallet/account readiness, webhook configuration, credentials, sandbox payload evidence,
and reconciliation runbooks are complete. Grab remains disabled until its own capability and city
acceptance gates pass.

## Cross-Phase Definition of Done

The realignment is complete only when:

- every canonical document, contract, schema, Core policy, Web surface, and test agrees;
- global selling and global mode are separate, versioned authorities;
- each store/SKU has its own manually entered final retail price;
- new customer totals contain no FreshMarkets Service Fee or PayMongo processing fee;
- Scheduled checkout uses no stock and no capacity but preserves exact paid demand;
- customer delivery fees come from a verified provider quotation;
- Lalamove is the working initial Scheduled pricing/dispatch provider;
- all active customer delivery execution uses external providers;
- provider payloads include required operational data and exclude the rejected enrichments;
- status is useful without a custom driver map;
- external side effects are idempotent and uncertain outcomes are reconcilable;
- notifications use the D1-outbox/Cloudflare-Queue pattern safely under at-least-once delivery;
- runtime mock payments are gone and PayMongo sandbox covers development; and
- historical committed Orders remain financially and operationally readable.

Committing, pushing, deploying, and enabling production provider credentials remain separate owner
actions.
