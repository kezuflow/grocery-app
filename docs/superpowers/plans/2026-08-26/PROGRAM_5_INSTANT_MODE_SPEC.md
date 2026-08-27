# Program 5 — Instant Mode: Design Spec & Plan

Status: SELF-REVIEWED (2026-08-26). Implements ruling D1 (two first-class modes; never fake
cycles) against the canonical constraints in `STATE_MACHINES.md` ("No INSTANT Order is assigned a
synthetic cycle"; operational boundary = snapshotted promise, expiring hold, committed
reservation, Fulfillment transitions), `DOMAIN_MODEL.md` (`INSTANT + STOCKED`; sourcing separate
from fulfillment mode), and `ARCHITECTURE.md`. No new product decision beyond recorded autonomy
rulings below.

## Ground truth audited

No instant-specific implementation exists. Current reality: `checkout_quote.delivery_cycle_id`
and `order_fulfillment_snapshot.cycle_id` are `NOT NULL` (hard-wired to Scheduled); no
location-mode configuration table exists; `checkout_inventory_holds` (HELD/COMMITTED/
RELEASED/EXPIRED) with scheduler expiry, atomic `inventory_balance` reservations, zone fees, and
the fulfillment/delivery job chain seeded at commitment all exist from remediation and Programs
1–2 and are reused as-is.

## Core design decision: mode belongs to the location

Per canonical rules ("each active fulfillment location has exactly one active mode"), the
location's active mode determines checkout semantics. Customers never pick a mode or a hub at
launch: they see the mode-derived promise. A later configuration change never rewrites committed
orders. This removes an entire class of dual-mode cart complexity from launch while keeping both
modes first-class.

## Coverage of the twelve D1 areas

1. **Serviceability** — instant is serviceable where the address resolves to a delivery zone,
   that zone+location pair has an active fee row, AND the location's active mode is `INSTANT`.
   The authoritative address resolver gains the mode outcome; unserviceable reasons distinguish
   `INSTANT_MODE_UNAVAILABLE`.
2. **Current sellable inventory** — only `STOCKED` sourcing participates; availability comes
   from `inventory_balance.on_hand - reserved - held` (existing exact-quantity machinery).
   Planned/on-demand items are not offered in an instant basket.
3. **Promise/ETA** — persisted at quote time: `promised_at = now + promise_minutes` from the
   location's instant configuration (market timezone wall-clock preserved). Stored on the quote's
   fulfillment snapshot and the immutable order snapshot. Never recomputed silently.
4. **Capacity / rider supply** — `max_concurrent_instant_orders` per location in the mode
   configuration, enforced as a guarded conditional insert at commitment (count of non-terminal
   instant orders < cap). Rider assignment itself stays the existing manual `assignRider`
   surface; no automated rider-supply modeling before launch.
5. **Delivery fee policy (superseded 2026-08-27)** — checkout now uses the effective versioned
   market/location minimum and per-kilometer integer configuration with provider-neutral road-route
   meters. Historical zone-fee columns are compatibility data, not quote authority.
6. **Reservation/hold behavior** — instant quotes create `checkout_inventory_holds` exactly like
   today; the Program 2 expiry job releases abandoned holds; commitment converts HELD →
   COMMITTED atomically with payment reaction application.
7. **Preparation** — expressed operationally through the existing Fulfillment transitions on
   `fulfillment_record` seeded at commitment; no new preparation domain object.
8. **Cancellation stages (superseded 2026-08-27)** — customer grocery cancellation is not exposed
   in the mock-payment MVP. Existing scoped operations machinery remains internal and does not grant
   customer authority.
9. **Payment/commitment timing** — identical to Scheduled (pay at checkout, provider-confirmed
   canonical success commits), except there is no cutoff boundary: commitment seeds
   `fulfillment_record` + unassigned `delivery_job` immediately with the snapshotted promise.
10. **Rider dispatch** — unchanged Program 1 surfaces (assignment + legal delivery transitions).
11. **Customer tracking** — delivered by Program 9 (order detail/tracking) reading the same
    fulfillment/delivery records; no instant-specific tracking store.
12. **Failed delivery** — unchanged canonical delivery failure path (`FAILED` job → operations
    exception/redelivery command); instant adds no parallel mechanism.

## Persistence (migration `0021`, forward-only)

- New `fulfillment_location_mode(location_id PK REFERENCES fulfillment_location, active_mode
  'INSTANT'|'SCHEDULED', promise_minutes NULL CHECK>0, max_concurrent_instant_orders NULL
  CHECK>0, version, timestamps)` — one row per location; updating it atomically retires the
  prior configuration (CAS on version).
- Rebuild `checkout_quote`: `delivery_cycle_id` becomes nullable, add `fulfillment_mode
  'INSTANT'|'SCHEDULED' NOT NULL DEFAULT 'SCHEDULED'` (pre-launch tables; rebuild preserves
  rows).
- Rebuild `order_fulfillment_snapshot`: `cycle_id` nullable, add `promised_at INTEGER NULL`;
  CHECK: `(fulfillment_mode='SCHEDULED') = (cycle_id IS NOT NULL)` — an instant order never
  carries a cycle, a scheduled order always does.
- `ALTER TABLE delivery_zone_fee ADD COLUMN instant_fee_minor INTEGER NULL CHECK (instant_fee_minor
  IS NULL OR instant_fee_minor >= 0)`.

## Application slices

1. **Slice 1 — mode configuration:** migration `0021`; `getLocationMode` query +
   `setFulfillmentLocationMode` admin command (capability `fulfillment:manage`, idempotency +
   expectedVersion, atomic retire-by-update); contracts + entrypoint RPC; tests including mode
   switch not touching existing orders.
2. **Slice 2 — instant checkout branch:** quote creation resolves the location's active mode;
   `INSTANT` validates stocked-only lines, creates holds, computes and persists the promise,
   writes a mode-correct snapshot without a cycle; eligibility/quote views expose mode + promise;
   serviceability outcome gains instant availability; tests cover both modes end-to-end at quote
   level.
3. **Slice 3 — instant commitment:** reaction-driven order commitment writes the no-cycle
   snapshot, enforces `max_concurrent_instant_orders`, converts holds, seeds fulfillment/delivery
   rows immediately; cancellation stage rule keyed to fulfillment progress; tests for capacity,
   hold conversion, snapshot shape, and mode-change isolation.

Program 6 (notifications) later hooks instant confirmation/out-for-delivery sends; nothing here
blocks on it.

## Recorded rulings

1. Mode selection is location-level at launch; per-order mode choice would multiply cart/quote
   complexity for zero launch need (canonical "exactly one active mode per location").
2. Quote/snapshot tables are rebuilt forward rather than given sentinel cycle values — a fake
   cycle is canonically forbidden.
3. Capacity is a per-location concurrent-order cap, not a rider-supply model (YAGNI; rider
   assignment stays manual).
4. Promise arithmetic uses market-timezone wall-clock addition of configured minutes, stored once
   at quote time.
