# Customer MVP Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the Core-authoritative customer MVP from membership through paid order follow-up while preserving financial truth, current-price/current-availability behavior, customer ownership, and the approved Maps address boundary.

**Architecture:** Core remains the authority for Membership, Promotions, Checkout, Orders, Payments, Fulfillment, Delivery, Notifications, and invoice-readiness persistence. Purpose-built contract DTOs cross the Service Binding; Web route handlers perform only bounded transport validation and customer pages render Core decisions. Notifications are an asynchronous Core side effect, invoice readiness is an immutable Orders projection, and no customer command invents refund, tax, provider, inventory, routing, or cancellation policy.

**Tech Stack:** TypeScript 7, Cloudflare Workers/Service Bindings/D1/Cron Triggers, vinext, `@freshmarkets/contracts`, `@freshmarkets/validation`, Vitest Workers pool, React Testing Library, Playwright, pnpm.

**Spec:** `docs/superpowers/specs/2026-08-30/CUSTOMER_MVP_COMPLETION_DESIGN.md`

## Global Constraints

- Execute only after Maps has committed its address editor/confirmed-coordinate contract and Program 3 architecture/security hardening is integrated and green on current `main`.
- Do not redesign Admin or Maps. Consume the landed confirmed-address DTO and preserve geocoding, polygons, pins, routes, dispatch, rider navigation, Admin queues, and Admin read models.
- The migration sequence is concurrently owned by Maps until integration. At Task 1, reserve the next unused sequential number and create one migration with suffix `customer_mvp_completion`; never renumber or edit a committed migration.
- Preserve UI -> application command/query -> domain policy/service -> repository -> storage/integration. Web never computes entitlement, promotion selection, cancellation legality, refundability, invoice totals, or fulfillment eligibility.
- All customer reads are authenticated and ownership-scoped. All mutations carry a stable idempotency key; aggregate-changing commands carry an expected version and compare-and-swap.
- Quote creation never consumes a Promotion grant. Paid-order commitment consumes snapshotted redemption claims exactly once in the same authoritative transaction or guarded idempotent continuation.
- Customer cancellation of a committed grocery order is unavailable. Only pre-commit quote/attempt abandonment is customer-exposed; internal Admin cancellation/refund behavior remains separate.
- Reorder uses the ordinary active cart with current SKU state, price, inventory, and location. Historical price, promotion, fulfillment, cycle, capacity, and address never return as authority.
- Instant amendments fail closed until an approved deadline policy exists. Scheduled amendments are additive and independently priced/paid before commitment.
- Notification failure never changes domain truth. Invoice readiness never guesses VAT, taxpayer identity, official serial format, issuance timing, or retention.
- Follow TDD for every behavior: observe RED, implement minimally, observe GREEN, refactor, and commit a coherent slice.

---

### Task 1: Post-Maps/Post-Hardening Baseline and Migration Reservation

**Files:**
- Inspect: `docs/superpowers/reports/ARCHITECTURE_SECURITY_BASELINE.md`
- Inspect: landed Maps report under `docs/superpowers/reports/`
- Inspect: `packages/contracts/src/geography.ts`
- Inspect: `packages/contracts/src/core-service.ts`
- Inspect: `apps/core/src/index.ts`
- Inspect: `apps/web/app/checkout/page.tsx`
- Inspect: `apps/core/migrations/`
- Create: `docs/superpowers/reports/CUSTOMER_MVP_BASELINE.md`

**Interfaces:**
- Consumes: integrated Programs 1–3 and the landed Maps confirmed-address contract.
- Produces: a clean baseline, an exact next migration filename, and a recorded inventory of existing customer RPC, schema, route, page, scheduler, amendment, issue, and promotion seams.

- [ ] **Step 1: Verify coordination and integration**

Run:

```powershell
git fetch origin main
git status --short
git log --oneline -25 origin/main
pnpm architecture:check
pnpm naming:check
pnpm migration:check
pnpm typecheck
pnpm test
pnpm -r build
```

Expected: Maps and Program 3 are present, no task owns shared files, the tree is clean, and all checks pass. Stop without edits if Maps is still active or the integrated baseline is red.

- [ ] **Step 2: Reserve the migration filename**

Sort `apps/core/migrations/*.sql`, select the next unused four-digit number, and record the exact resulting path (the selected four-digit prefix plus `_customer_mvp_completion.sql`) in `CUSTOMER_MVP_BASELINE.md`. Do not assume `0046` is free and do not create more than one migration for this program unless D1 rebuild safety requires a separately documented exception.

- [ ] **Step 3: Record current seams and gaps**

Document: every customer-facing `CoreServiceBinding` method; Membership target methods not implemented; current quote/promotion columns; order/amendment/issue tables; the existing internal cancellation surface; the landed confirmed-address fields; scheduled job registry; current pages/routes; and exact test/build counts.

- [ ] **Step 4: Commit the baseline**

```powershell
git add docs/superpowers/reports/CUSTOMER_MVP_BASELINE.md
git commit -m "docs(customer): record MVP completion baseline"
```

### Task 2: Core-Owned Membership Experience

