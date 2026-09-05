# FreshMarkets Marketplace Design

## Product Position

The marketplace is a grocery commerce experience with serviceable external delivery: authenticated pay-as-you-go Instant commerce and membership-gated Scheduled preorder commerce. It uses mature DoorDash-inspired discovery and checkout patterns as a usability reference, but it is not a DoorDash clone and must not import restaurant assumptions or branding.

## Core Principles

- Browsing is public where appropriate; purchasing requires authentication. Only Scheduled requires an eligible active/trialing/past-due-within-policy membership.
- The customer chooses products, quantities, address, and the allowed mode-specific delivery option—not a fulfillment hub or Scheduled execution method.
- Grocery hierarchy is explicit: product -> fixed sellable variant -> base inventory consumption.
- Availability messaging is honest but does not expose internal inventory/procurement complexity unnecessarily.
- Delivery serviceability, provider quotation, and any Scheduled window selection happen before payment commitment.
- Every final exact-location retail price, delivery quotation, Promotion, and eligibility decision comes from Core at checkout. New commerce shows no FreshMarkets Service Fee or PayMongo processing fee.
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

Variant selection is fixed and deliberate in the current release. Arbitrary grams or final-weight settlement are not presented.

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
- mode-specific membership status prompt;
- address/cycle context when selected;
- provider-quoted delivery-fee/Promotion preview only when enough context exists.

Cart is editable and does not lock price or permanently reserve stock. Prices are current exact-store Admin-managed values, not a time-boxed guarantee; do not show a countdown. Stale price/availability/quotation responses link to refresh/review actions.

## Address and Serviceability

The storefront `Deliver to` control opens this flow in a modal without discarding the current
browsing context. A serviceable confirmed location may become the session browsing location and
update the header label, but it remains non-authoritative until selected from a saved customer
address and revalidated by Core during checkout.

Address flow:

```text
enter structured address
 -> geocode
 -> show a centered draggable pin and allow map-coordinate confirmation
 -> reverse-geocode a moved pin to fill the editable structured address
 -> resolve Cebu service area and zone
 -> show serviceable/unserviceable state
```

Use recipient, phone, barangay, city, notes, and landmark/instructions fields. Selecting a search result recenters the map; clicking or dragging the pin keeps the chosen coordinate and refreshes the structured address without overwriting recipient or delivery-instruction fields. Explain that the map pin determines serviceability. If outside the active polygon, do not permit checkout and provide a useful correction path. Core revalidates coordinates at checkout even if the frontend has already resolved them.

## Fulfillment Selection

Present the one global active mode in customer language. For Instant, after address/serviceability and before payment, show one card per enabled quoteable external delivery partner with display name, service label, provider-quoted delivery fee, and supported promise/ETA. The customer selects one opaque option; do not expose quotation/order IDs or silently replace the partner. For Scheduled, show only the delivery date/window and Lalamove-priced delivery amount; do not show the eventual provider choice. Explain that store operations later choose an enabled external courier and pickup timing. Do not show capacity, internal fleet, Rider, batch, hub, or route-planning concepts. If selling is paused or a provider/window is unavailable, show an explicit recovery state.

At/after a Scheduled cutoff, show that ordinary procurement-affecting changes are closed. If an additive amendment is available before cutoff, show it as a separate add-on action rather than “edit paid order.”

## Checkout

Checkout should make the commitment legible:

1. Authentication plus mode-specific membership eligibility.
2. Delivery address and serviceability.
3. Fulfillment commitment — Instant delivery-partner choice and promise, or Scheduled cycle/window with store-assigned delivery — and fee.
4. Items, fixed variants, price snapshots, discounts, minimum order.
5. Payment method/provider handoff.
6. Terms/commitment notice.
7. Pending/recovery/success state.

Core revalidates selling state, exact store/SKU price, discount, Instant stock/hold or Scheduled window/cutoff, serviceability, and provider quotation immediately before payment. If the total changed, the browser presents the replacement Quote and requires distinct acceptance. The browser handles payment pending, return failure, duplicate submission, lost response, quotation expiry/unavailability, and recoverable retry states. PayMongo sandbox is the development flow; no application mock-payment UI is shown.

## Order History and Status

Order detail prioritizes:

- order number and committed date;
- delivery date/window and destination snapshot;
- item/variant/price snapshot;
- payment/total summary;
- normalized fulfillment/external-delivery timeline without a custom live-driver map;
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
- Avoid relying on Cache Components/PPR or undocumented caching semantics in the current release.
- Use explicit cache/revalidation policy for public catalog content; never cache personalized eligibility, prices, subscription, or order responses incorrectly.

## Phase-0 Research And Proposal

The detailed phase-0 storefront proposal, selected rendered Mobbin references, token decisions, component inventory, and implementation sequence live in `STOREFRONT_DESIGN.md`. `REFERENCES.md` records the reference-use boundary and the 2026-08-25 Mobbin research log.
