# FreshMarkets Storefront Design

## Status And Scope

This document is the phase-0 storefront proposal. It defines the customer-facing information architecture, interaction model, visual language, responsive behavior, and component inventory for implementation after approval. It does not add contracts, alter business rules, or authorize new data behavior.

FreshMarkets uses DoorDash as a usability reference only. The brand, copy, product photography, icons, colors, and implementation remain original. The storefront is a grocery marketplace with subscription-gated checkout and two first-class fulfillment modes, `INSTANT` and `SCHEDULED`; it is not an instant restaurant marketplace. Instant may be disabled per market/service zone until supply, rider capacity, and operational readiness exist, and its customer promises follow the dedicated Instant-mode design specification rather than restaurant-style live-ETA mimicry.

## Research Method And Selected References

Mobbin MCP was used to search and inspect rendered DoorDash web and iOS screens and flows on 2026-08-25. The useful references are listed below with the pattern observed and the FreshMarkets adaptation.

### Web screens

- [DoorDash grocery home / merchandising rails](https://mobbin.com/screens/25ddf5dc-54ad-40ac-b1a3-d89c4b104aab) shows a persistent left rail, global search, address and delivery controls, compact filter pills, promotional cards, horizontal store/product rails, and product-level Add controls. Adopt the information density and scan order; replace store/restaurant rows with FreshMarkets categories and fixed variants.
- [DoorDash DashMart landing](https://mobbin.com/screens/8fb71226-ec7c-4472-9aef-cdab75483340) shows a grocery-specific category icon strip, a restrained promotional band, and repeated product rails with price, unit, stock, and Add. Adopt the grocery merchandising rhythm; use FreshMarkets category illustrations and fulfillment-mode context (Instant promise or Scheduled cycle).
- [DoorDash Produce category](https://mobbin.com/screens/aac80df9-0dfc-436c-bfe9-4d7724e2ac6b) shows breadcrumb, category icon strip, compact chips, result count/sort, and a low-chrome product grid. Adopt this as the primary category template.
- [DoorDash search results](https://mobbin.com/screens/3c74fa75-b0d8-4e27-a9c8-369a4b4ee78b) shows query context, active chips, result count, sort, and a scan-friendly product grid. Adapt filters to category, availability, price, and collection; do not add restaurant rating or delivery-time filters unless a grocery decision needs them.
- [DoorDash grocery product detail](https://mobbin.com/screens/7f3dd4c7-1b79-4466-98a0-dac74f8832e8) shows a focused overlay with large media, product details, stock/unit context, quantity control, related items, and a sticky total-aware add action. Adopt the quick-add overlay and keep variant selection fixed and explicit.
- [DoorDash cart panel](https://mobbin.com/screens/ed892ac4-7dc4-4b98-9ab2-81a4a978fac3) shows a right-side cart with an obvious continue/checkout CTA, compact line items, steppers, and cross-sells. Adopt the persistent desktop sheet; cross-sells must remain optional and never obscure cart totals or minimum-order progress.
- [DoorDash address picker](https://mobbin.com/screens/3db0a7ba-673d-4ae8-acb4-e2446643b0ca) shows a map pin, address fields, drop-off instructions, and an explicit serviceability error. Adopt the map-confirmation pattern, but Core remains authoritative for coordinates, zone, and eligibility.
- [DoorDash checkout shipping details](https://mobbin.com/screens/85a66714-9cf1-4bbc-a589-d6941f145b43) shows delivery/pickup segmentation, map context, standard versus scheduled delivery choices, and editable address/instruction rows. Adopt the progressive summary; FreshMarkets exposes either an explicit Instant promise or a Scheduled cycle/window, never customer pickup.
- [DoorDash checkout order summary](https://mobbin.com/screens/33b9c188-97a8-4c47-9409-4cef0ef22f32) shows a dedicated financial summary, payment method, promotion entry, and a single place-order action. Adopt the separation of details and commitment CTA; totals, fees, promotions, subscription eligibility, and payment readiness come from Core.
- [DoorDash order tracking](https://mobbin.com/screens/8db8da5b-1a54-4779-9d93-bb8c8432d505) shows map/status progression, an order-detail affordance, and a delivery context panel. Adopt the timeline and next-action hierarchy; use FreshMarkets fulfillment and delivery states rather than a promised live route when unavailable.
- [DoorDash notification drawer](https://mobbin.com/screens/299f9962-f982-4dc5-8f29-94b6116bc0cd) shows a contextual side drawer with order status and personalized recommendations. Adopt a notification drawer with unread state and deep links; the drawer surface itself remains deferred, while the approved launch scope already includes the minimal transactional email set recorded in `MVP_SCOPE.md`. Domain events remain the authority; the drawer only presents them.
- [DoorDash account surface](https://mobbin.com/screens/b839ca01-5984-49ca-bf72-5a9c249179bb) shows a persistent shell with account details and settings sections. Adopt the calm, form-oriented account workspace while keeping Better Auth/Core ownership boundaries.

### Web flows

- [DoorDash Placing an order flow](https://mobbin.com/flows/7f3299cb-8374-42f7-b2c6-16394ed74ed6) is a 12-screen journey covering browse, cart, address, delivery details, payment, place order, and post-order status. This is the reference for preserving context between steps and making the payment commitment visible.
- [DoorDash grocery market detail flow](https://mobbin.com/flows/574c9430-44d3-40b4-9605-305e6990d11d) demonstrates store-to-deals-to-category navigation. FreshMarkets maps this to Home -> Deals -> category, without customer selection of a fulfillment hub.
- [DoorDash grocery item detail flow](https://mobbin.com/flows/3ce0bff7-a442-47ab-8da8-7b0b75d25e06) demonstrates a product quick-add overlay and related-item rail. Adopt the interaction, not its branded assets or arbitrary restaurant options.

### Mobile screens

- [DoorDash iOS grocery home](https://mobbin.com/screens/a300323e-a819-4528-b354-b71724b86c06) uses a compact title/search stack, horizontally scrollable filters, promotional rail, store list, and bottom navigation. FreshMarkets uses the same touch-first hierarchy for categories, products, and cart.
- [DoorDash iOS cart](https://mobbin.com/screens/ef91d789-3440-4e08-9b48-1bceba6855ed) uses a bottom-anchored Continue CTA, line-item steppers, and optional recommendations. FreshMarkets uses a full-screen cart/bottom-sheet variant with minimum-order and fulfillment-mode context.
- [DoorDash iOS checkout](https://mobbin.com/screens/85e47483-f648-40c3-8d89-ec4e77240217) separates map/address, delivery time, instructions, cart summary, and the next action into a single-column progression. FreshMarkets substitutes its fulfillment-mode choice — an explicit Instant promise or a Scheduled cycle/window — plus subscription eligibility.
- [DoorDash iOS order tracking](https://mobbin.com/screens/b2543cf1-7f95-4718-92d6-74af14de04d5) uses a map plus a bottom status sheet. FreshMarkets may use a map only when a trustworthy delivery projection exists; the state timeline remains useful without live location.

## Patterns To Adopt And Reject

Adopt: persistent discovery/search, shallow category navigation, compact filter pills, horizontal merchandising rails, low-chrome product cards, optimistic cart feedback, quantity steppers, desktop cart sheet, mobile bottom-sheet/full-screen cart, progressive checkout summary, explicit address confirmation, and visible order status progression.

Reject or change: DoorDash red branding and logos; restaurant/store marketplace switching; unbacked live-ETA mimicry; pickup and customer hub selection; restaurant ratings/tips; arbitrary meal customizations; free-merchandise implications from membership; generic cross-store carts; and freely editable paid orders. FreshMarkets must preserve fixed sellable variants, subscription eligibility, serviceability, mode-specific fulfillment cutoff/capacity commitments, Core pricing, and locked paid orders with additive amendments only. Instant-mode interaction patterns are owned by the dedicated Instant-mode design specification, not improvised from restaurant references.

## Information Architecture

Desktop primary navigation:

1. Home
2. Shop
   - Produce
   - Fruits
   - Meat & Seafood
   - Dairy & Eggs
   - Pantry
   - Bakery
3. Boxes
   - Small Box
   - Medium Box
   - Large Box
4. Deals
   - Fresh This Week
5. Orders
6. Subscription
7. Account

The sidebar is persistent at desktop widths and becomes a menu/bottom navigation on mobile. Customers choose an address and delivery cycle; they never choose a fulfillment hub.

## Desktop Shell

Use a white, sticky global header with FreshMarkets wordmark, large central grocery search, address selector, notification affordance, and cart badge. A narrow left rail contains the destinations above. The content column is constrained for scanability and uses category navigation, filter chips, promo modules, and product rails/grids. The cart opens as a right-side sheet without losing browsing context.

Home order: address/service context -> search -> category strip -> one or two restrained promotion modules -> Fresh This Week/product rails -> seasonal or category rails. Avoid a marketing hero inside the authenticated storefront.

## Mobile Shell

Mobile uses a compact sticky header with address, notification, and cart actions; a full-screen search state; horizontally scrolling category/filter rails; two-column product grids where the image remains dominant; and a bottom navigation for Home, Shop, Orders, and Account. Cart opens full-screen or as a tall bottom sheet with a sticky checkout CTA. Touch targets are at least 44px and no desktop sidebar is squeezed into the viewport.

## Shared Visual Tokens

Initial tokens are CSS variables, not repeated literals:

| Token          | Value     | Use                                  |
| -------------- | --------- | ------------------------------------ |
| `background`   | `#FFFFFF` | primary canvas                       |
| `surface-soft` | `#F7F8F3` | section bands, muted surfaces        |
| `primary-lime` | `#B7F34A` | selected states, CTAs, cart, accents |
| `primary-dark` | `#1F3D24` | brand, strong actions, headings      |
| `text`         | `#191919` | primary content                      |
| `text-muted`   | `#6B6B67` | metadata and helper copy             |
| `border`       | `#E8E9E3` | restrained separators                |
| `success`      | `#238636` | in-stock/valid states with text/icon |
| `danger`       | `#D92D20` | errors and destructive actions       |

Typography uses the licensed, self-hosted **Helvena** webfont for the customer storefront. Regular supports body copy and metadata; Medium supports secondary controls; Semibold supports navigation, categories, and product names; Bold supports section headings; Black is reserved for major promotional headings. Tokens: display 40/44 900; h1 32/42 800; h2 24/32 700; h3 18/28 600; body 16/26 400; body-sm 14/22 400; caption 12/18 500; micro 11/16 600. Letter spacing remains 0. Admin typography remains independent.

Spacing follows a 4px base scale (4, 8, 12, 16, 24, 32, 40, 48). Radii are 4px for controls, 8px for product/promo framing, and 12px only for sheets/dialogs. Shadows are limited to elevation for sheets/dialogs; product cards and page sections are unframed by default.

## Iconography And Merchandise Illustration

Functional icons use Lucide consistently: Search, Bell, Shopping Cart, Home, Clipboard/List, User, Chevron, Heart, Plus, Minus, MapPin, X, Settings, and Filter. Icon buttons receive accessible labels and tooltips where the meaning is not obvious. Category illustrations are a separate FreshMarkets asset boundary: Produce, Fruits, Meat & Seafood, Dairy & Eggs, Pantry, Bakery, Boxes, and Deals will use a cohesive branded illustration set rather than Lucide. Until those assets exist, use a stable placeholder component with the same dimensions and no screenshot or DoorDash asset reuse.

## Interaction And Component Inventory

Use existing shadcn/Radix-compatible primitives and Lucide for functional icons. Components own presentation; Core commands/queries own business behavior.

Storefront compositions: `StorefrontShell`, `StorefrontHeader`, `StorefrontSidebar`, `MobileNavigation`, `GrocerySearch`, `AddressPicker`, `CategoryStrip`, `CategoryItem`, `FilterChip`, `PromoBanner`, `MerchandisingSection`, `ProductRail`, `ProductGrid`, `ProductCard`, `AddToCartButton`, `QuantityStepper`, `CartDrawer`, `CartItem`, `MinimumOrderProgress`, `NotificationDrawer`, `AccountMenu`, `CheckoutSummary`, `DeliveryCyclePicker`, `OrderStatusTimeline`, `ProductDialog`, `ProductSkeleton`, and explicit loading/empty/error/unavailable/cutoff/full-capacity states.

Product card anatomy: image and alt text -> price/current promotion -> product name -> fixed variant/unit -> availability message -> compact Add. After add, Add becomes a minus/count/plus stepper in the same stable footprint. No raw stock counts by default.

Search owns debounced query state, URL persistence, suggestions, recent searches, and no-result recovery. Cart owns optimistic display state only until Core acknowledges a command; version conflicts and price/availability changes are explicit refresh/review states. Checkout presents subscription eligibility, address/serviceability, delivery cycle/cutoff/capacity, quote, payment handoff, and recovery; it never locally decides eligibility.

## States And Accessibility

Every surface defines loading skeletons, no-data and filtered-empty states, permission/auth gates, unavailable products, stale price/cart conflicts, unserviceable address, closed/full cycles, payment pending/failure/recovery, and success. Use semantic headings, labels, live announcements for cart/status updates, visible focus rings, keyboard-operable sheets/dialogs, text plus icon for status, sufficient contrast, and `prefers-reduced-motion` behavior.

## Proposed Implementation Sequence

1. Approve tokens, IA, reference adaptations, and component boundary.
2. Establish shared theme variables and typography in `apps/web/app/globals.css`; verify Inter and contrast.
3. Build shell/navigation/search/category primitives against existing catalog read models; add desktop/mobile layout tests.
4. Build product card/grid/rail and product dialog with fixed variant presentation and loading/unavailable states.
5. Build typed cart drawer, optimistic add/stepper behavior, conflict handling, and mobile cart.
6. Build address picker, delivery-instruction capture, and fulfillment-mode presentation (Instant promise or Scheduled cycle/window) using existing serviceability/cycle contracts; add cutoff/full/error states.
7. Build checkout, payment return/recovery, order confirmation, and order-status timeline against Core contracts.
8. Add account/subscription/orders/notifications surfaces when their read models and notification capability are stable.
9. Run typecheck, lint, focused contract/domain tests, Worker-local integration, and Playwright desktop/mobile flows; then perform vinext compatibility/performance/accessibility checks.

## Approved Decisions

- Keep the existing FreshMarkets brand identity for now. A clean text wordmark is sufficient; logo refinement does not block implementation.
- Public anonymous browsing is enabled.
- Add-to-cart is enabled before authentication. Authentication is the checkout/account boundary.
- Category illustrations use an original/custom FreshMarkets asset boundary. Mobbin artwork and screenshots are never production assets.
- The in-app notification drawer surface is deferred from the immediate implementation phase; the approved launch transactional email set is scope-tracked in `MVP_SCOPE.md` and delivered by the notifications feature program.
- Cebu delivery-cycle and fee wording is configurable/domain-driven and must come from read models or configuration, not presentation literals.