**Files:**
- Modify: `packages/contracts/src/membership.ts`
- Modify: `packages/contracts/src/core-service.ts`
- Modify: `packages/contracts/src/membership.test.ts`
- Create: `apps/core/src/membership/application/get-membership-experience.ts`
- Create: `apps/core/src/membership/application/get-membership-experience.integration.test.ts`
- Modify: `apps/core/src/membership/application/change-subscription.ts`
- Modify: `apps/core/src/membership/application/subscription-lifecycle.integration.test.ts`
- Modify: the post-Program-3 Membership RPC adapter under `apps/core/src/entrypoint/`
- Modify: `apps/web/app/api/membership/route.ts`
- Modify: `apps/web/app/api/membership/route.test.ts`
- Create: `apps/web/app/api/membership/pause/route.ts`
- Create: `apps/web/app/api/membership/resume/route.ts`
- Create: `apps/web/app/api/membership/cancel/route.ts`
- Create: `apps/web/app/api/membership/actions.test.ts`
- Modify: `apps/web/app/account/page.tsx`
- Create: `apps/web/app/account/page.test.tsx`
- Modify: `apps/web/components/storefront/marketplace/membership-cta-bar.tsx`
- Modify: `apps/web/components/storefront/marketplace/membership-cta-bar.test.tsx`
- Modify: `apps/web/components/storefront/marketplace/promo-banners.tsx`

**Interfaces:**
- Add `MembershipExperienceView` containing Core-owned offer, subscription, trial eligibility/status, recurring-authorization readiness, and policy-derived lifecycle actions with disabled reasons.
- Fully implement existing `getOffer`, `getSubscriptionSummary`, `beginPaidEnrollment`, `pauseSubscription`, `resumeSubscription`, and `cancelSubscription`; preserve `startTrial` and `getSubscriptionEligibility`.

- [ ] **Step 1: Write failing contract and integration tests**

Prove the experience DTO contains no provider reference or Web-owned price/trial/cancellation fact; offer price is `29900 PHP/CALENDAR_MONTH` from Core storage; trial status comes from Promotions; action availability follows Subscription state/version; unauthenticated and missing-customer reads fail safely; stale mutation versions and reused idempotency keys conflict.

- [ ] **Step 2: Observe RED**

```powershell
pnpm --filter @freshmarkets/contracts test -- membership
pnpm --filter @freshmarkets/core test -- get-membership-experience subscription-lifecycle
```

Expected: FAIL because the composed experience query and complete binding methods do not exist.

- [ ] **Step 3: Implement the Membership application query and commands**

Load the one active offer, application-owned customer/subscription, introductory grant/redemption state, and recurring authorization readiness through bounded-context ports. Return controlled unavailable/action-required reasons. Reuse the canonical Subscription domain transitions and repository compare-and-swap; never patch state directly or infer payment success.

- [ ] **Step 4: Implement thin Web routes and the account experience**

Validate bounded JSON, forward request headers/request ID/idempotency/expected version, and map `RpcResult` without changing meaning. Replace `PAID_OFFER`, `INTRODUCTORY_TRIAL`, hardcoded cancellation options, and all `₱299` membership copy with Core DTO rendering. Cover loading, unauthenticated, no subscription, authorization required, trialing, active, past due, paused, conflict, and retry states with accessible status announcements.

- [ ] **Step 5: Run GREEN and commit**

```powershell
pnpm --filter @freshmarkets/contracts test -- membership
pnpm --filter @freshmarkets/core test -- get-membership-experience subscription-lifecycle
pnpm --filter @freshmarkets/web test -- membership account membership-cta-bar
pnpm typecheck
git add packages/contracts/src/membership.ts packages/contracts/src/core-service.ts packages/contracts/src/membership.test.ts apps/core/src/membership apps/core/src/entrypoint apps/web/app/api/membership apps/web/app/account apps/web/components/storefront/marketplace
git commit -m "feat(membership): expose Core-owned customer lifecycle"
```

### Task 3: Checkout Promotion Evaluation and Redemption Claims

**Files:**
- Modify: `packages/contracts/src/checkout.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/src/checkout.test.ts`
- Create: `apps/core/src/promotions/domain/checkout-promotion.ts`
- Create: `apps/core/src/promotions/domain/checkout-promotion.test.ts`
- Create: `apps/core/src/promotions/application/evaluate-checkout-promotions.ts`
- Create: `apps/core/src/promotions/application/evaluate-checkout-promotions.integration.test.ts`
- Modify: `apps/core/src/checkout/application/create-checkout-quote.ts`
- Modify: `apps/core/src/checkout/application/revalidate-checkout-quote.ts`
- Modify: `apps/core/src/checkout/infrastructure/d1-checkout-repository.ts`
- Modify: `apps/core/src/checkout/application/resolve-checkout-decision.integration.test.ts`
- Modify: `apps/core/src/orders/application/apply-checkout-payment-reaction.ts`
- Modify: `apps/core/src/orders/application/apply-checkout-payment-reaction.integration.test.ts`
- Create: the exact `apps/core/migrations/` customer-MVP migration path reserved and recorded in Task 1
- Modify: `scripts/verify-migrations.mjs`

**Interfaces:**
- Add `PromotionCodeFeedback`, `CheckoutPromotionApplicationView`, and quote fields for requested codes, automatic benefits, merchandise/delivery applications, snapshots, and explicit price-acceptance version.
- Implement the exact `PromotionCheckoutContext` from the design and return deterministic component winners plus uncommitted redemption claims.

- [ ] **Step 1: Write failing domain selection tests**

Cover explicit valid benefit precedence per component; highest-value automatic/targeted fallback; stable promotion-ID tie-break; at most one merchandise plus one delivery benefit; Membership separation; fixed/percentage caps and integer rounding; effective time; status; global/per-customer limits; targeted grants; first-order/member/non-member/minimum-subtotal/specific-customer rules; invalid, expired, ineligible, and duplicated requested codes.

- [ ] **Step 2: Write failing D1 quote/commit tests**

