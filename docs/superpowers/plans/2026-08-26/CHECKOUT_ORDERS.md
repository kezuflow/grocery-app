# Checkout and Orders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace mock checkout with authoritative, versioned quoting and provider-confirmed order commitment while preserving immutable commercial and fulfillment snapshots, additive amendments, and explicit recovery paths.

**Architecture:** Checkout validates eligibility and produces a short-lived immutable quote in Core. Payments owns payment commitment and emits a durable canonical reaction. Orders consumes that reaction idempotently and atomically records the paid order, snapshots, capacity commitment, and the correct stocked-reservation or planned-procurement demand. Web never declares payment or order success from browser state.

**Tech Stack:** Cloudflare D1 transactions, TypeScript, Zod, shared typed Service Binding contracts, Vitest Workers pool, Playwright.

**Spec:** `docs/architecture/DOMAIN_MODEL.md` Checkout and Orders; `docs/architecture/STATE_MACHINES.md` Order and Payment; `docs/architecture/DATA_MODEL.md` Carts, Checkout, Orders, Amendments, Capacity, and Inventory; `docs/architecture/API_CONTRACTS.md` Checkout and Order commands; `docs/product/PRODUCT_SCOPE.md` checkout acceptance criteria.

## Global Constraints

- Priority: P1 domain correctness with P0 financial boundaries.
- Depends on Plans 03 through 06; migration `0017` must be the latest accepted migration.
- Creates additive migration `0018_checkout_orders.sql`; never reuse or edit the rejected draft `0015`.
- A customer must be `ACTIVE` or `TRIALING` at quote creation and again at payment/order commitment.
- Canonical Payments `SUCCEEDED` is the MVP commitment policy. Vendor-specific states stay behind Payments adapters.
- Payment success locks the commercial order. Post-payment additions are additive amendments with independent quotes, payment intents, snapshots, and histories.
- Cycle cutoff is the operational/procurement commitment boundary.
- Stocked inventory reservations and planned-procurement demand are separate records and algorithms.
- Every client/admin command uses a stable idempotency key and an expected aggregate version when concurrent mutation is possible. Provider-originated processing never invents expected versions.
- No task in this plan may fabricate payment success, silently compensate a paid order, or choose unresolved financial recovery policy.

---

## Dependencies and Decision Blockers

- The production payment provider does not block this plan because Checkout and Orders consume canonical Payments ports and the test fake adapter only.
- The paid-success/downstream-failure policy blocks automatic refund versus guaranteed-retry selection. Implement durable reaction failure, a finance exception read model, and manual retry/reconciliation; do not automate either outcome until approved.
- Dunning/grace does not block a fresh checkout attempt; it only affects later Membership renewal behavior.
- Membership cancellation default does not block checkout. Eligibility is based on effective canonical membership state at each boundary.
- Post-clamp recurring billing anchor does not block a current-period checkout.

## Migration and Compatibility Impact

- Create: `apps/core/migrations/0018_checkout_orders.sql`.
- Extend current cart/order tables additively where their meaning matches; do not reinterpret mutable cart rows as paid snapshots.
- Add checkout attempt/quote tables, quote line/snapshot tables, order snapshot structures, payment-reaction application records, finance exception records, and amendment structures missing from the current schema.
- Preserve historical rows. Backfill only deterministic non-business defaults required by new nullable-to-not-null transitions, and document each backfill in the migration.
- Keep existing order identifiers stable. Compatibility RPCs remain only until their Web consumers migrate in Task 6, then are removed in the same slice.

## Task Impact Matrix

| Task | Depends on | Migration impact | Compatibility impact | Unresolved product-decision blocker |
|---|---|---|---|---|
| 1. Quotes | Plans 03, 04, and 06 | None | Existing cart remains mutable; canonical quote becomes the only checkout pricing evidence | None |
| 2. Persistence | Task 1 and Plan 05 | Creates `0018_checkout_orders.sql` | Additive snapshots/attempts preserve stable historical order IDs | None |
| 3. Order commitment | Tasks 1–2 and Plan 05 event reactions | Uses `0018`; no additional migration | Browser/mock commitment is superseded by canonical payment reaction | Recovery policy blocks automatic refund-versus-retry selection, not durable exception/retry handling |
| 4. Amendments | Task 3 | Uses `0018`; no additional migration | Original paid orders remain immutable; additions become separate records/payment history | None |
| 5. Cancellation/refunds | Tasks 3–4 and Plan 05 refund lifecycle | Uses `0018`; no additional migration | Generic paid cancellation is replaced by explicit Order/Payments orchestration | Downstream recovery policy does not block user-requested canonical refunds; no Membership cancellation default applies |
| 6. Web migration | Tasks 1–5 and Plan 04 client | None | Removes synthetic paid-order contracts/routes after all callers migrate | Provider selection blocks live-provider UX, not canonical processing/pending UI |

