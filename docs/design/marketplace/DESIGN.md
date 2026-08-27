# FreshMarkets Marketplace Design

## Product Position

The marketplace is a grocery commerce experience with scheduled, serviceable delivery and subscription-gated purchase. It uses mature DoorDash-inspired discovery and checkout patterns as a usability reference, but it is not a DoorDash clone and must not import restaurant assumptions or branding.

## Core Principles

- Browsing is public where appropriate; purchasing requires an authenticated customer with an active/trialing subscription.
- The customer chooses products, quantities, address, and delivery option—not a fulfillment hub.
- Grocery hierarchy is explicit: product -> fixed sellable variant -> base inventory consumption.
- Availability messaging is honest but does not expose internal inventory/procurement complexity unnecessarily.
- Delivery serviceability and cycle selection happen before payment commitment.
- Every final price, fee, promotion, and eligibility decision comes from Core at checkout.
- The customer sees a clear commitment moment: payment succeeds, order becomes locked, and the next editable/additive window is explained.

## Information Architecture

Primary customer destinations:

- Home/discovery
- Search results
- Categories and category results
- Product detail
- Cart
- Checkout
- Order history
- Upcoming orders/delivery status
- Subscription/account

Secondary/supporting surfaces:

- Sign in/register/verification/reset/OAuth callback handling
- Address book and map confirmation
- Help/contact and policy content
- Order amendment entry when eligible

## Discovery and Home

Home should establish:

- what FreshMarkets sells and how its fulfillment modes work — an explicit Instant promise or Scheduled delivery in windows;
- current market/service context;
- categories and seasonal/high-intent collections;
- subscription/trial value without implying groceries are free;
- fulfillment-mode context when an address is known.

Use a strong search entry point, horizontally browsable category/collection groups on mobile, and product modules with clear fixed variant labels. Marketing content should remain useful without requiring login.

## Search and Categories

- Search supports tolerant text matching, category context, and clear no-results recovery.
- Category navigation is shallow enough for mobile and supports parent/child context.
- Results show product identity, variant/price, availability state, and a direct add/select action.
- Filter/sort controls should answer grocery needs (category, availability, price, collection) rather than restaurant-only concepts.
- Preserve query/filter state in the URL where practical.

## Product Cards

Cards prioritize:

1. Product image/alt text.
2. Product name.
3. Variant label (e.g. `500 g`, `12 pieces`).
4. Current price and any eligible promotion display.
5. Availability/delivery context.
6. Add/select action.

Do not imply a weight variant has its own independent physical stock. Do not show raw stock counts to customers by default.

## Product Detail

Show product story, image/media, fixed variant selector, current price, unit/quantity explanation, availability, delivery context, and add-to-cart action. If a product/variant is unavailable for the resolved location, explain the next useful action: choose another variant, change address, or browse alternatives.

Variant selection is fixed and deliberate in MVP. Arbitrary grams or final-weight settlement are not presented.

## Subscription Gate

The gate is contextual and transparent:

- Browsing/product inspection remains accessible.
- Add-to-cart may be allowed before login according to the chosen UX, but checkout/payment/order creation must be blocked until Core confirms authentication and subscription eligibility.
- Explain trial membership fee versus grocery/delivery charges.
- Provide login, start trial, or activate membership paths without discarding cart state.

UI gating is a convenience. Core repeats the rule at checkout and payment commitment.

## Cart

Cart shows:

- product and fixed variant;
- sellable quantity and editable controls;
- current displayed price/subtotal;
- availability warnings;
- merchandise minimum progress;
- subscription status prompt;
- address/cycle context when selected;
- delivery-fee/promotion preview only when enough context exists.

Cart is editable and does not lock price or permanently reserve stock/capacity. Prices are current admin-managed values, not a time-boxed guarantee; do not show a countdown. Stale price/availability responses link to refresh/review actions.

## Address and Serviceability

Address flow:

```text
enter structured address
 -> geocode
 -> show/allow map-coordinate confirmation
 -> resolve Cebu service area and zone
 -> show serviceable/unserviceable state
```

Use recipient, phone, barangay, city, notes, and landmark/instructions fields. Explain that the map pin determines serviceability. If outside the active polygon, do not permit checkout and provide a useful correction path. Core revalidates coordinates at checkout even if the frontend has already resolved them.

## Fulfillment Selection

Present the location's active mode commitment in customer language: an explicit Instant promise/ETA with its fee, or the Scheduled delivery date/window with any zone fee/capacity messaging. Do not expose internal hub names as choices. If a Scheduled cycle is full, offer available valid alternatives rather than accepting and silently shifting the order. Instant presentation follows the dedicated Instant-mode design specification and must not promise times the current rider supply cannot keep.

At/after a Scheduled cutoff, show that ordinary procurement-affecting changes are closed. If an additive amendment is available before cutoff, show it as a separate add-on action rather than “edit paid order.”

## Checkout

Checkout should make the commitment legible:

1. Subscription eligibility.
2. Delivery address and serviceability.
3. Fulfillment commitment — Instant promise or Scheduled cycle/window — and fee.
4. Items, fixed variants, price snapshots, discounts, minimum order.
5. Payment method/provider handoff.
6. Terms/commitment notice.
7. Pending/recovery/success state.

Core recalculates current price, discount, stock, serviceability, and route-based delivery fee immediately before payment. If the total changed, the browser presents the replacement quote and requires a distinct acceptance action before creating payment. The browser must also handle payment pending, return failure, duplicate submission, lost response, cycle-full race, route-fee failure, and recoverable retry states.

## Order History and Status

Order detail prioritizes:

- order number and committed date;
- delivery date/window and destination snapshot;
- item/variant/price snapshot;
- payment/total summary;
- fulfillment/delivery timeline;
- next valid customer action (amend where eligible, retry payment, report an issue, buy again, contact support).

Do not rewrite historical details after catalog/address changes. Show amendments as separate financial additions in one understandable timeline.

## Responsive and Mobile Behavior

- Mobile is a first-class purchase surface, not a compressed desktop.
- Use sticky search/cart affordances where they improve discovery without obscuring content.
- Product grids adapt to narrow widths while preserving variant/price clarity.
- Checkout uses a readable single-column progression with a sticky/summary affordance.
- Address maps and cycle selectors support touch and clear fallback if map interaction fails.
- Order status uses a concise timeline and prominent next action.
- Use accessible focus management, labels, error summaries, and non-color status cues.

## Performance and vinext Guidance

- Prefer server-rendered read-heavy marketplace surfaces through Core queries.
- Keep interactive cart/checkout/address controls client-side but keep writes in typed Core calls.
- Use request-time image optimization only after vinext/R2 compatibility is verified.
- Avoid relying on Cache Components/PPR or undocumented caching semantics in MVP.
- Use explicit cache/revalidation policy for public catalog content; never cache personalized eligibility, prices, subscription, or order responses incorrectly.

## Phase-0 Research And Proposal

The detailed phase-0 storefront proposal, selected rendered Mobbin references, token decisions, component inventory, and implementation sequence live in `STOREFRONT_DESIGN.md`. `REFERENCES.md` records the reference-use boundary and the 2026-08-25 Mobbin research log.