Prove evaluation persists immutable definition/rule/benefit/version snapshots and claims but no redemption; revalidation detects promotion/price changes; failed/expired/abandoned quotes consume nothing; provider-confirmed commitment creates each redemption and `order_promotion_application` once; replay and concurrent reaction cannot double redeem or exceed limits.

- [ ] **Step 3: Observe RED**

```powershell
pnpm --filter @freshmarkets/contracts test -- checkout
pnpm --filter @freshmarkets/core test -- checkout-promotion resolve-checkout-decision apply-checkout-payment-reaction
```

Expected: FAIL because checkout promotion evaluation and durable claims do not exist.

- [ ] **Step 4: Implement the closed evaluator and persistence**

Validate only canonical rule/benefit JSON shapes; query active definitions, targeted grants, and automatic candidates; compute nonnegative integer discounts bounded by their component; select deterministically; snapshot every applied fact and controlled feedback. Extend the reserved migration with only required quote-claim/application/redemption support and safe indexes/checks, preserving existing Admin promotion tables and introductory-trial rows.

- [ ] **Step 5: Commit redemption atomically/idempotently**

At paid-order commitment, validate claim limits under compare-and-swap, create Promotions redemptions/order applications, and link immutable snapshots. If the storage boundary cannot be one D1 batch, use a guarded idempotent continuation keyed by canonical order/payment/price-component identity and hold order availability until complete; never report a committed discount without its durable redemption.

- [ ] **Step 6: Run migration and focused GREEN, then commit**

```powershell
pnpm migration:check
pnpm --filter @freshmarkets/contracts test -- checkout
pnpm --filter @freshmarkets/core test -- checkout-promotion resolve-checkout-decision apply-checkout-payment-reaction
pnpm typecheck
git add packages/contracts/src apps/core/src/promotions apps/core/src/checkout apps/core/src/orders apps/core/migrations scripts/verify-migrations.mjs
git commit -m "feat(promotions): apply deterministic checkout benefits"
```

### Task 4: Promotion-Aware Checkout UI and Explicit Reacceptance

**Files:**
- Modify: the post-Maps `apps/web/app/checkout/page.tsx`
- Create: `apps/web/components/storefront/checkout/promotion-entry.tsx`
- Create: `apps/web/components/storefront/checkout/promotion-entry.test.tsx`
- Create: `apps/web/components/storefront/checkout/checkout-total-review.tsx`
- Create: `apps/web/components/storefront/checkout/checkout-total-review.test.tsx`
- Modify: `apps/web/components/storefront/marketplace/order-summary.tsx`
- Modify: `apps/web/app/api/checkout/quote/route.ts`
- Modify: `apps/web/app/api/checkout/quote/route.test.ts`
- Modify: `apps/web/app/api/checkout/payment/route.ts`
- Modify: `apps/web/app/api/checkout/payment/route.test.ts`
- Create: `apps/web/tests/customer-checkout-promotions.spec.ts`

**Interfaces:**
- Quote route accepts bounded `promotionCodes: string[]`; payment acceptance includes the exact quote ID/version and every explicit component already required by the financial-safety contract.

- [ ] **Step 1: Write failing route/component tests**

Cover add/remove code, bounded count/length/casing normalization, controlled code feedback, automatic benefit labels, separate merchandise/delivery discounts, explicit zero-discount feedback, keyboard labels, live mutation status, and invalidation when address/cart/mode/code changes. Prove the payment route forwards exact Core totals and cannot accept stale quote version.

- [ ] **Step 2: Observe RED**

```powershell
pnpm --filter @freshmarkets/web test -- promotion-entry checkout-total-review checkout/quote checkout/payment
```

- [ ] **Step 3: Implement thin routes and UI composition**

Use the landed Maps checkout address editor unchanged. Render Core quote components verbatim, require a new explicit acceptance after any reprice/promotion change, reset the logical quote idempotency key only when the accepted request changes, and preserve recoverable payment action behavior.

- [ ] **Step 4: Run GREEN, browser slice, and commit**

```powershell
pnpm --filter @freshmarkets/web test -- promotion-entry checkout-total-review checkout/quote checkout/payment
$env:E2E_START_STACK='1'; pnpm --filter @freshmarkets/web exec playwright test tests/customer-checkout-promotions.spec.ts; Remove-Item Env:E2E_START_STACK
pnpm typecheck
git add apps/web/app/checkout apps/web/components/storefront/checkout apps/web/components/storefront/marketplace/order-summary.tsx apps/web/app/api/checkout apps/web/tests/customer-checkout-promotions.spec.ts
git commit -m "feat(checkout): present promotions and accepted totals"
```

### Task 5: Customer Order Detail and Canonical Timeline

**Files:**
- Modify: `packages/contracts/src/orders.ts`
- Modify: `packages/contracts/src/core-service.ts`
- Create: `packages/contracts/src/orders.test.ts`
- Create: `apps/core/src/orders/application/get-customer-order-detail.ts`
- Create: `apps/core/src/orders/application/get-customer-order-detail.integration.test.ts`
- Create: `apps/core/src/orders/application/build-customer-order-timeline.ts`
- Create: `apps/core/src/orders/application/build-customer-order-timeline.test.ts`
- Modify: `apps/core/src/orders/application/list-customer-orders.ts`
- Modify: the post-Program-3 Orders RPC adapter under `apps/core/src/entrypoint/`
- Create: `apps/web/app/api/commerce/orders/[order-id]/route.ts`
- Create: `apps/web/app/api/commerce/orders/[order-id]/route.test.ts`
- Modify: `apps/web/app/orders/page.tsx`
- Create: `apps/web/app/orders/[order-id]/page.tsx`
- Create: `apps/web/app/orders/[order-id]/page.test.tsx`
- Create: `apps/web/components/storefront/orders/order-timeline.tsx`
- Create: `apps/web/components/storefront/orders/order-timeline.test.tsx`

