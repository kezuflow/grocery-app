# FreshMarkets Web Storefront Mobbin Audit

Date: 2026-08-27

Scope: React/vinext storefront rebuild in `apps/web`. The standalone `html/` prototype is not part of this implementation.

## References inspected

- [DoorDash web grocery storefront](https://mobbin.com/screens/ff19ea99-2137-4671-82aa-04c7fe42c51a): dense product grid, persistent left navigation, search/address context, and stable Add controls.
- [DoorDash iOS checkout summary](https://mobbin.com/screens/d500450a-873c-4ef2-a2a5-49ad7d076d63): vertically ordered summary, promotion entry, payment row, and a clear commitment action.
- [DoorDash iOS order tracking](https://mobbin.com/screens/ff4f8e5c-ccb3-4815-88ab-ef293d195766): status-first tracking, map context, order details disclosure, and add-items affordance.

## Decisions

### Adopted

- Product cards lead with image, price, pack/unit, availability, and a stable Add footprint.
- Search and delivery-address context stay in the global header.
- Desktop keeps a persistent navigation rail; mobile keeps a compact bottom navigation with touch-sized targets.
- Checkout is a deliberate progression from address and fulfillment context through quote/payment readiness to one commitment action.
- Tracking places the current status before secondary details and keeps order details available without losing the status context.

### Adapted for FreshMarkets

- The web grid and rails expand to the viewport instead of retaining a centered 1,440/1,600px shell.
- “Store” language becomes FreshMarkets single-seller grocery language; catalog, location, and fulfillment are not customer-selectable hubs.
- Add-to-cart remains public. If Core reports `UNAUTHENTICATED`, the browser stores a versioned guest line, updates the cart count, and offers sign-in with a return path. Sign-in is required before checkout/cart merge.
- Checkout copy states that minimum order, price, availability, serviceability, fees, subscription entitlement, and payment readiness are revalidated from Core. No frontend literal claims to be the minimum authority.
- Tracking preserves FreshMarkets order semantics and labels any future add-on as a separate transaction rather than silently editing a committed order.

### Rejected

- Pickup and restaurant/store switching: FreshMarkets sells from one resolved fulfillment context; customers never choose a hub.
- Restaurant ratings, review counts, rider tips, cross-store carts, and generic speed filters: these are not FreshMarkets MVP concepts.
- DoorDash red, DashPass/FreshPass naming, or copied brand assets: FreshMarkets keeps its own lime/green visual language and membership wording.
- Fabricated taxes, generic ETAs, or a hardcoded ₱500 minimum: current values are configuration/Core read-model concerns and must remain authoritative there.

## Verification notes

- Web unit tests: 44 passing after the guest-cart regression and consumer updates.
- TypeScript: `tsc --noEmit` passes for `apps/web`.
- Vinext build: completes with exit code 0. Wrangler emits an environment-specific log-file permission warning while still completing the build.
- Playwright: the existing suite is environment-safe and skips when the local web/core stack is not running; the new storefront assertions replace the old “auth before add” expectation.
