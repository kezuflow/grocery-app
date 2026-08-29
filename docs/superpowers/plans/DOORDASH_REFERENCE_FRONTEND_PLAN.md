# DoorDash Reference HTML5 Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a self-contained FreshMarkets HTML5 prototype that reconstructs the researched DoorDash customer journey from marketplace discovery through completed delivery.

**Architecture:** Implement a responsive hash-routed single-page application in `html/` using plain HTML, CSS, and JavaScript. Copy selected existing produce images into `html/assets/produce`, keep all cart/checkout/order behavior in local browser state, and make no changes to backend code, contracts, APIs, migrations, authentication, payments, inventory, or delivery services.

**Tech Stack:** HTML5, CSS3, vanilla JavaScript, browser local state, Node built-in tests, existing produce WebP assets.

**Spec:** `docs/design/marketplace/STOREFRONT_DESIGN.md`

## Global Constraints

- Use Mobbin-rendered DoorDash screens as the composition and interaction reference.
- Do not use DoorDash logos, trademarks, proprietary imagery, or copied long-form marketing copy.
- Use FreshMarkets green/lime brand tokens and the repository's existing produce images.
- Provide a working path: Marketplace -> Store -> Product -> Cart -> Checkout -> Place Order -> Tracking -> Delivered/Complete.
- Use fixed variants such as `250 g`, `500 g`, `1 kg`, `piece`, and `pack`; do not add arbitrary-weight input.
- Keep the prototype fully frontend-only with mock data and client state.
- Customers never choose an internal fulfillment hub.

### Task 1: State engine and fixtures

- [ ] Add failing Node tests for cart mutation, promotion eligibility, checkout totals, order snapshot creation, and forward-only delivery stages.
- [ ] Run the tests and confirm they fail before implementation.
- [ ] Create `html/data.js` and `html/state.js` using selected assets from `apps/web/public/produce`.
- [ ] Re-run tests and confirm they pass.

### Task 2: Shell and discovery screens

- [ ] Create `html/index.html`, `html/styles.css`, and `html/app.js`.
- [ ] Build persistent desktop sidebar/header and mobile bottom navigation.
- [ ] Build marketplace categories, filters, promo banners, store cards, and product rails.
- [ ] Build store hero, metadata, delivery controls, map module, deals, sticky categories, and product grids.

### Task 3: Product, cart, and checkout

- [ ] Build responsive product modal/sheet with media, variants, produce preferences, quantity, recommendations, and sticky Add CTA.
- [ ] Build cart drawer/page with quantity controls, removal, savings, minimum order, fees, and checkout CTA.
- [ ] Build DoorDash-style desktop two-column checkout and mobile single-column checkout with address, delivery timing, promotions, payment, tip, summary, and Place Order.

### Task 4: Orders, tracking, and account

- [ ] Build active/completed order list and order details.
- [ ] Build map-heavy tracking with manual lifecycle advancement from placed through complete.
- [ ] Build rider information, contact affordances, ETA, item details, receipt, and completion actions.
- [ ] Build account navigation, saved address/payment placeholders, favorites, and membership savings presentation.

### Task 5: Verification and visual review

- [ ] Run Node state tests.
- [ ] Serve `html/` locally and exercise the complete journey in desktop and mobile viewports.
- [ ] Capture screenshots for marketplace, store, product, cart, checkout, tracking, and completion.
- [ ] Compare the captures against the Mobbin references and correct obvious spacing, density, hierarchy, and responsive differences.
- [ ] Run `git diff --check` and verify no backend files were modified by this task.