**Interfaces:**
- Add `CustomerOrderDetailView`, controlled `CustomerTimelineEntry`, immutable line/financial/fulfillment snapshots, amendment/payment/refund/issue summaries, invoice availability, and `CustomerOrderActionView[]` with disabled reasons.
- Add `getCustomerOrderDetail({ orderId, headers, requestId })` to `OrdersService`.

- [ ] **Step 1: Write failing contract/leakage tests**

Assert the DTO contains no provider identifiers/events/payloads, raw audit/reconciliation JSON, staff identity/internal notes, inventory/procurement data, or rider coordinates. Compile-time fixtures must reject infrastructure rows.

- [ ] **Step 2: Write failing Core ownership/timeline tests**

Cover another customer's order as `NOT_FOUND`; Scheduled and Instant snapshot differences; historical component unavailability without fabricated zeros; chronological stable ordering across order/payment/fulfillment/delivery/amendment/refund/issue events; customer-safe controlled copy; and policy-derived actions including committed cancellation unavailable with support/issue reason.

- [ ] **Step 3: Implement purpose-built reads**

Query immutable snapshots and bounded projections through Orders-owned application code. Build controlled timeline events with a deterministic timestamp/type/stable-ID order. Do not expose raw rows and do not join live catalog/address facts into history.

- [ ] **Step 4: Implement authenticated route and responsive detail page**

Link list cards to `/orders/[order-id]`; render summary, items, exact financial components, promise/address, amendments, issues, invoice status, timeline, and only Core-supplied actions. Cover loading, unauthenticated, not found, unavailable component, empty timeline, and recoverable error states.

- [ ] **Step 5: Run GREEN and commit**

```powershell
pnpm --filter @freshmarkets/contracts test -- orders
pnpm --filter @freshmarkets/core test -- get-customer-order-detail build-customer-order-timeline
pnpm --filter @freshmarkets/web test -- orders order-timeline
pnpm typecheck
git add packages/contracts/src/orders.ts packages/contracts/src/orders.test.ts packages/contracts/src/core-service.ts apps/core/src/orders/application apps/core/src/entrypoint apps/web/app/api/commerce/orders apps/web/app/orders apps/web/components/storefront/orders
git commit -m "feat(orders): add customer detail and safe timeline"
```

### Task 6: Current-State Reorder into the Ordinary Cart

**Files:**
- Modify: `packages/contracts/src/orders.ts`
- Modify: `packages/contracts/src/orders.test.ts`
- Create: `apps/core/src/orders/application/reorder-order.ts`
- Create: `apps/core/src/orders/application/reorder-order.integration.test.ts`
- Modify: `apps/core/src/checkout/application/cart.ts`
- Modify: `apps/core/src/checkout/application/cart.integration.test.ts`
- Modify: the post-Program-3 Orders RPC adapter under `apps/core/src/entrypoint/`
- Create: `apps/web/app/api/commerce/orders/[order-id]/reorder/route.ts`
- Create: `apps/web/app/api/commerce/orders/[order-id]/reorder/route.test.ts`
- Create: `apps/web/components/storefront/orders/reorder-action.tsx`
- Create: `apps/web/components/storefront/orders/reorder-action.test.tsx`
- Modify: `apps/web/app/orders/[order-id]/page.tsx`

**Interfaces:**
- Add `reorderOrder({ orderId, expectedCartVersion, idempotencyKey, headers, requestId }) -> ReorderResultView` with added lines/new cart version, controlled skipped reasons, and `requiresFulfillmentReview`/`requiresAddressReview`.
- Add an application-level Cart batch port; Orders does not write Cart tables.

- [ ] **Step 1: Write failing tests**

Prove ownership, replay, stale cart version, one active cart, quantity merge, current price/availability/location validation, partial success, every controlled skip reason, all-skipped failure, and no restoration of historical price/promotion/cycle/address/capacity.

- [ ] **Step 2: Observe RED**

```powershell
pnpm --filter @freshmarkets/contracts test -- orders
pnpm --filter @freshmarkets/core test -- reorder-order cart
```

- [ ] **Step 3: Implement composition through Cart**

Read immutable historical SKU/quantity snapshots, resolve each against current sellability and price context, and call a Cart application batch operation guarded by customer/cart/version/idempotency. Return deterministic added/skipped outcomes; never edit `cart_item` directly from Orders.

- [ ] **Step 4: Implement route/action and commit**

Show partial success in an accessible live region and navigate to `/cart` for review. Do not label the new cart as identical to the historical order.

```powershell
pnpm --filter @freshmarkets/core test -- reorder-order cart
pnpm --filter @freshmarkets/web test -- reorder
pnpm typecheck
git add packages/contracts/src/orders.ts packages/contracts/src/orders.test.ts apps/core/src/orders apps/core/src/checkout apps/core/src/entrypoint apps/web/app/api/commerce/orders apps/web/components/storefront/orders apps/web/app/orders
git commit -m "feat(orders): reorder against current cart state"
```

### Task 7: Customer Issue Intake and Safe Issue Reads