## Task 1: Implement authoritative, versioned checkout quotes

**Files:**
- Create: `apps/core/src/checkout/domain/quote.ts`
- Create: `apps/core/src/checkout/application/create-checkout-quote.ts`
- Create: `apps/core/src/checkout/application/refresh-checkout-quote.ts`
- Create: `apps/core/src/checkout/infrastructure/d1-checkout-repository.ts`
- Test: `apps/core/src/checkout/application/create-checkout-quote.integration.test.ts`
- Modify: `packages/contracts/src/checkout.ts`
- Modify: `packages/contracts/src/core-service.ts`

**Interfaces:**
- `CreateCheckoutQuoteCommand { customerId, cartId, cartVersion, addressId, deliveryCycleId, idempotencyKey }`
- `RefreshCheckoutQuoteCommand { checkoutAttemptId, expectedVersion, idempotencyKey }`
- `CheckoutQuote { quoteId, attemptVersion, expiresAt, currency, subtotalMinor, discountMinor, deliveryFeeMinor, totalMinor, lines, addressSnapshot, cycleSnapshot, fulfillmentSnapshot }`
- Domain errors include `MEMBERSHIP_REQUIRED`, `CART_VERSION_CONFLICT`, `UNAVAILABLE_ITEM`, `PRICE_CHANGED`, `ADDRESS_UNSERVICEABLE`, `CYCLE_CLOSED`, `CAPACITY_UNAVAILABLE`, and `QUOTE_EXPIRED`.

- [ ] **Step 1: Write failing quote tests**

Cover active/trialing eligibility, non-entitled rejection, cart-version conflict, missing price, unavailable product, unit/base-quantity conversion, promotion calculation, serviceability polygon and zone resolution, cutoff, capacity, location-specific sourcing, quote expiry, idempotent replay, and concurrent refresh CAS.

- [ ] **Step 2: Run the focused test and prove failure**

Run: `pnpm --filter @freshmarkets/core exec vitest run --config vitest.config.ts src/checkout/application/create-checkout-quote.integration.test.ts`

Expected: FAIL because the canonical quote application service and repository do not exist.

- [ ] **Step 3: Implement the minimum quote domain and repository**

Load cart, customer/address, Market timezone, cycle/cutoff/capacity, Membership, catalog/price, Promotions, and location sourcing through context ports. Compute money only in integer minor units and quantities only in base units. Store a complete immutable quote breakdown and an optimistic version. A quote is evidence, not a reservation and not payment success.

- [ ] **Step 4: Expose the typed command/query contract**

Add purpose-built DTOs without D1 rows or provider fields. Require the authenticated customer identity at the Core boundary; never accept an arbitrary customer ID from a browser payload.

- [ ] **Step 5: Run tests and commit**

Run: `pnpm --filter @freshmarkets/core exec vitest run --config vitest.config.ts src/checkout/application/create-checkout-quote.integration.test.ts && pnpm --filter @freshmarkets/contracts test && pnpm typecheck`

Expected: all commands exit 0.

Run: `git add apps/core/src/checkout packages/contracts/src/checkout.ts packages/contracts/src/core-service.ts && git commit -m "feat(checkout): add authoritative versioned quotes"`

**Acceptance criteria:** quote totals and eligibility are Core-authoritative; quote snapshots are complete, immutable, versioned, and expiring; no reservation, paid order, or payment state is created.

## Task 2: Add the checkout/order persistence model

**Files:**
- Create: `apps/core/migrations/0018_checkout_orders.sql`
- Test: `apps/core/src/checkout/infrastructure/checkout-schema.integration.test.ts`
- Test: `apps/core/src/orders/infrastructure/order-schema.integration.test.ts`
- Modify: `apps/core/migrations/README.md`

**Interfaces and constraints:**
- Unique quote/application idempotency ownership.
- One order per successful checkout payment intent.
- Immutable snapshots for product name, product/variant identifiers, SKU/unit, base-unit conversion, quantities, unit/list/final prices, discounts, address/coordinates/zone, schedule/cycle/cutoff, location, sourcing mode, and fulfillment context.
- Unique Payments reaction application identity.
- Amendment header/line/payment association independent of the original order totals.
- Durable finance exception with status, attempt count, last error, and next/manual reconciliation metadata.

