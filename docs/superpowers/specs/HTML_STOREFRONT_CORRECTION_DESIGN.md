# HTML Storefront Correction Design

## Status and authority

This specification defines the correction pass for the standalone `html/` storefront prototype. It implements the approved customer-facing behavior without changing Core, D1, shared contracts, authentication providers, payment providers, or production deployment behavior.

The repository's canonical architecture, domain, state-machine, data-model, API-contract, MVP, and marketplace-design documents remain authoritative. DoorDash and Mobbin are usability references only. When a reference conflicts with FreshMarkets business rules, the FreshMarkets rule wins.

## Objective

Turn the existing HTML prototype into a complete, internally consistent, accessible, full-viewport demonstration of the FreshMarkets customer journey:

1. Public marketplace browsing.
2. Product selection with fixed variants.
3. Add to cart before authentication.
4. Sign-in requirement immediately after the first anonymous add, without losing the cart.
5. Cart review with an admin-configured minimum order.
6. Serviceability, fulfillment, promotion, payment, and order review.
7. Order placement only after every prototype eligibility rule passes.
8. Immutable order history and forward-only tracking.

The prototype remains frontend-only. Mock sign-in and mock payment demonstrate interaction behavior but must be labeled as prototype behavior and must never be mistaken for provider confirmation.

## Source-of-truth boundaries

### Prototype administration configuration

`html/data.js` will expose one `storefrontConfig` object representing values supplied by administration in the production system. At minimum it owns:

- `minimumOrderMinor`;
- `currency`;
- configured service and delivery fees;
- enabled fulfillment modes;
- Instant promise copy when Instant is enabled;
- Scheduled delivery-window copy;
- membership name and monthly price;
- market and customer-facing location copy.

All UI messages and eligibility calculations must read these values. No component may repeat the minimum, percentage, fee, fulfillment promise, or membership price as an unrelated literal.

This configuration is a mock read model, not a second business authority. Production values continue to come from Core.

### Customer state

`html/state.js` owns deterministic prototype state and selectors. It will represent:

- authentication state: `ANONYMOUS` or `SIGNED_IN`;
- a pending sign-in reason after an anonymous add;
- cart lines containing fixed variant and captured preference data;
- selected fulfillment mode and Scheduled window where applicable;
- promotion selection and eligibility;
- address and delivery instructions;
- payment-method placeholder;
- order snapshots and tracking stage;
- current UI feedback and dialog state.

The state module exposes a single checkout-eligibility selector. Cart, checkout, and order placement must all use that selector so the configured minimum and authentication rule cannot diverge between surfaces.

## Authentication interaction

Browsing, searching, category navigation, product inspection, and variant selection remain anonymous.

When an anonymous customer selects Add:

1. The chosen item is added to the cart immediately.
2. The cart count and success announcement update.
3. A sign-in dialog opens and explains that the cart has been saved.
4. Completing mock sign-in changes the state to `SIGNED_IN` and preserves the cart and browsing origin.
5. Dismissing the dialog keeps the item in the cart but leaves checkout blocked with a contextual sign-in action.

Subsequent adds while signed in do not reopen the dialog. Account and checkout entry points require sign-in, but public browsing never does.

## Dynamic minimum-order enforcement

The minimum is read exclusively from `storefrontConfig.minimumOrderMinor`.

The eligibility selector returns structured reasons rather than a Boolean alone, including:

- `SIGN_IN_REQUIRED`;
- `MINIMUM_NOT_MET` with the remaining amount;
- `EMPTY_CART`;
- `ADDRESS_REQUIRED`;
- `FULFILLMENT_REQUIRED`;
- `PAYMENT_REQUIRED`;
- `ELIGIBLE`.

The cart shows progress and the exact remaining amount. Checkout entry is blocked until sign-in and minimum eligibility pass. Place Order is blocked until all checkout requirements pass. Direct navigation to checkout shows recovery actions instead of bypassing the rules. `PLACE_ORDER` defensively rechecks eligibility in state logic even if the UI is manipulated.

## FreshMarkets storefront model

