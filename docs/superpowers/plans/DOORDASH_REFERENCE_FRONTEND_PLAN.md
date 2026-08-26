# DoorDash Reference Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (recommended) or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a working FreshMarkets customer-facing frontend prototype that follows the researched DoorDash browse, cart, checkout, and delivery-tracking interaction model using local mock data and client state only.

**Architecture:** Add a prototype-only client state provider and fixture layer inside `apps/web`. Replace the customer-facing route compositions with reusable storefront shell/components and route-level mock views; leave `apps/core`, shared contracts, APIs, migrations, auth, and payment integration unchanged. Preserve the existing checkout page in a separate reference file because the current worktree contains unrelated uncommitted backend-connected changes.

**Tech Stack:** React 19, vinext, Tailwind CSS 4, Lucide React, Vitest, Playwright, existing produce assets in `apps/web/public/produce`.

**Spec:** `docs/design/marketplace/STOREFRONT_DESIGN.md`

## Global Constraints

- Use DoorDash Mobbin references for interaction hierarchy and composition, not DoorDash trademarks, logos, proprietary images, or copied marketing copy.
- Use FreshMarkets green/lime tokens and existing produce imagery.
- Keep all prototype data, cart mutation, checkout, place-order, and order-lifecycle transitions local to `apps/web`.
- Do not modify Core, APIs, migrations, shared contracts, authentication architecture, payment architecture, inventory, procurement, fulfillment, or delivery services.
- Customers never select a fulfillment hub; present only customer-facing delivery mode and promise copy.
- Keep fixed sellable variants such as `250 g`, `500 g`, `1 kg`, and `1 piece`; do not introduce arbitrary-weight input.
- Preserve responsive desktop sidebar/header and mobile bottom-navigation behavior.

### Task 1: Prototype state and fixtures

**Files:**
- Create: `apps/web/lib/prototype/fixtures.ts`
- Create: `apps/web/lib/prototype/state.tsx`
- Create: `apps/web/lib/prototype/selectors.ts`
- Test: `apps/web/lib/prototype/state.test.ts`

**Interfaces:**
- `PrototypeProduct`, `PrototypeStore`, `PrototypeCartItem`, `PrototypePromotion`, `PrototypeOrder`, `DeliveryStage`.
- `PrototypeProvider` and `usePrototype()` expose products, stores, cart, fulfillment mode, checkout values, order, and actions `addItem`, `updateQuantity`, `removeItem`, `setFulfillmentMode`, `applyPromotion`, `placeOrder`, and `advanceOrder`.
- Selector functions calculate cart count, subtotal, savings, delivery fee, service fee, tax, tip, and total in integer minor units.

- [ ] Write failing tests for cart quantity changes, promotion application, total calculation, order creation, and legal forward-only lifecycle advancement.
- [ ] Run `pnpm --filter @freshmarkets/web test -- lib/prototype/state.test.ts` and confirm the new tests fail because the prototype module does not exist.
- [ ] Implement fixtures using the existing `/produce/*.webp` library and local mock stores, address, delivery promise, promotions, payment method, rider, and route markers.
- [ ] Run the focused test again and confirm it passes.
- [ ] Commit only the prototype state/fixture files and tests.

### Task 2: Shared shell and commerce primitives

**Files:**
- Create: `apps/web/components/prototype/PrototypeApp.tsx`
- Create: `apps/web/components/prototype/StorefrontShell.tsx`
- Create: `apps/web/components/prototype/CommercePrimitives.tsx`
- Create: `apps/web/components/prototype/MapSurface.tsx`
- Modify: `apps/web/app/layout.tsx`
- Modify: `apps/web/app/globals.css`
- Test: `apps/web/lib/prototype/state.test.ts` plus Playwright shell assertions in `apps/web/tests/customer-journey.spec.ts`

**Interfaces:**
- `PrototypeApp` wraps route content with `PrototypeProvider`.
- `StorefrontShell` accepts `activeNav`, `children`, and renders responsive header, sidebar, mobile navigation, cart affordance, account affordance, and optional cart drawer.
- `ProductCard`, `QuantityStepper`, `PromoBanner`, `FilterChip`, `SectionHeader`, `ProductDialog`, `CartDrawer`, `CheckoutSummary`, `OrderStatusTimeline`, and `MapSurface` use prototype types only.