- [ ] **Step 1: Write failing migration/schema tests**

Assert foreign keys, required snapshot fields, unique quote/payment/reaction identities, immutable-snapshot write restrictions enforced by repositories, amendment independence, and a fresh migration sequence from `0001` through `0018`.

- [ ] **Step 2: Run tests and prove failure**

Run: `pnpm --filter @freshmarkets/core exec vitest run --config vitest.config.ts src/checkout/infrastructure/checkout-schema.integration.test.ts src/orders/infrastructure/order-schema.integration.test.ts`

Expected: FAIL because migration `0018` and the schemas are absent.

- [ ] **Step 3: Write one additive migration**

Use singular `snake_case` table names and existing stable IDs. Do not edit migrations `0001`–`0017`. Do not copy subscription objects from the rejected draft `0015`. Include indexes for customer order history, cycle operations, payment-reaction reconciliation, and unresolved finance exceptions.

- [ ] **Step 4: Run fresh and upgrade migration tests**

Run: `pnpm --filter @freshmarkets/core test -- checkout-schema.integration.test.ts order-schema.integration.test.ts`

Expected: fresh schema and an upgrade fixture representing accepted `0017` both pass.

- [ ] **Step 5: Commit**

Run: `git add apps/core/migrations/0018_checkout_orders.sql apps/core/migrations/README.md apps/core/src/checkout/infrastructure/checkout-schema.integration.test.ts apps/core/src/orders/infrastructure/order-schema.integration.test.ts && git commit -m "feat(orders): add checkout and snapshot schema"`

**Acceptance criteria:** migration ownership is unambiguous; historical data is preserved; all paid-order history can be rendered without querying mutable catalog/address/cycle rows.

## Task 3: Commit orders only from canonical payment reactions

**Files:**
- Create: `apps/core/src/orders/domain/order.ts`
- Create: `apps/core/src/orders/domain/order-state-machine.ts`
- Create: `apps/core/src/orders/application/apply-checkout-payment-reaction.ts`
- Create: `apps/core/src/orders/infrastructure/d1-order-repository.ts`
- Test: `apps/core/src/orders/application/apply-checkout-payment-reaction.integration.test.ts`
- Modify: `apps/core/src/payments/application/ingest-provider-event.ts`
- Modify: `packages/contracts/src/orders.ts`
- Modify: `packages/contracts/src/core-service.ts`

**Interfaces:**
- Consumes internal `ApplyCheckoutPaymentReaction { reactionId, paymentIntentId, checkoutAttemptId, canonicalPaymentState }`.
- Produces `OrderCommitted { orderId, orderVersion, paymentIntentId }` only for canonical state sufficient under policy (`SUCCEEDED` for MVP).
- On CAS/domain/storage failure, records or preserves a retryable reaction plus a finance exception; it does not reverse payment or claim success.

- [ ] **Step 1: Write failing reaction and atomicity tests**

Cover `PROCESSING` ignored/rejected, `SUCCEEDED` commits once, duplicate event/reaction replay, stale quote, membership recheck, cutoff/capacity recheck, stocked reservation, planned-procurement committed demand, mixed sourcing, complete snapshots, transaction rollback, and concurrent reaction attempts. Inject failure after every write boundary and assert there is no partial order/capacity/inventory state.

- [ ] **Step 2: Run tests and prove failure**

Run: `pnpm --filter @freshmarkets/core exec vitest run --config vitest.config.ts src/orders/application/apply-checkout-payment-reaction.integration.test.ts`

Expected: FAIL because the Orders payment-reaction handler does not exist.

- [ ] **Step 3: Implement one atomic commitment transaction**

Within one D1 transaction/CAS boundary, claim the reaction, load the immutable quote, revalidate time-sensitive eligibility, create the order and snapshots, consume cycle capacity, create stocked reservations and/or planned-procurement demand, append audit/outbox application events, and mark the reaction applied. Use current aggregate versions loaded by the handler; no provider payload supplies `expectedVersion`.

- [ ] **Step 4: Implement durable failure/retry visibility**

On concurrent change or transient storage failure, leave the reaction retryable and upsert the finance exception. Expose a scoped internal reconciliation command, but do not decide automatic refund versus indefinite fulfillment retry.

- [ ] **Step 5: Run tests and commit**

Run: `pnpm --filter @freshmarkets/core exec vitest run --config vitest.config.ts src/orders/application/apply-checkout-payment-reaction.integration.test.ts src/commerce/concurrency.integration.test.ts && pnpm typecheck`