**Files:**
- Modify: `packages/contracts/src/orders.ts`
- Modify: `packages/contracts/src/orders.test.ts`
- Create: `apps/core/src/orders/domain/order-issue.ts`
- Create: `apps/core/src/orders/domain/order-issue.test.ts`
- Create: `apps/core/src/orders/application/submit-customer-order-issue.ts`
- Create: `apps/core/src/orders/application/submit-customer-order-issue.integration.test.ts`
- Create: `apps/core/src/orders/application/list-customer-order-issues.ts`
- Create: `apps/core/src/orders/application/list-customer-order-issues.integration.test.ts`
- Modify: the post-Program-3 Orders RPC adapter under `apps/core/src/entrypoint/`
- Create: `apps/web/app/api/commerce/orders/[order-id]/issues/route.ts`
- Create: `apps/web/app/api/commerce/orders/[order-id]/issues/route.test.ts`
- Create: `apps/web/components/storefront/orders/order-issue-form.tsx`
- Create: `apps/web/components/storefront/orders/order-issue-form.test.tsx`
- Modify: `apps/web/app/orders/[order-id]/page.tsx`

**Interfaces:**
- Add controlled categories `MISSING_ITEM`, `WRONG_ITEM`, `DAMAGED_ITEM`, `POOR_QUALITY`, `QUANTITY_DISCREPANCY`, `DELIVERY_ISSUE`, and `OTHER`.
- Add submit/list customer issue DTOs that expose customer-safe status/resolution only; no assignment, internal notes, staff, refund authorization, or Admin actions.

- [ ] **Step 1: Write failing domain/integration tests**

Cover bounded nonblank description, `OTHER` notes requirement, supported order/delivery states, order ownership, affected line membership, duplicate line rejection, idempotent replay/conflict, terminal Admin issue state, customer-safe resolution copy, and proof that submission creates no refund/payment mutation.

- [ ] **Step 2: Implement on the existing issue lifecycle**

Reuse `order_issue` and its canonical Admin queue. If affected-line persistence is absent, add a child table/check/index to the reserved migration. Submission does not change the Order version unless the approved data model requires aggregate issue metadata; if it does, compare-and-swap the supplied expected version in the same batch.

- [ ] **Step 3: Implement route/form and commit**

Render only when Core supplies `SUBMIT_ISSUE`; provide semantic controls, character count, affected-line selection, focus restoration, live result, retry with the same idempotency key, and existing issue summaries.

```powershell
pnpm --filter @freshmarkets/contracts test -- orders
pnpm --filter @freshmarkets/core test -- order-issue submit-customer-order-issue list-customer-order-issues
pnpm --filter @freshmarkets/web test -- order-issue
pnpm migration:check
pnpm typecheck
git add packages/contracts/src/orders.ts packages/contracts/src/orders.test.ts apps/core/src/orders apps/core/src/entrypoint apps/core/migrations apps/web/app/api/commerce/orders apps/web/components/storefront/orders apps/web/app/orders
git commit -m "feat(orders): accept customer order issues safely"
```

### Task 8: Pre-Commit Abandonment and Fail-Closed Customer Cancellation

**Files:**
- Modify: `packages/contracts/src/checkout.ts`
- Modify: `packages/contracts/src/orders.ts`
- Modify: `packages/contracts/src/checkout.test.ts`
- Modify: `packages/contracts/src/orders.test.ts`
- Create: `apps/core/src/checkout/application/abandon-checkout-attempt.ts`
- Create: `apps/core/src/checkout/application/abandon-checkout-attempt.integration.test.ts`
- Modify: `apps/core/src/orders/application/cancel-order.ts`
- Modify: `apps/core/src/orders/application/cancel-order.integration.test.ts`
- Modify: the post-Program-3 Checkout RPC adapter under `apps/core/src/entrypoint/`
- Create: `apps/web/app/api/checkout/quote/[quote-id]/abandon/route.ts`
- Create: `apps/web/app/api/checkout/quote/[quote-id]/abandon/route.test.ts`
- Modify: `apps/web/app/checkout/page.tsx`
- Modify: `apps/web/app/orders/[order-id]/page.tsx`

**Interfaces:**
- Add `abandonCheckoutAttempt({ quoteId, expectedVersion, idempotencyKey, headers, requestId }) -> AbandonCheckoutResult`.
- Customer `CustomerOrderActionView` never advertises committed `CANCEL`; internal Admin cancellation remains explicitly capability-scoped and cannot be reached through customer routes.

- [ ] **Step 1: Write failing abandonment tests**

Cover ownership, active quote states, stale version, replay/conflict, release of Instant inventory holds and Scheduled provisional capacity, quote/attempt terminal state, no order/refund/redemption creation, and safe no-op after prior expiry/abandonment.

- [ ] **Step 2: Write fail-closed cancellation regression tests**

Prove every customer committed-order read returns cancellation unavailable with a controlled issue/support reason for both modes and payment states; no customer Web route calls internal `cancelOrder`; Admin cancellation tests remain unchanged.

- [ ] **Step 3: Implement and commit**

Use the existing hold-release policy from scheduled expiry, guarded by quote owner/version. Trigger abandonment when the customer explicitly leaves/restarts an accepted quote flow; do not rely solely on browser unload delivery.

```powershell
pnpm --filter @freshmarkets/core test -- abandon-checkout-attempt cancel-order get-customer-order-detail
pnpm --filter @freshmarkets/web test -- abandon cancellation
pnpm typecheck
git add packages/contracts/src apps/core/src/checkout apps/core/src/orders apps/core/src/entrypoint apps/web/app/api/checkout apps/web/app/checkout apps/web/app/orders
git commit -m "fix(orders): keep customer cancellation fail closed"
```

### Task 9: Additive Amendment Draft, Payment, and Commitment