FreshMarkets is the seller. Customers do not choose a store, market hall, or fulfillment hub.

The prototype will remove the multi-store marketplace model. Existing store-card visual compositions may be adapted into customer-facing collections such as Fresh This Week, Produce Essentials, Family Boxes, or Cebu Favorites. The former store-detail route becomes a FreshMarkets shop/collection surface and never changes an internal fulfillment assignment.

The following DoorDash concepts are removed:

- Pickup;
- restaurant/store ratings and review counts;
- generic speed filters such as Under 40 min;
- rider tips;
- DoorDash-red primary actions;
- FreshPass naming;
- selectable stores and saved stores;
- generic cross-store cart language.

Fulfillment uses only configured `INSTANT` and `SCHEDULED` values. The UI must not invent an ETA. When Instant is disabled, it is absent or explicitly unavailable. Scheduled copy comes from configuration and clearly names the delivery window.

## Product and cart behavior

Product cards use image, current price, product name, fixed variant, availability context, and a direct Add control. After adding, the stable Add footprint becomes a minus/count/plus stepper.

Product details preserve:

- selected fixed variant;
- selected freshness preference when the fixture offers one;
- quantity;
- browsing origin.

The preference is stored on the cart line and captured in the order snapshot. Product details close with the close button, Escape, or backdrop and return focus to the opener without discarding category or search context.

The cart drawer is reachable from desktop browsing. Mobile uses a full-height cart surface. The dedicated cart route remains available for deep navigation. Both render from the same cart view function and eligibility selector.

## Checkout behavior

Checkout is a progressive, single-seller summary containing:

1. Signed-in customer identity.
2. Address and mock serviceability confirmation.
3. Configured fulfillment selection.
4. Items, captured variants and preferences, minimum-order status, prices, fees, promotions, and total.
5. Clearly labeled mock payment selection.
6. Commitment notice and Place Order action.

Promotions distinguish selected from eligible. An ineligible promotion remains visible with its unmet requirement and is never announced as applied. Invalid codes keep the dialog open or provide persistent visible error feedback.

Prototype totals use integer minor units. Fee labels and calculations use the same configuration. Unverified tax behavior is not invented; the prototype displays only configured monetary components.

## Orders and tracking

Order placement creates a complete immutable snapshot containing customer-visible product name, image, variant label, preference, unit price, quantity, line total, monetary summary, address, instructions, fulfillment promise, and payment label.

Later catalog fixture changes cannot rewrite the order display. Order identifiers and placed timestamps are generated at placement instead of using one hard-coded value.

The order list provides functional All, Active, and Completed filters. Completed-order actions either work in prototype state or are presented as disabled with an explanation. Adding to a committed order is labeled as a separate add-on/amendment demonstration; it never implies that the paid order is freely editable.

Tracking retains forward-only demonstration controls, a concise timeline, order details, and an optional mock map. Order-list map previews have bounded card dimensions and do not inherit full-screen tracking styles.

## Routing and persistence

Hash routes and in-page sections cannot share ambiguous hashes. Storefront sections use route-aware links or programmatic scrolling without replacing the application route.

Product dialogs retain an encoded return route. Search and category state are restored from the URL into visible controls. Unknown routes render a clear not-found surface rather than silently returning home.

Versioned prototype state is persisted in `localStorage`. Cart, mock sign-in, and the latest order survive refresh. Invalid or older stored shapes fail safely to a new default state. A visible Reset Demo action clears only the prototype state.

## Clickability contract

Every visible interactive affordance must satisfy one of three states:

1. Functional and backed by a state transition or route.
2. Disabled with an accessible explanation that the capability is unavailable in the prototype.
3. Rendered as non-interactive information rather than styled as a button or link.

There will be no inert filters, tabs, address controls, favorites, dismiss buttons, map controls, account actions, help actions, or receipt/reorder actions. Static placeholders are labeled as prototype placeholders and use disabled semantics.

## Full-viewport shell and responsive layout

The global header, sidebar, and main application shell span the full viewport width. The shell must not stop at a `1600px` centered container on fullscreen or ultrawide displays.

Desktop and fullscreen behavior:

- header width is `100vw`;
- sidebar remains pinned to the viewport edge;
- main content consumes all remaining width;
- merchandising rails and grids expand fluidly;
- grids increase column count at wide breakpoints rather than leaving a large empty right margin;
- readable checkout and account forms may retain local content-width constraints without constraining the shell.

Mobile behavior:

- no horizontal document overflow at 320px or wider;
- address and fulfillment context remain visible in compact form;
- bottom navigation does not obscure actionable content;
- cart and dialogs use the available viewport height;
- the currently selected fulfillment option is always visible;
- touch targets are at least 44px where they perform primary actions.

## Accessibility

The corrected prototype includes:

- one primary `main` landmark per screen;
- one visible `h1` per route;
- semantic navigation and section labels;
- dialog initial focus, focus containment, Escape support, backdrop close where safe, and focus restoration;
- background inertness while a modal is open;
- repeated live announcements, including identical consecutive cart actions;
- persistent visible errors in addition to live-region output;
- non-color status cues;
- WCAG AA contrast for normal text;
- keyboard access to every functional control;
- reduced-motion behavior.

## File boundaries

The correction keeps the prototype framework-free while reducing responsibility concentration:

- `html/data.js`: fixtures and administration-shaped storefront configuration.
- `html/state.js`: state creation, validation, persistence-friendly shape, reducers, snapshots, totals, and eligibility selectors.
- `html/router.js`: route parsing, return-route encoding, and section navigation helpers.
- `html/views.js`: pure HTML render functions and accessible component compositions.
- `html/app.js`: browser event wiring, focus management, persistence, and rendering orchestration.
- `html/styles.css`: full-viewport shell, components, states, accessibility, and responsive rules.
- `html/state.test.cjs`: state/domain regression tests.
- `html/router.test.cjs`: routing regression tests.
- `html/prototype.spec.cjs`: browser-level customer-journey and responsive tests.

If browser-test runtime constraints make `.cjs` unsuitable, only the browser-test extension may change; the coverage requirements do not.

## Test-first acceptance criteria

State and routing tests must prove:

- the minimum comes from configuration and cannot be bypassed through direct dispatch;
- an anonymous Add stores the item and requests sign-in;
- sign-in preserves the cart;
- checkout reasons are consistent across cart and commitment;
- selected preferences survive cart and order placement;
- promotion eligibility and visible reasons are correct;
- order snapshots remain unchanged after catalog fixture mutation;
- route-aware section navigation stays on the shop route;
- product close returns to its origin;
- persisted-state validation fails safely.

Browser tests must prove at desktop, mobile, and fullscreen widths:

- public browsing and search work without sign-in;
- Add opens sign-in after preserving the item;
- below-minimum checkout and Place Order remain blocked;
- reaching the configured minimum unlocks the next valid step;
- every intended customer-journey control works or is disabled with an explanation;
- dialogs meet keyboard and focus requirements;
- the complete sign-in, cart, checkout, order, tracking, and completion journey works;
- no route has horizontal document overflow;
- the shell consumes the full viewport at 1920px and an ultrawide breakpoint;
- order-list map previews remain bounded;
- refresh restores cart and latest order state;
- browser console output has no errors.

All JavaScript syntax checks, Node tests, browser tests, asset validation, and `git diff --check` must pass.

## Mobbin comparison and final audit

After functional verification, use Mobbin MCP to inspect current rendered DoorDash web and iOS grocery references for:

- global shell and full-width behavior;
- search and address hierarchy;
- category density;
- promotion restraint;
- product-card scan order;
- cart presentation;
- checkout progression;
- mobile bottom navigation;
- order status hierarchy.

The audit records patterns adopted, FreshMarkets-specific adaptations, and rejected DoorDash assumptions. It must not reintroduce stores, Pickup, ratings, tips, generic ETAs, red branding, or DashPass-like naming.

## Out of scope

- Core, D1, database migrations, service bindings, or production RPCs.
- Real authentication, payment, geocoding, serviceability, inventory, capacity, or provider calls.
- Changes to production business rules.
- Publishing or deploying the prototype.