Expected: all commands exit 0, including three repeated concurrency runs.

Run: `git add apps/core/src/orders apps/core/src/payments/application/ingest-provider-event.ts packages/contracts/src/orders.ts packages/contracts/src/core-service.ts && git commit -m "feat(orders): commit orders from payment reactions"`

**Acceptance criteria:** only canonical provider-confirmed payment commitment can create a paid order; each successful intent creates at most one order; commitment side effects are atomic or durably retryable; no vendor lifecycle leaks into Orders.

## Task 4: Implement additive paid-order amendments

**Files:**
- Create: `apps/core/src/orders/domain/amendment.ts`
- Create: `apps/core/src/orders/application/create-order-amendment.ts`
- Create: `apps/core/src/orders/application/apply-amendment-payment-reaction.ts`
- Test: `apps/core/src/orders/application/order-amendment.integration.test.ts`
- Modify: `apps/core/src/orders/infrastructure/d1-order-repository.ts`
- Modify: `packages/contracts/src/orders.ts`

**Interfaces:**
- `CreateOrderAmendmentCommand { orderId, expectedOrderVersion, additions, idempotencyKey }`
- Independent amendment quote and `paymentIntentId`; original order lines/totals/payment history are immutable.
- Amendment payment reaction applies its own capacity/reservation/demand deltas and snapshot lines once.

- [ ] **Step 1: Write failing amendment tests**

Cover paid-order-only eligibility, additions only, original snapshot immutability, repricing at amendment time, cutoff/capacity rules, independent payment failure/success, idempotent replay, stale order version, and atomic inventory/capacity deltas.

- [ ] **Step 2: Run test and prove failure**

Run: `pnpm --filter @freshmarkets/core exec vitest run --config vitest.config.ts src/orders/application/order-amendment.integration.test.ts`

Expected: FAIL because amendment commands do not exist.

- [ ] **Step 3: Implement quote, payment linkage, and reaction**

Reuse Checkout pricing and Payments intent ports through explicit interfaces. Never mutate the original paid lines or fold amendment payments into the original payment record.

- [ ] **Step 4: Run tests and commit**

Run: `pnpm --filter @freshmarkets/core exec vitest run --config vitest.config.ts src/orders/application/order-amendment.integration.test.ts && pnpm typecheck`

Expected: all commands exit 0.

Run: `git add apps/core/src/orders packages/contracts/src/orders.ts && git commit -m "feat(orders): add paid-order amendments"`

**Acceptance criteria:** post-payment additions are separately priced, paid, snapshotted, audited, and replay-safe; original commercial history never changes.

## Task 5: Enforce explicit cancellation and refund orchestration

**Files:**
- Create: `apps/core/src/orders/application/cancel-order.ts`
- Create: `apps/core/src/orders/application/request-order-refund.ts`
- Test: `apps/core/src/orders/application/cancel-order.integration.test.ts`
- Modify: `apps/core/src/orders/domain/order-state-machine.ts`
- Modify: `apps/core/src/payments/application/request-refund.ts`
- Modify: `packages/contracts/src/orders.ts`

**Interfaces:**
- `CancelOrderCommand { orderId, expectedVersion, reasonCode, idempotencyKey }`
- Cancellation policy evaluates order state, payment state, and delivery-cycle commitment state.
- Paid cancellation requests a canonical Payments refund command; Orders consumes the canonical refund result through a separate idempotent reaction.

- [ ] **Step 1: Write failing policy/state tests**

Cover pre-payment abandonment, paid pre-cutoff cancellation, post-cutoff rejection/manual exception, reservation release versus planned-demand adjustment, duplicate cancellation, stale version, refund pending/succeeded/failed, and rollback on command failure.

- [ ] **Step 2: Run tests and prove failure**

Run: `pnpm --filter @freshmarkets/core exec vitest run --config vitest.config.ts src/orders/application/cancel-order.integration.test.ts`

Expected: FAIL because explicit cancellation/refund orchestration is absent.

- [ ] **Step 3: Implement legal transitions and canonical refund command**

Keep Order and Refund state machines independent. Do not mark an order financially refunded from an admin click or adapter response; apply only the canonical Payments refund outcome. Do not reuse Membership cancellation policy.

- [ ] **Step 4: Run tests and commit**

Run: `pnpm --filter @freshmarkets/core exec vitest run --config vitest.config.ts src/orders/application/cancel-order.integration.test.ts src/payments/application/request-refund.integration.test.ts && pnpm typecheck`