**Files:**
- Modify: `packages/contracts/src/orders.ts`
- Modify: `packages/contracts/src/payments.ts`
- Modify: `packages/contracts/src/orders.test.ts`
- Modify: `apps/core/src/orders/domain/amendment.ts`
- Modify: `apps/core/src/orders/application/create-order-amendment.ts`
- Modify: `apps/core/src/orders/application/order-amendment.integration.test.ts`
- Modify: `apps/core/src/orders/application/apply-amendment-payment-reaction.ts`
- Create: `apps/core/src/orders/application/apply-amendment-payment-reaction.integration.test.ts`
- Modify: `apps/core/src/payments/application/create-checkout-payment-intent.ts`
- Create: `apps/core/src/payments/application/create-amendment-payment-intent.ts`
- Create: `apps/core/src/payments/application/create-amendment-payment-intent.integration.test.ts`
- Modify: the post-Program-3 Orders and Payments RPC adapters under `apps/core/src/entrypoint/`
- Create: `apps/web/app/api/commerce/orders/[order-id]/amendments/route.ts`
- Create: `apps/web/app/api/commerce/orders/[order-id]/amendments/route.test.ts`
- Create: `apps/web/app/api/commerce/amendments/[amendment-id]/payment/route.ts`
- Create: `apps/web/app/api/commerce/amendments/[amendment-id]/payment/route.test.ts`
- Create: `apps/web/components/storefront/orders/amendment-flow.tsx`
- Create: `apps/web/components/storefront/orders/amendment-flow.test.tsx`
- Modify: `apps/web/app/orders/[order-id]/page.tsx`

**Interfaces:**
- Add create/pay amendment customer commands and a purpose-built draft/payment/status DTO with immutable independent financial components and lines.
- Payment purpose/subject are `ORDER_AMENDMENT` and amendment ID; original order totals/lines/payment remain immutable.

- [ ] **Step 1: Write failing eligibility/pricing tests**

Cover ownership; expected order version; additive-only positive quantities; current SKU/location price; missing price unavailable; Scheduled cycle open/before cutoff/capacity and planned demand; Instant fail-closed; one active draft policy; replay/conflict; and no original snapshot mutation.

- [ ] **Step 2: Write failing payment/commit tests**

Prove exact amendment total is the intent amount; browser return/initiation does not commit; provider-confirmed success commits once; failure leaves original order intact; success-after-race creates a bounded finance exception and reconciliation instead of silently inserting lines; amendment inventory/capacity/demand effects are independently auditable.

- [ ] **Step 3: Refactor existing implementation through current policy ports**

Replace direct loosely guarded SQL in `create-order-amendment.ts` with customer ownership, mode-specific eligibility, current authoritative price resolution, immutable component snapshots, and compare-and-swap. Reuse Payments provider abstraction and financial-exception taxonomy.

- [ ] **Step 4: Implement customer flow and commit**

Render only Core-supplied `ADD_ITEMS`; keep draft and original totals separate; require explicit current total acceptance; preserve provider action/recovery; show pending/committed/failed/reconciliation states without asserting success from the browser.

```powershell
pnpm --filter @freshmarkets/contracts test -- orders payments
pnpm --filter @freshmarkets/core test -- order-amendment create-amendment-payment-intent apply-amendment-payment-reaction
pnpm --filter @freshmarkets/web test -- amendment
pnpm typecheck
git add packages/contracts/src apps/core/src/orders apps/core/src/payments apps/core/src/entrypoint apps/web/app/api/commerce apps/web/components/storefront/orders apps/web/app/orders
git commit -m "feat(orders): complete paid additive amendments"
```

### Task 10: Transactional Notification Outbox and Scheduler

**Files:**
- Create: `apps/core/src/notifications/domain/notification.ts`
- Create: `apps/core/src/notifications/domain/notification.test.ts`
- Create: `apps/core/src/notifications/application/enqueue-notification.ts`
- Create: `apps/core/src/notifications/application/enqueue-notification.integration.test.ts`
- Create: `apps/core/src/notifications/application/deliver-notifications.ts`
- Create: `apps/core/src/notifications/application/deliver-notifications.integration.test.ts`
- Create: `apps/core/src/notifications/application/project-domain-notifications.ts`
- Create: `apps/core/src/notifications/application/project-domain-notifications.integration.test.ts`
- Create: `apps/core/src/notifications/infrastructure/email-delivery-port.ts`
- Create: `apps/core/src/notifications/infrastructure/email-templates.ts`
- Create: `apps/core/src/notifications/infrastructure/email-templates.test.ts`
- Create: `apps/core/src/scheduling/jobs/notification-delivery.ts`
- Modify: `apps/core/src/scheduling/job-registry.ts`
- Modify: `apps/core/src/scheduling/run-scheduled-jobs.integration.test.ts`
- Modify: the reserved migration from Task 3
- Modify: `apps/core/wrangler.jsonc`
- Regenerate: `apps/core/worker-configuration.d.ts`

**Interfaces:**
- Define the eleven launch notification types from the approved design, versioned template payload DTOs, `EmailDeliveryPort`, outbox state `PENDING|LEASED|DELIVERED|FAILED`, bounded attempts/backoff, and dedupe by stable domain-event identity/type/recipient.

- [ ] **Step 1: Write failing domain/template tests**

Prove closed types, valid state transitions, bounded locale/timezone/recipient/payload, controlled subjects, escaped content, no raw rows/provider references/internal bearer URLs, and deterministic template versions.

- [ ] **Step 2: Write failing outbox/scheduler tests**

Cover enqueue dedupe, future scheduled instant, lease ownership/expiry, concurrent workers, success history, bounded retry/backoff, terminal failure escalation once, crash recovery, and domain-state independence. Use a fake port; no test sends real email.

