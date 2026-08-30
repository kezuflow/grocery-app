# Customer MVP Completion Baseline

Date: 2026-08-30

## Integrated starting point

- Local work is isolated in the protective detached worktree at
  `5f0081d796109997ddfb09a32f6aadb611ecfd9b`; `origin/main` resolves to the same commit.
- Programs 1–3, the Admin dashboard, and the Maps address/dispatch/rider work are integrated.
- The Maps confirmed-address contract is the only Maps surface consumed by this program. Maps and
  Admin UI, domain behavior, and their read models are not being redesigned.
- The repository was clean before this report was created.
- The next and only planned migration for this program is
  `apps/core/migrations/0047_customer_mvp_completion.sql`. Migrations `0001` through `0046` are
  already occupied; committed migrations will not be renumbered or edited.
- Protected migration blobs remain exact: Admin 0041
  `9b18c5788eec5a0954097cd564712f15966bcd61`, Maps 0042
  `e9651fc4f4778eac1cc78c8863b24b7e4ebb8ab3`, and Maps 0043
  `1f7a1df387f8ff634e6b36a44f042b9081b931f0`.

## Existing customer binding surface

The landed Core binding exposes these customer/public application methods:

- Identity/context: `auth`, `getApplicationContext`.
- Marketplace/geography: `resolveServiceability`, `searchAddressCandidates`, `searchCatalog`,
  `getMarketplaceHome`, `getCatalogProduct`, and `listCategories`.
- Saved addresses: `createCustomerAddress`, `listCustomerAddresses`, and
  `updateCustomerAddress`.
- Membership/authorization: `startTrial`, `beginRecurringAuthorization`,
  `completeRecurringAuthorization`, and `getSubscriptionEligibility`.
- Fulfillment/cart/checkout: `listDeliveryCycles`, `getCart`, `setCartItem`,
  `evaluateCheckout`, `createCheckoutQuote`, `refreshCheckoutQuote`, and
  `createPaymentIntent`.
- Orders: `listCustomerOrders`.
- Rider methods are authenticated operational surfaces, not customer commerce methods.

The target Membership contract already declares `getSubscriptionSummary`, `getOffer`,
`beginPaidEnrollment`, `pauseSubscription`, `resumeSubscription`, and `cancelSubscription`, but
`ImplementedCoreService`, the runtime manifest, and the Core entrypoint intentionally do not yet
implement them. There is no composed Core-owned `MembershipExperienceView` yet.

## Landed address boundary

The customer address boundary carries provider-neutral structured fields:

- exact `latitude`/`longitude` and coordinate provenance `GEOCODER`, `USER_PIN`, or
  `DEVICE_LOCATION`;
- structured components (`addressLine1`, optional line 2/barangay/region/postal code, city, and
  country code) with independent provenance `TEMPORARY_GEOCODER`, `FIRST_PARTY`, or
  `SAVED_ADDRESS`;
- structured delivery instructions (`buildingUnit`, `landmark`, `gateGuard`, `deliveryNote`, and
  `recipientInstruction`);
- customer label, recipient, phone, optional notes, confirmation time, optimistic version, and
  Core-owned serviceability outcome/reason.

Temporary geocoder candidates remain session-scoped. Core performs permanent provider
finalization before persistence and re-resolves serviceability; customer input never selects a
fulfillment location.

## Persistence seams available before migration 0047

- Checkout: `checkout_attempts`, `checkout_quote_snapshots`, canonical `checkout_quote`, and
  Instant `checkout_inventory_holds`. Migration 0044 added explicit merchandise, item/order
  discount, delivery subtotal/discount, service fee, and tax components plus accepted-Quote
  identity and durable provider actions.
- Promotions: definition/benefit/rule administration plus `promotion_grant` and
  `promotion_redemption`. The quote tables have promotion snapshot JSON, but order-quote
  evaluation and exact-once paid commitment redemption are not yet a complete customer flow.
- Orders: `grocery_order`, immutable `order_item`, `order_fulfillment_snapshot`,
  `order_payment_reaction`, and `order_amendment`. Customer output is currently only a compact
  list; no ownership-scoped detail/timeline contract exists.
- Amendments: the domain and application seams exist, including Scheduled cutoff checks and
  payment-reaction support, but there is no complete customer contract/route/page journey and
  Instant customer amendments must remain unavailable.
- Issues: `order_issue` and Admin issue reads/actions exist. There is no customer-owned create/list
  issue command; issue intake must never authorize a refund or credit.
- Cancellation: internal/Admin committed-order cancellation exists. It is not customer authority.
  The customer program may expose only pre-commit quote/attempt abandonment.
- Notifications and invoice readiness: neither has its canonical program persistence yet; these
  are owned by migration 0047.

## Scheduled execution

The explicit registry currently dispatches:

- every minute: checkout-hold expiry, scheduled Membership cancellation, Membership renewal
  lifecycle processing, provider-action expiry, and delivery-cycle cutoff;
- every fifteen minutes: delivery-cycle closeout, payment-reaction redrive, payment
  reconciliation redrive, and provider-inbox redrive.

Cron owns no domain state. Customer completion will add notification scheduling/delivery through
the same registry while keeping notification failure independent from authoritative outcomes.

## Existing customer Web surfaces

- Pages: `/account`, `/account/addresses`, `/cart`, `/checkout`, and `/orders`.
- Thin customer routes: `/api/membership`, membership authorization start/complete,
  `/api/commerce/trial`, cart, checkout, quote/payment, cycles, orders, address search, and saved
  address create/update/list.
- Missing customer surfaces: Membership lifecycle actions, order detail/timeline, reorder,
  issue intake/status, checkout abandonment, paid amendment flow, and fulfillment-options query.

## Executable baseline

The post-integration baseline was rerun from the clean worktree:

- architecture, naming, and migration verification: passed;
- TypeScript checks: passed in all six executable workspaces;
- tests: 1,260 passed across 197 files — config 2, contracts 59, domain-shared 2,
  validation 2, Web 453 across 52 files, and Core 742 across 125 files;
- production dry-run builds: Core Wrangler and Web vinext passed;
- vinext build inventory includes the existing customer pages and thin routes above;
- the existing build-only advisory is a Web chunk-size optimization warning, not a failed gate;
- the landed deterministic Playwright evidence remains 78 passes with one established Rider
  authentication-email skip, followed by passing nonce-CSP storefront, Admin, and
  Maps/serviceability representatives.

This baseline authorizes Customer MVP completion only. Any new contract or schema must preserve
Core authority, ownership scoping, explicit monetary components, current-state reorder semantics,
fail-closed policy gaps, stable idempotency, and optimistic concurrency.