- [ ] Add failing browser assertions for visible desktop sidebar/header, mobile bottom navigation, and cart badge.
- [ ] Run the focused Playwright test and confirm failure against the current shell.
- [ ] Implement the responsive shell and reusable primitives using existing tokens and Lucide icons.
- [ ] Implement `MapSurface` as an original CSS map-like surface with markers, route line, zoom controls, and status legend; no external map provider.
- [ ] Run the focused browser assertions and confirm they pass.
- [ ] Commit the shared prototype UI.

### Task 3: Marketplace, store, product, and cart routes

**Files:**
- Modify: `apps/web/app/page.tsx`
- Create: `apps/web/app/stores/[slug]/page.tsx`
- Modify: `apps/web/app/products/[slug]/page.tsx`
- Modify: `apps/web/app/products/[slug]/product-view.tsx`
- Modify: `apps/web/app/cart/page.tsx`
- Create: `apps/web/app/prototype-routes.tsx`
- Test: `apps/web/tests/customer-journey.spec.ts`

**Interfaces:**
- Marketplace route renders category rail, filters, promo modules, store/product rails, and local product cards.
- Store route renders store hero, metadata, delivery mode, mocked map, deals, category rail, and product grid.
- Product route renders a route-compatible responsive modal/sheet with fixed variant cards, optional produce preference, recommendations, and add CTA.
- Cart route renders editable items, minimum-order progress, savings, fees, and checkout CTA.

- [ ] Add failing journey tests for browse -> store -> product -> add -> cart -> quantity update -> remove.
- [ ] Run the journey test and confirm it fails on the current API-backed flow.
- [ ] Implement local route compositions and interactions without fetching Core/catalog APIs.
- [ ] Keep current API-backed checkout code copied to `apps/web/app/checkout/core-checkout-page.tsx` for later integration reference; do not delete or alter the user’s existing uncommitted backend work without inspection.
- [ ] Run desktop and mobile journey tests and confirm they pass.
- [ ] Commit the customer browse/cart routes.

### Task 4: Checkout, order confirmation, tracking, account, and orders

**Files:**
- Modify: `apps/web/app/checkout/page.tsx`
- Create: `apps/web/app/orders/[id]/page.tsx`
- Create: `apps/web/app/orders/[id]/order-tracking.tsx`
- Modify: `apps/web/app/orders/page.tsx`
- Modify: `apps/web/app/account/page.tsx`
- Modify: `apps/web/app/layout.tsx`
- Test: `apps/web/tests/customer-journey.spec.ts`

**Interfaces:**
- Checkout owns local address/instruction fields, delivery-vs-scheduled controls, promotion modal, payment selector, tip selector, order summary, and `placeOrder()`.
- Order tracking renders the map/sidebar split on desktop and map-plus-bottom-sheet on mobile. `advanceOrder()` changes the visible stage from `PLACED` through `COMPLETE`.
- Orders renders active order card plus completed order card; Account renders account menu and saved-context links.

- [ ] Add failing tests for checkout mode selection, promo apply, fake payment selection, place-order navigation, and each order stage label.
- [ ] Run focused tests and confirm failure before implementation.
- [ ] Implement checkout and confirmation with no network requests or payment side effects.
- [ ] Implement order tracking controls for manual stage advancement, rider contact affordances, order details expansion, and completion state.
- [ ] Implement account/orders navigation and active/completed order presentation.
- [ ] Run the full customer journey on desktop and mobile and confirm it passes.
- [ ] Commit checkout and order surfaces.

### Task 5: Verification and visual review

**Files:**
- Modify as needed: files from Tasks 2-4 only
- Test: `apps/web/tests/customer-journey.spec.ts`

- [ ] Run `pnpm --filter @freshmarkets/web typecheck`.
- [ ] Run `pnpm --filter @freshmarkets/web test`.
- [ ] Run `pnpm --filter @freshmarkets/web check:vinext`.
- [ ] Run `pnpm --filter @freshmarkets/web build`.
- [ ] Start the web dev server and run Playwright at desktop and mobile viewports through the full journey.
- [ ] Compare marketplace, store, product dialog, checkout, and tracking screenshots with the Mobbin references recorded in `STOREFRONT_DESIGN.md`; correct obvious density, spacing, hierarchy, and responsive issues.
- [ ] Run `git diff --check` and inspect `git status --short` to confirm only intended `apps/web` and plan files changed.
- [ ] Request a final code review before claiming completion.