- [ ] **Step 3: Implement D1 outbox and idempotent event projector**

Add notification intent, attempt, and projection-dedupe tables/indexes/checks to the reserved migration. Prefer same-batch intent insertion from authoritative transitions; where existing transition batches cannot safely change, project from stable domain event identity. Never make domain completion depend on delivery.

- [ ] **Step 4: Add every launch trigger**

Wire order confirmed; payment action required/failed; Scheduled cutoff reminder; out for delivery; delivered; failed delivery; renewal payment failed/action required; introductory trial ending; and upcoming first paid renewal. Derive scheduling instants from authoritative Core timestamps and market timezone; repeated scheduler runs must dedupe.

- [ ] **Step 5: Implement the delivery adapter seam and job**

Configuration must fail closed when delivery is enabled without a configured adapter. A disabled/unconfigured production channel retains/escalates pending intents and never reports delivery. Add the job to the explicit registry; do not introduce Queue.

- [ ] **Step 6: Run GREEN and commit**

```powershell
pnpm migration:check
pnpm --filter @freshmarkets/core test -- notification email-templates run-scheduled-jobs
pnpm --filter @freshmarkets/core run cf-typegen
pnpm typecheck
git add apps/core/src/notifications apps/core/src/scheduling apps/core/migrations apps/core/wrangler.jsonc apps/core/worker-configuration.d.ts
git commit -m "feat(notifications): add durable transactional email outbox"
```

### Task 11: Invoice-Readiness Persistence at Paid Commitment

**Files:**
- Create: `apps/core/src/orders/domain/invoice-readiness.ts`
- Create: `apps/core/src/orders/domain/invoice-readiness.test.ts`
- Create: `apps/core/src/orders/application/create-invoice-readiness.ts`
- Create: `apps/core/src/orders/application/create-invoice-readiness.integration.test.ts`
- Modify: `apps/core/src/orders/application/apply-checkout-payment-reaction.ts`
- Modify: `apps/core/src/orders/application/apply-checkout-payment-reaction.integration.test.ts`
- Modify: `apps/core/src/orders/application/get-customer-order-detail.ts`
- Modify: the reserved migration from Task 3

**Interfaces:**
- Add one immutable `order_invoice_readiness` record per order/canonical successful payment with internal identity, gated issuance fields, seller snapshot version/controlled nullable fields, buyer snapshot, exact snapshotted financial components, tax-policy version/null tax classifications, state, and version.

- [ ] **Step 1: Write failing policy tests**

Prove missing approved tax configuration yields `PENDING_TAX_CONFIGURATION`; configured complete facts may yield `READY_FOR_ISSUANCE`; negative/inconsistent components fail; seller/buyer snapshots are bounded; and no helper computes VAT, official serial, or taxpayer facts.

- [ ] **Step 2: Write failing paid-commit integration tests**

Cover one-to-one order/payment link, exact quote components, provider-confirmed success only, replay/concurrency, failed payment absence, amendment separation, immutable update guards, and customer detail returning unavailable rather than an incomplete official invoice.

- [ ] **Step 3: Implement guarded persistence**

Insert readiness in the canonical order-commit transaction/guarded continuation. Add D1 checks and unique indexes to the reserved migration. Treat failure as commitment reconciliation requiring repair; never fabricate a ready invoice or roll financial truth backward.

- [ ] **Step 4: Run GREEN and commit**

```powershell
pnpm migration:check
pnpm --filter @freshmarkets/core test -- invoice-readiness apply-checkout-payment-reaction get-customer-order-detail
pnpm typecheck
git add apps/core/src/orders apps/core/migrations
git commit -m "feat(orders): persist invoice readiness at commitment"
```

### Task 12: Core-Provided Instant/Scheduled Fulfillment Options

**Files:**
- Modify: `packages/contracts/src/checkout.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/src/checkout.test.ts`
- Create: `apps/core/src/checkout/application/list-fulfillment-options.ts`
- Create: `apps/core/src/checkout/application/list-fulfillment-options.integration.test.ts`
- Modify: `apps/core/src/checkout/application/evaluate-checkout.ts`
- Modify: `apps/core/src/checkout/application/create-checkout-quote.ts`
- Modify: the post-Program-3 Checkout RPC adapter under `apps/core/src/entrypoint/`
- Create: `apps/web/app/api/checkout/fulfillment-options/route.ts`
- Create: `apps/web/app/api/checkout/fulfillment-options/route.test.ts`
- Create: `apps/web/components/storefront/checkout/fulfillment-option-picker.tsx`
- Create: `apps/web/components/storefront/checkout/fulfillment-option-picker.test.tsx`
- Modify: the post-Maps `apps/web/app/checkout/page.tsx`
- Create: `apps/web/tests/customer-fulfillment-selection.spec.ts`

**Interfaces:**
- Add `FulfillmentOptionView` with opaque option ID, mode, eligibility/reason, provider-neutral promise/window, fee preview components/currency, Scheduled cycle/cutoff, and provisional flag. Market/location route remains in Core and is never a selectable customer hub.
- Replace `cycleId`-required checkout inputs with `fulfillmentOptionId`; Core resolves/validates the snapshotted route. Instant has no synthetic cycle; Scheduled resolves an open cycle/window.

- [ ] **Step 1: Write failing contract/Core tests**

Cover confirmed-coordinate/address version requirement; customer ownership; hidden routing; one eligible/both eligible/neither eligible outcomes; Instant inventory/hold/promise/fee preview; Scheduled open cycle/cutoff/capacity/window; provisional flags; address/cart changes; stale option rejection; and no cross-mode cycle fabrication.

- [ ] **Step 2: Observe RED**

