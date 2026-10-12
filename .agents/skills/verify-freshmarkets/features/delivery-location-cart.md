# Delivery location and cart carryover

Customers confirm a delivery entrance, add a fixed pack to a guest cart, and sign in without losing or duplicating their items after a lost response.

## Sub-features

- `location-first-visit` offers location selection while showing unpriced discovery.
- `location-confirm` commits a confirmed location only after Core succeeds.
- `guest-cart` retains chosen variant and quantity through reload.
- `cart-carryover` merges guest items once after authentication and response recovery.

## How to get to it (user POV)

- Open the storefront and choose Set delivery location.
- Open `/products/red-onion` and choose Set delivery location.
- Visit `/cart` and choose Sign in to checkout.

## Driving it with Playwright

Preconditions:

- Use a new managed E2E state at port 3100. The authenticated fixture fixes its cookie origin to that port.
- This recipe uses synthetic local Admin/customer fixtures and a mocked Maps search result. It is unexecuted in this task.

- Run `pnpm --filter @freshmarkets/web exec playwright test tests/e2e/first-visit-cart.spec.ts --grep 'first visit, remembered location and guest carryover at 390px' --trace on`.
- Choose `page.getByRole('button', { name: 'Set delivery location', exact: true }).last()` on the product page. Select Choose map, fill the textbox matching `^Search for an address`, and choose the synthetic result.
- Click `locationDialog.getByRole('button', { name: 'Deliver here', exact: true })`. On the injected lost response, require the confirmation alert and no remembered location. Retry and require confirmed display text and the HTTP-only browsing cookie.
- Check the radio matching `500 g`, click Increase quantity, then Add to cart. Visit `/cart`, reload, and require Sign in to checkout.
- Authenticate through dialog `Checkout authentication`, using its Email and Password labels. On the lost merge response, require Retry loading cart, retry, and require the Checkout link.
- Preserve the trace, user-visible outcomes, and the spec's read-only `/api/commerce/cart` assertion. The fixture expects `Red onion · 500 g`, quantity 5, unit price 125, and line total 625 after combining its arranged cart with the user-added items. Require cleared guest-cart storage and identical retry bodies.

## Gotchas

- Fixture setup changes synthetic prices and Instant configuration in disposable state. These writes are setup, not the user journey under verification.
- Maps candidates are simulated at the external boundary. This does not prove actual Maps availability or geocoding.
- The fixture's auth email adapter is local no-op. This does not prove delivered email or provider acceptance.
- Repeat the desktop test separately when the changed behavior affects both viewports.