Expected: all commands exit 0.

Run: `git add apps/core/src/orders apps/core/src/payments/application/request-refund.ts packages/contracts/src/orders.ts && git commit -m "feat(orders): enforce cancellation and refund flow"`

**Acceptance criteria:** cancellation is an explicit versioned command; financial and operational states remain separate; releases/adjustments follow the actual sourcing commitment; every refund is canonical and idempotent.

## Task 6: Migrate the Web checkout surface and remove mock commitment

**Files:**
- Create: `apps/web/app/api/checkout/quote/route.ts`
- Create: `apps/web/app/api/checkout/quote/route.test.ts`
- Create: `apps/web/app/api/checkout/payment/route.ts`
- Create: `apps/web/app/api/checkout/payment/route.test.ts`
- Modify: `apps/web/app/checkout/page.tsx`
- Modify: `apps/web/app/api/commerce/checkout/route.ts`
- Modify: `apps/web/app/orders/page.tsx`
- Modify: `apps/core/src/index.ts`
- Modify: `packages/contracts/src/core-service.ts`
- Test: `apps/web/tests/checkout.spec.ts`

**Interfaces and behavior:**
- Web creates/refreshes a Core quote, starts a canonical Payments intent, and polls/queries canonical attempt/order state.
- Browser redirects/callbacks are UX signals only; they never create an order or assert payment success.
- The old synthetic paid-order RPC and mock-success UI path are removed after all consumers migrate.

- [ ] **Step 1: Write failing route and browser tests**

Assert stale quote handling, membership loss, price change, payment processing, provider return without webhook, successful webhook/reaction, duplicate browser submission, committed-order rendering, and finance-exception pending state. Assert production cannot invoke any mock commit route.

- [ ] **Step 2: Run tests and prove failure**

Run: `pnpm --filter @freshmarkets/web exec vitest run --config vitest.config.ts app/api/checkout/quote/route.test.ts app/api/checkout/payment/route.test.ts`

Expected: FAIL because canonical routes do not exist.

- [ ] **Step 3: Migrate through the checked Core client**

Use the Plan 04 adapter and purpose-built DTOs. Generate/reuse idempotency keys per user action, preserve expected versions across retries, and map domain errors to stable HTTP/UI outcomes. Do not cast Service Bindings or expose provider payloads.

- [ ] **Step 4: Delete the mock commitment surface**

Remove the synthetic paid-order compatibility RPC from Core, contracts, route behavior, and UI only after the canonical tests pass. No local helper may bypass the signed-event/reaction path.

- [ ] **Step 5: Run complete checkout gates and commit**

Run: `pnpm --filter @freshmarkets/web test && pnpm --filter @freshmarkets/web exec playwright test tests/checkout.spec.ts && pnpm --filter @freshmarkets/core test && pnpm typecheck`

Expected: all commands exit 0.

Run: `git add apps/web/app/api/checkout apps/web/app/api/commerce/checkout/route.ts apps/web/app/checkout/page.tsx apps/web/app/orders/page.tsx apps/web/tests/checkout.spec.ts apps/core/src/index.ts packages/contracts/src/core-service.ts && git commit -m "feat(checkout): use provider-confirmed order flow"`

**Acceptance criteria:** Web cannot create or imply a paid order; all success originates from canonical Payments processing and the idempotent Orders reaction; mock commitment is absent from production contracts and routes.

## Final Acceptance Gate

- [ ] Run: `pnpm --filter @freshmarkets/core test && pnpm --filter @freshmarkets/web test && pnpm --filter @freshmarkets/contracts test`
- [ ] Run: `pnpm typecheck && pnpm lint && pnpm format:check`
- [ ] Run: `pnpm naming:check && pnpm -r build && pnpm --filter @freshmarkets/web check:vinext`
- [ ] Apply migrations `0001`–`0018` to a fresh database and to an accepted `0017` fixture.
- [ ] Repeat quote refresh and payment-reaction concurrency tests three times.
- [ ] Run the current ownership scan for legacy checkout commands, provider payload leakage, and unsafe Core binding casts.
- [ ] Confirm no production checkout/Orders match and no compatibility surface remains.
- [ ] Confirm `git status --short` lists only files declared above.

**Acceptance criteria:** checkout, payment, order, amendment, inventory/capacity, and refund state machines are independent and connected only by explicit commands/reactions; financial and operational boundaries are enforced; unresolved paid-success recovery policy remains visible without compromising durability or truthfulness.