```powershell
pnpm --filter @freshmarkets/contracts test -- checkout
pnpm --filter @freshmarkets/core test -- list-fulfillment-options evaluate-checkout create-checkout-quote
```

- [ ] **Step 3: Implement query and opaque option validation**

Consume the Maps confirmed-address contract without changing it. Route market/location internally, evaluate each active location-mode configuration, return customer-safe promises/fees, and bind opaque option identity to address version/cart version/mode/routing/cycle so stale selection fails closed.

- [ ] **Step 4: Implement accessible option selection**

Query only after confirmed address and nonempty current cart. Present Instant/Scheduled, promise, fee preview, cutoff, and unavailable reason; never expose hub/location. Address/cart edits clear the selection, cancel the prior accepted quote through Task 8, and require a fresh query/quote/acceptance.

- [ ] **Step 5: Run GREEN, live browser flow, and commit**

```powershell
pnpm --filter @freshmarkets/contracts test -- checkout
pnpm --filter @freshmarkets/core test -- list-fulfillment-options evaluate-checkout create-checkout-quote
pnpm --filter @freshmarkets/web test -- fulfillment-option checkout
$env:E2E_START_STACK='1'; pnpm --filter @freshmarkets/web exec playwright test tests/customer-fulfillment-selection.spec.ts; Remove-Item Env:E2E_START_STACK
pnpm typecheck
git add packages/contracts/src apps/core/src/checkout apps/core/src/entrypoint apps/web/app/api/checkout apps/web/components/storefront/checkout apps/web/app/checkout apps/web/tests/customer-fulfillment-selection.spec.ts
git commit -m "feat(checkout): offer Core-routed fulfillment modes"
```

### Task 13: End-to-End Customer Journey, Canonical Documentation, and Acceptance

**Files:**
- Create: `apps/web/tests/customer-mvp-journey.spec.ts`
- Modify: `apps/web/playwright.config.ts` only if the existing managed stack lacks an approved fixture hook
- Modify: `docs/architecture/ARCHITECTURE.md`
- Modify: `docs/architecture/DOMAIN_MODEL.md`
- Modify: `docs/architecture/STATE_MACHINES.md`
- Modify: `docs/architecture/DATA_MODEL.md`
- Modify: `docs/architecture/API_CONTRACTS.md`
- Modify: `docs/product/PRODUCT_SCOPE.md`
- Modify: `docs/product/IMPLEMENTATION_PLAN.md`
- Modify: `IMPLEMENTATION_STATUS.md`
- Modify: relevant `apps/core/README.md` and `apps/web/README.md`
- Create: `docs/superpowers/reports/CUSTOMER_MVP_COMPLETION_REPORT.md`

**Interfaces:**
- Produces a live managed-stack acceptance journey and canonical documentation matching implemented contracts, states, schema, scheduler, unavailable policies, and remaining go-live gates.

- [ ] **Step 1: Write the complete failing Playwright journey**

Prove: sign in; inspect membership/authorization state; manage ordinary cart; confirm Maps address; choose eligible Core option; apply promotion; accept quote; initiate/replay payment action; observe provider-confirmed order; open safe detail/timeline; reorder; submit issue; observe committed cancellation unavailable; and request/pay an amendment only when permitted. Assert notification intent and invoice readiness from the resulting D1 state without requiring email delivery or official issuance.

- [ ] **Step 2: Run RED and repair only product defects**

```powershell
$env:E2E_START_STACK='1'; pnpm --filter @freshmarkets/web exec playwright test tests/customer-mvp-journey.spec.ts; Remove-Item Env:E2E_START_STACK
```

Do not weaken assertions, bypass Service Bindings, seed impossible domain states, or count a skipped acceptance criterion as complete.

- [ ] **Step 3: Update canonical documentation**

Document the exact Membership experience, Promotions selection/redemption timing, customer order detail/actions, reorder semantics, issue categories, pre-commit abandonment, committed-cancellation unavailability, amendment payment/commitment, notification outbox/retry, invoice readiness states, fulfillment-option contract, tables/indexes/checks, state transitions, and scheduler ownership. Keep accounting/tax, production payment provider, and email-provider decisions explicitly gated.

- [ ] **Step 4: Run full repository verification**

```powershell
pnpm format:check
pnpm lint
pnpm naming:check
pnpm architecture:check
pnpm migration:check
pnpm catalog:check
pnpm typecheck
pnpm test
pnpm -r build
pnpm audit --audit-level=high
$env:E2E_START_STACK='1'; pnpm --filter @freshmarkets/web exec playwright test; Remove-Item Env:E2E_START_STACK
git diff --check
git status --short
```

Expected: all checks and all non-excluded browser acceptance tests pass, with zero skipped criteria represented as complete. Any warning, environmental limitation, or external go-live dependency is recorded exactly.

- [ ] **Step 5: Produce the completion report**

Record implemented work, important modules, exact migration filename/schema, RPC/contracts, tests/counts, live browser evidence, documentation updates, deviations/risks, and what the next phase can rely on. Explicitly list remaining owner decisions for payment provider, transactional email adapter, BIR tax/serial/retention policy, and committed-order cancellation/refund policy.

- [ ] **Step 6: Request review and verify before completion**

Use `superpowers:requesting-code-review`, resolve findings with `superpowers:receiving-code-review`, rerun the full gate under `superpowers:verification-before-completion`, then commit:

```powershell
git add docs apps packages scripts IMPLEMENTATION_STATUS.md package.json pnpm-lock.yaml
git commit -m "docs(customer): complete customer MVP program"
git status --short
git log --oneline -15
```
