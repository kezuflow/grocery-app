# Marketplace Design References

## How References Are Used

References inform interaction patterns, information hierarchy, accessibility, and responsive behavior. They do not authorize copying brand identity, visual assets, copy, restaurant concepts, or proprietary implementation.

## Primary Reference: Mature On-Demand Commerce Patterns

DoorDash is a usability reference for:

- prominent discovery/search;
- category navigation;
- fast product-card scanning;
- cart persistence;
- clear delivery context;
- checkout progression;
- order status and timeline communication.

Adaptation requirements:

- grocery products, variants, units, and replenishment instead of restaurants/menus;
- scheduled delivery cycles and cutoff messaging instead of instant ETA assumptions;
- subscription membership gate without making merchandise free;
- serviceability by coordinates and zones;
- internal fulfillment assignment hidden from customer hub choice;
- procurement/availability exceptions expressed simply to customers.

## Grocery Commerce Patterns to Study

Use mature grocery products and marketplaces as references for:

- aisle/category navigation;
- variant and pack-size clarity;
- unit-price comprehension where legally/product-wise appropriate;
- out-of-stock and availability alternatives;
- address book and map pin confirmation;
- scheduled delivery-window selection;
- order history/reorder affordances where compatible with fixed variants;
- mobile cart and checkout summaries.

When evaluating an external reference, ask:

1. Does it improve a customer decision in the FreshMarkets lifecycle?
2. Does it preserve subscription, serviceability, cycle/cutoff, and commitment semantics?
3. Does it introduce restaurant/instant-delivery assumptions that should be rejected?
4. Can it be implemented with the current vinext/Web/Core boundary?

## Visual and Interaction Principles

- Prefer familiar commerce conventions over novelty.
- Establish a clear primary action and preserve context while browsing.
- Use explicit labels for variant, price, delivery date/window, and eligibility.
- Use skeletons and stable layout to avoid content jumping.
- Design empty, unavailable, error, pending payment, cutoff, and full-capacity states as first-class screens.
- Ensure all reference-derived patterns meet WCAG-oriented keyboard, focus, contrast, semantics, and reduced-motion expectations.

## Brand Boundary

FreshMarkets must develop its own brand, visual tokens, iconography, photography, copy, and product voice. “DoorDash-inspired” means interaction maturity and clarity only. Do not reproduce DoorDash logos, colors as a brand system, screens pixel-for-pixel, restaurant terminology, or proprietary assets.

## Evidence and Review

For a future design decision, record the reference, the pattern adopted, the grocery-specific adaptation, and the reason it preserves FreshMarkets business invariants. Rejected patterns should be noted when they would incorrectly imply instant delivery, customer hub selection, free groceries during trial, arbitrary weight, or freely editable paid orders.

## Mobbin Research Log (2026-08-25)

The phase-0 research used the Mobbin MCP to inspect rendered DoorDash references rather than relying on metadata. Selected evidence and the adopted/rejected patterns are recorded in `STOREFRONT_DESIGN.md`. The primary flow references are [Placing an order](https://mobbin.com/flows/7f3299cb-8374-42f7-b2c6-16394ed74ed6), [Market detail](https://mobbin.com/flows/574c9430-44d3-40b4-9605-305e6990d11d), and [Item details (grocery)](https://mobbin.com/flows/3ce0bff7-a442-47ab-8da8-7b0b75d25e06). Screen references cover home, DashMart/grocery landing, produce/category, search, product detail, cart, address, checkout, tracking, notifications, account, and iOS mobile equivalents.
