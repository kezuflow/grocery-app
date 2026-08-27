# DoorDash-Fidelity Storefront Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recompose the FreshMarkets storefront to closely match DoorDash’s storefront layout, density, and interaction hierarchy while retaining FreshMarkets branding, grocery semantics, and Core-authoritative commerce rules.

**Architecture:** Keep the existing vinext/React surface and typed Core calls. Add shared client presentation primitives for the cart drawer and checkout summaries, then reuse the existing catalog/cart/cycle APIs in the home, cart, and checkout routes. No new public service, database table, or payment behavior is introduced.

**Tech Stack:** React 19, vinext, Tailwind CSS 4, Lucide React, Vitest, Playwright.

**Spec:** `docs/design/marketplace/STOREFRONT_DESIGN.md`

## Global Constraints

- Keep FreshMarkets lime/deep-green tokens and original assets; do not copy DoorDash logos, proprietary artwork, or branded text.
- Browsing remains public; anonymous add-to-cart remains supported; sign-in is required before checkout.
- Core remains authoritative for cart, pricing, minimum order, serviceability, subscription eligibility, delivery cycles, and payment readiness.
- Preserve fixed sellable variants and current `/api/commerce/cart`, `/api/commerce/cycles`, `/api/commerce/address`, `/api/commerce/checkout`, `/api/checkout/quote`, and `/api/checkout/payment` contracts.
- Keep the desktop shell full-width with a persistent left rail; mobile uses a first-class bottom navigation and touch targets of at least 44px.
- Use TDD for new presentation helpers and interaction behavior; run the full verification suite before completion.

### Task 1: Shared DoorDash-style navigation and visual primitives

**Files:**
- Modify: `apps/web/components/storefront/storefront-shell.tsx`
- Modify: `apps/web/app/globals.css`
- Create: `apps/web/components/storefront/marketplace/category-strip.tsx`
- Create: `apps/web/components/storefront/marketplace/storefront-navigation.ts`
- Test: `apps/web/components/storefront/marketplace/storefront-navigation.test.ts`

**Interfaces:**
- `storefrontNavigation` exposes `{ label, href, icon, tone }` records for desktop, mobile, and home category presentation.
- `CategoryStrip` consumes the navigation records and renders keyboard-accessible icon-led links with active state.

- [x] **Step 1: Write the failing navigation metadata test.** Assert every shopping destination has a stable href, icon component, and non-empty tone token.
- [x] **Step 2: Run the focused test and confirm it fails because the shared metadata module is missing.**
- [x] **Step 3: Add the shared navigation metadata and category strip.** Replace sidebar bullets with icons, add a compact “Shop” grouping, and preserve the existing route/query targets.
- [x] **Step 4: Run the focused test and confirm it passes.**
- [x] **Step 5: Update shell markup.** Keep the sticky header/search/address/cart geometry, render the icon-led category strip on the home surface, use `min-h-[100dvh]` for shell-level viewport behavior, and keep mobile navigation visible without squeezing the desktop rail.
- [x] **Step 6: Run the web typecheck and lint for the touched files.**

### Task 2: Recompose the DoorDash-style home discovery surface

**Files:**
- Modify: `apps/web/app/page.tsx`
- Modify: `apps/web/components/storefront/marketplace/marketplace-hero.tsx`
- Modify: `apps/web/components/storefront/marketplace/promo-banners.tsx`
- Modify: `apps/web/components/storefront/catalog-components.tsx`
- Modify: `apps/web/tests/storefront-home.spec.ts`

**Interfaces:**
- Home continues to consume the existing catalog/category read models and `PresentationProduct` shape.
- Product cards continue to use `AddToCartButton` and `QuickViewProvider`; no local price or eligibility decisions are added.

- [x] **Step 1: Add failing Playwright assertions for icon-led categories, a single compact promo band, and the first product rail appearing before the membership strip.**
- [x] **Step 2: Run the focused Playwright spec against the local stack and confirm the new assertions fail against the current composition.**
- [x] **Step 3: Replace the long hero paragraph with a compact service-context block, render the shared icon-led categories, add a short Fresh This Week promo band, and move membership messaging to a quieter strip after the rails.**
- [x] **Step 4: Tighten product rail/card spacing and add explicit image/variant/price/availability hierarchy without adding fake controls.**
- [x] **Step 5: Run the focused Playwright spec and confirm it passes.**
- [x] **Step 6: Check the mobile layout at 390px and preserve a two-column product grid or horizontal rail with the product content visible early in the scroll.**

### Task 3: Add a persistent cart drawer and shared order summary

**Files:**
- Modify: `apps/web/lib/storefront/cart-client.ts`
- Modify: `apps/web/components/storefront/marketplace/cart-indicator.tsx`
- Create: `apps/web/components/storefront/marketplace/cart-drawer.tsx`
- Create: `apps/web/components/storefront/marketplace/order-summary.tsx`
- Test: `apps/web/lib/storefront/cart-client.test.ts`

**Interfaces:**
- `CART_DRAWER_REQUEST_EVENT` opens the drawer without removing the `/cart` route fallback.
- `OrderSummary` accepts `{ cart, actionLabel, actionHref, disabled?, note? }` and never calculates authoritative pricing beyond the supplied `CartView` totals.

- [x] **Step 1: Write failing cart-client tests for the drawer request event constant and cart count behavior used by the drawer.**
- [x] **Step 2: Run the focused Vitest file and confirm the new assertions fail.**
- [x] **Step 3: Add the event constant and implement the right-side desktop drawer/full-screen mobile sheet.** Fetch the current cart on open, show loading/empty/error states, render item steppers, preserve guest cart state, and link guests to sign-in before checkout.
- [x] **Step 4: Add `OrderSummary` with subtotal/total and an explicit “minimum order checked at checkout” notice; do not hardcode a threshold that is not present in the current contract.**
- [x] **Step 5: Make the header cart control open the drawer while retaining a real `/cart` href for no-JS and deep-link behavior.**
- [x] **Step 6: Run the focused Vitest file and confirm it passes.**

### Task 4: Rebuild the cart route around the new visual language

**Files:**
- Modify: `apps/web/app/cart/page.tsx`
- Modify: `apps/web/tests/storefront-home.spec.ts`

**Interfaces:**
- Keep `fetchCart`, `addToCart`, and `CartView` as the data boundary.
- Reuse `OrderSummary` for the desktop summary rail and mobile sticky action.

- [x] **Step 1: Add a failing route assertion for an order-summary landmark, a compact empty-cart state, and the guest sign-in CTA.**
- [x] **Step 2: Run the focused Playwright test and confirm it fails against the old utility layout.**
- [x] **Step 3: Implement a responsive two-column cart: item list with product thumbnails/steppers on the left, sticky summary on the right, compact minimum-order/serviceability note, and a mobile bottom action.**
- [x] **Step 4: Preserve empty, loading, mutation-error, and guest-cart states with customer-facing copy.**
- [x] **Step 5: Run the focused Playwright test and confirm it passes.**

### Task 5: Rebuild checkout as a DoorDash-style progressive commitment flow

**Files:**
- Modify: `apps/web/app/checkout/page.tsx`
- Modify: `apps/web/tests/storefront-home.spec.ts`

**Interfaces:**
- Preserve all existing Core-backed handlers and payloads: address creation, cycle loading, eligibility evaluation, quote creation, and payment intent creation.
- Reuse `OrderSummary` with the current cart/quote values; browser state never asserts payment success.

- [x] **Step 1: Add failing route assertions for numbered delivery/address/cycle sections, a sticky order summary, and the sign-in gate for a guest cart.**
- [x] **Step 2: Run the focused Playwright test and confirm it fails against the old single-column utility form.**
- [x] **Step 3: Implement the responsive two-column checkout with clear section cards, delivery-cycle cards, quote status, and one primary lime commitment action.**
- [x] **Step 4: Keep Core error codes visible as actionable customer copy, including dynamic minimum-order failure wording and cycle/address failures.**
- [x] **Step 5: Run the focused Playwright test and confirm it passes.**

### Task 6: Verify, document, and audit the visual pass

**Files:**
- Modify: `docs/design/marketplace/STOREFRONT_DESIGN.md` only if the implemented component inventory or approved visual decision changes.
- Modify: `docs/design/marketplace/REFERENCES.md` only if the Mobbin audit adds a new reference decision.

- [x] **Step 1: Run focused web unit tests and route tests.**
- [x] **Step 2: Run `pnpm check` and record any pre-existing warnings separately from regressions.**
- [x] **Step 3: Start the local Web/Core stack if needed and validate the home, drawer, cart, checkout, guest add-to-cart, sign-in boundary, and empty states at desktop and mobile viewports.**
- [x] **Step 4: Re-run Mobbin MCP searches for DoorDash home, grocery detail, cart, checkout, and mobile cart; inspect the returned images and compare spacing, density, hierarchy, and CTA placement.**
- [x] **Step 5: Run `git diff --check`, `git status`, and the final verification commands before making any completion or commit claim.**
