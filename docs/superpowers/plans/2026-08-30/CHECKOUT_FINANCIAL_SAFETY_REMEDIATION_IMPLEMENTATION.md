# Checkout and Financial Safety Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make membership entitlement, quote creation, paid-order commitment, payment and authorization replay, provider mappings, and refunds safe and consistent under expiry, retries, timeouts, and concurrent mutations.

**Architecture:** Membership publishes the only entitlement policy; Checkout consumes that policy and one authoritative commerce policy to build explicit immutable financial snapshots; Payments persists application claims and resumable provider actions before or alongside external side effects; Orders acquires quote identity, capacity, and inventory effects in one guarded D1 batch. Ambiguous provider outcomes remain recoverable financial state instead of being recorded as definitive failures.

**Tech Stack:** TypeScript 7, Cloudflare Workers, D1/SQLite transactional `batch()`, `@cloudflare/vitest-pool-workers`, Vitest 4, vinext, shared Zod contracts.

**Spec:** `docs/superpowers/specs/2026-08-30/CHECKOUT_FINANCIAL_SAFETY_REMEDIATION_DESIGN.md`

## Global Constraints

- Preserve the two-Worker monorepo and Core modular-monolith authority; do not add a public API, CORS, Durable Objects, Workflows, KV, Queues, or another deployment.
- Do not modify Admin Dashboard UI, admin information architecture, Mapbox/geocoding, map rendering, route drawing, dispatch maps, or rider navigation.
- Store money as integer minor units, quantities as integer canonical base units, timestamps as UTC instants, and use `Asia/Manila` for the initial market.
- A provider-confirmed canonical `SUCCEEDED` outcome is required for paid membership and order commitment; browser return state and payment initiation are never sufficient.
- Application commands use stable idempotency keys; provider events use `(provider, providerEventId)` and never accept `expectedVersion`.
- Every behavioral implementation starts with an observed failing test and ends with focused Worker-local tests before a commit.
- The detached implementation used `0043_financial_safety.sql`; integration preserved Maps-owned `0043_delivery_batches_and_map_stops.sql` and renumbered the unapplied financial migration to final path `0044_financial_safety.sql` without changing its SQL behavior.
- Preserve compatibility at the Web/Core boundary while both deployments may be version-skewed.

---

### Task 1: Canonical Membership Entitlement Policy

**Files:**
- Create: `apps/core/src/membership/application/evaluate-subscription-entitlement.ts`
- Create: `apps/core/src/membership/application/evaluate-subscription-entitlement.integration.test.ts`
- Modify: `apps/core/src/membership/application/subscription-eligibility.ts`
- Modify: `apps/core/src/checkout/application/create-checkout-quote.ts`
- Modify: `apps/core/src/orders/application/apply-checkout-payment-reaction.ts`
- Modify: `apps/core/src/membership/application/subscription-eligibility.integration.test.ts`

**Interfaces:**
- Produces: `evaluateSubscriptionEntitlement(database, { customerId, at }): Promise<EntitlementDecision>`.
- Produces: `EntitlementDecision` exactly as specified, including `effectiveUntil` and stable reason.
- Consumes: current `subscription.status`, `trial_ends_at`, `current_period_ends_at`, `grace_ends_at`, and `updated_at`.

- [ ] **Step 1: Add failing boundary tests**

```ts
it.each([
  ["TRIALING", now + 1, null, true, "ENTITLED"],
  ["TRIALING", now, null, false, "TRIAL_ENDED"],
  ["ACTIVE", now - 1, null, true, "ENTITLED"],
  ["PAST_DUE", null, now + 1, true, "ENTITLED"],
  ["PAST_DUE", null, now, false, "GRACE_ENDED"],
] as const)("evaluates %s at exact effective boundaries", async (state, trialEnd, graceEnd, eligible, reason) => {
  await seedSubscription({ state, trialEnd, graceEnd });
  await expect(evaluateSubscriptionEntitlement(env.DB, { customerId, at: now })).resolves.toMatchObject({ eligible, reason });
});

it("keeps ACTIVE entitled after conversion when historical trial_ends_at is past", async () => {
  await seedSubscription({ state: "ACTIVE", trialEnd: now - 60_000, currentPeriodEnd: now + 86_400_000 });
  await expect(evaluateSubscriptionEntitlement(env.DB, { customerId, at: now })).resolves.toMatchObject({ eligible: true, reason: "ENTITLED" });
});
```

- [ ] **Step 2: Run the new policy test and observe RED**

Run: `pnpm --filter @freshmarkets/core test -- src/membership/application/evaluate-subscription-entitlement.integration.test.ts`

Expected: FAIL because the module/export does not exist.

- [ ] **Step 3: Implement the single policy and replace direct status SQL**

```ts
export type EntitlementDecision = {
  eligible: boolean;
  state: SubscriptionState | null;
  effectiveUntil: number | null;
  reason: "ENTITLED" | "NO_SUBSCRIPTION" | "TRIAL_ENDED" | "GRACE_ENDED" | "STATE_NOT_ENTITLED";
};

export async function evaluateSubscriptionEntitlement(
  database: D1Database,
  input: { customerId: string; at: number },
): Promise<EntitlementDecision>;
```

Select the latest subscription by `updated_at DESC, id DESC`. `TRIALING` requires `trial_ends_at > at`; `ACTIVE` ignores historical trial end and uses a future paid-period end when present; `PAST_DUE` requires `grace_ends_at > at`; all other states fail closed. Call this function from the eligibility RPC, quote creation, and order commitment.

- [ ] **Step 4: Run membership, quote, and commitment tests GREEN**

Run: `pnpm --filter @freshmarkets/core test -- src/membership/application/evaluate-subscription-entitlement.integration.test.ts src/membership/application/subscription-eligibility.integration.test.ts src/checkout/application/instant-quote.integration.test.ts src/orders/application/apply-checkout-payment-reaction.integration.test.ts`

Expected: PASS with no direct entitled-status SQL remaining in Checkout or Orders.

- [ ] **Step 5: Commit**

```powershell
git add apps/core/src/membership apps/core/src/checkout/application/create-checkout-quote.ts apps/core/src/orders/application/apply-checkout-payment-reaction.ts
git commit -m "fix(membership): centralize checkout entitlement"
```

### Task 2: Explicit Financial Snapshot Schema and Repository Model

**Files:**
- Create: `apps/core/migrations/0044_financial_safety.sql`
- Create: `apps/core/src/checkout/infrastructure/financial-safety-migration.integration.test.ts`
- Modify: `apps/core/src/checkout/domain/quote.ts`
- Modify: `apps/core/src/checkout/infrastructure/d1-checkout-repository.ts`
- Modify: `packages/contracts/src/checkout.ts`
- Modify: `packages/contracts/src/checkout.test.ts`

**Interfaces:**
- Produces: `QuoteFinancialSnapshot` with merchandise, item discount, order discount, delivery subtotal/discount, service fee, tax, total, and currency.
- Produces: additive D1 columns on `checkout_quote` and `grocery_order` with nonnegative checks; repository/domain validation enforces component total consistency for every newly written row.
- Produces: `payment_provider_action` and `order_payment_reaction.checkout_quote_id`; later tasks consume those tables.

- [ ] **Step 1: Add a failing migration/round-trip test**

```ts
it("round-trips every canonical quote component without deriving zero from absence", async () => {
  await applyAllMigrations();
  const repository = createCheckoutRepository(env.DB);
  await env.DB.batch([repository.insertQuote(quoteFixture({
    merchandiseSubtotalMinor: 20_000,
    itemDiscountMinor: 500,
    orderDiscountMinor: 1_000,
    deliverySubtotalMinor: 2_000,
    deliveryDiscountMinor: 500,
    serviceFeeMinor: 200,
    taxMinor: 0,
    totalMinor: 20_200,
  }), now)]);
  await expect(repository.findQuoteById("quote-1")).resolves.toMatchObject({
    financial: { merchandiseSubtotalMinor: 20_000, orderDiscountMinor: 1_000, totalMinor: 20_200 },
  });
});
```

- [ ] **Step 2: Run the migration test and observe RED**

Run: `pnpm --filter @freshmarkets/core test -- src/checkout/infrastructure/financial-safety-migration.integration.test.ts`

Expected: FAIL on missing financial columns/table and `financial` mapping.

- [ ] **Step 3: Add migration and explicit repository mapping**

The migration must add/backfill explicit columns from the legacy values, create `payment_provider_action`, add the unique committed quote identity, and safely expand the closed `finance_exception.kind` vocabulary for the capacity/quote failure codes used by Task 5:

```sql
CREATE TABLE payment_provider_action (
  id TEXT PRIMARY KEY,
  payment_intent_id TEXT,
  authorization_id TEXT,
  provider TEXT NOT NULL,
  provider_reference TEXT NOT NULL,
  action_type TEXT NOT NULL CHECK (action_type IN ('REDIRECT','SDK')),
  redirect_url TEXT,
  client_token TEXT,
  expires_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','CONSUMED','EXPIRED')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK ((payment_intent_id IS NOT NULL) != (authorization_id IS NOT NULL)),
  CHECK ((action_type='REDIRECT' AND redirect_url IS NOT NULL AND client_token IS NULL)
      OR (action_type='SDK' AND client_token IS NOT NULL AND redirect_url IS NULL))
);
CREATE UNIQUE INDEX uq_payment_provider_action_active_intent
  ON payment_provider_action(payment_intent_id) WHERE status='ACTIVE';
CREATE UNIQUE INDEX uq_payment_provider_action_active_authorization
  ON payment_provider_action(authorization_id) WHERE status='ACTIVE';
```

Map legacy `subtotal_minor` to merchandise subtotal, legacy `discount_minor` to order discount, and legacy `delivery_fee_minor` to delivery subtotal with zero delivery discount/service fee/tax. Preserve legacy columns until every compatibility reader is migrated.

- [ ] **Step 4: Update shared schema and run migration/contracts GREEN**

Run: `pnpm --filter @freshmarkets/core test -- src/checkout/infrastructure/financial-safety-migration.integration.test.ts src/checkout/infrastructure/checkout-schema.integration.test.ts`

Run: `pnpm --filter @freshmarkets/contracts test -- src/checkout.test.ts`

Expected: PASS and old stored quotes remain readable through the compatibility projection.

- [ ] **Step 5: Commit**

```powershell
git add apps/core/migrations/0044_financial_safety.sql apps/core/src/checkout packages/contracts/src/checkout.ts packages/contracts/src/checkout.test.ts
git commit -m "feat(checkout): persist explicit financial components"
```

### Task 3: Shared Checkout Decision and Authoritative Minimum Basket

**Files:**
- Create: `apps/core/src/checkout/application/resolve-checkout-decision.ts`
- Create: `apps/core/src/checkout/application/resolve-checkout-decision.integration.test.ts`
- Modify: `apps/core/src/checkout/application/evaluate-checkout.ts`
- Modify: `apps/core/src/checkout/application/create-checkout-quote.ts`
- Modify: `apps/core/src/checkout/application/instant-quote.ts`
- Modify: `apps/core/src/checkout/application/instant-quote.integration.test.ts`

**Interfaces:**
- Consumes: Task 1 `evaluateSubscriptionEntitlement` and Task 2 `QuoteFinancialSnapshot`.
- Produces: `resolveCheckoutDecision(database, input, dependencies): Promise<CheckoutDecision>` containing stable failures plus a complete non-persisted quote draft with current market, currency, route fee, fulfillment, price, availability, capacity/hold evidence, and explicit financial components.
- Produces: `MINIMUM_ORDER_NOT_MET` before any quote/hold persistence when pre-discount merchandise subtotal is below policy.

- [ ] **Step 1: Add failing Scheduled and Instant minimum tests**

```ts
it.each(["INSTANT", "SCHEDULED"] as const)("rejects %s below the pre-discount merchandise minimum", async (mode) => {
  await seedCommerce({ minimumBasketMinor: 30_000, merchandiseSubtotalMinor: 29_999, deliveryFeeMinor: 5_000, mode });
  const result = await createQuoteFor(mode);
  expect(result).toMatchObject({ ok: false, error: { code: "MINIMUM_ORDER_NOT_MET" } });
  expect(await countRows("checkout_quote")).toBe(0);
  expect(await countRows("checkout_inventory_holds")).toBe(0);
});
```

- [ ] **Step 2: Run focused quote tests and observe RED**

Run: `pnpm --filter @freshmarkets/core test -- src/checkout/application/resolve-checkout-decision.integration.test.ts src/checkout/application/instant-quote.integration.test.ts`

Expected: FAIL because authoritative quote creation currently ignores the minimum.

- [ ] **Step 3: Implement one policy shared by advisory and authoritative paths**

```ts
export type CheckoutDecision = {
  eligible: boolean;
  failures: ReadonlyArray<{ code: string; message: string }>;
  quote: null | {
    marketId: string;
    currency: string;
    minimumBasketMinor: number;
    financial: QuoteFinancialSnapshot;
    lines: ReadonlyArray<QuoteLine>;
    addressSnapshot: unknown;
    fulfillmentSnapshot: unknown;
    deliveryFeeSnapshot: DeliveryFeeSnapshot;
  };
};
```

Resolve cart/version, entitlement, market/location/mode, SKU prices and availability, `commerce_policy`, route/delivery fee, and mode evidence without writing a quote or hold. Fail closed on missing/currency-mismatched configuration and evaluate minimum against `financial.merchandiseSubtotalMinor`. `evaluateCheckout` returns all failures; quote commands persist the returned draft and return the first stable failure. Components not yet enabled are explicit zero values in the draft.

- [ ] **Step 4: Run Checkout suites GREEN**

Run: `pnpm --filter @freshmarkets/core test -- src/checkout/application/resolve-checkout-decision.integration.test.ts src/checkout/application/instant-quote.integration.test.ts src/commerce-flow.integration.test.ts`

Expected: PASS for exact minimum, one minor unit below, both fulfillment modes, and missing policy.

- [ ] **Step 5: Commit**

```powershell
git add apps/core/src/checkout/application
git commit -m "fix(checkout): enforce authoritative commerce policy"
```

### Task 4: Payment Replay Before Quote Revalidation

**Files:**
- Modify: `apps/core/src/payments/application/create-checkout-payment-intent.ts`
- Modify: `apps/core/src/payments/application/create-payment.ts`
- Modify: `apps/core/src/payments/application/create-payment.integration.test.ts`
- Create: `apps/core/src/payments/application/checkout-payment-replay.integration.test.ts`
- Modify: `apps/web/app/api/checkout/payment/route.test.ts`

**Interfaces:**
- Consumes: `PaymentRepository.findIntentByIdempotencyKey` and the original quote ID.
- Consumes: Task 3 `resolveCheckoutDecision` for internal recalculation without quote/hold persistence.
- Produces: payment subject `checkout_quote/<original quote id>`; internal recalculation does not persist/supersede a quote.
- Produces: identical replay before quote ACTIVE-state checks.

- [ ] **Step 1: Add a lost-response replay test**

```ts
it("replays the original payment after its quote was consumed without creating another quote or provider call", async () => {
  const first = await createCheckoutPaymentIntent(...command);
  await env.DB.prepare("UPDATE checkout_quote SET status='CONSUMED' WHERE id=?").bind(quoteId).run();
  const replay = await createCheckoutPaymentIntent(...command);
  expect(replay).toEqual(first);
  expect(provider.createPayment).toHaveBeenCalledTimes(1);
  expect(await countQuotesForCart(cartId)).toBe(1);
});

it("returns the same usable browser continuation on a repeated payment request", async () => {
  createPaymentIntent.mockResolvedValue(paymentRedirectAction);
  const first = await POST(paymentRequest("same-key"));
  const replay = await POST(paymentRequest("same-key"));
  await expect(first.json()).resolves.toEqual(paymentRedirectAction);
  await expect(replay.json()).resolves.toEqual(paymentRedirectAction);
});
```

- [ ] **Step 2: Run and observe RED**

Run: `pnpm --filter @freshmarkets/core test -- src/payments/application/checkout-payment-replay.integration.test.ts`

Expected: FAIL with quote conflict or a second persisted validation quote.

- [ ] **Step 3: Implement replay-first and non-persisting revalidation**

Check the existing payment command by idempotency key and request identity first. For a new command, call `resolveCheckoutDecision`, compare all financial components and immutable eligibility evidence to the original accepted quote, and do not persist a replacement quote/hold. Do not call `createCheckoutQuote` with a synthetic `payment-validation:*` key. Keep `subjectId` equal to `command.checkoutAttemptId`.

- [ ] **Step 4: Run payment/quote tests GREEN**

Run: `pnpm --filter @freshmarkets/core test -- src/payments/application/checkout-payment-replay.integration.test.ts src/payments/application/create-payment.integration.test.ts src/checkout/application/instant-quote.integration.test.ts`

Run: `pnpm --filter @freshmarkets/web test -- app/api/checkout/payment/route.test.ts`

Expected: PASS; no replay invokes the provider or supersedes an accepted quote.

- [ ] **Step 5: Commit**

```powershell
git add apps/core/src/payments/application apps/web/app/api/checkout/payment/route.test.ts
git commit -m "fix(payments): replay checkout commands before revalidation"
```

### Task 5: Atomic Scheduled Capacity and Quote Consumption

**Files:**
- Modify: `apps/core/src/orders/application/apply-checkout-payment-reaction.ts`
- Modify: `apps/core/src/orders/application/apply-checkout-payment-reaction.integration.test.ts`
- Modify: `apps/core/src/commerce/concurrency.integration.test.ts`

**Interfaces:**
- Consumes: Task 2 unique `order_payment_reaction.checkout_quote_id`.
- Produces: adjacent batch sentinels proving capacity update and quote-consumption CAS each changed one row.
- Produces: finance exceptions `CAPACITY_UNAVAILABLE_AFTER_PAYMENT` and `QUOTE_ALREADY_CONSUMED` after rollback.

- [ ] **Step 1: Add two real race tests**

```ts
it("commits exactly one of two paid reactions for the final Scheduled capacity unit", async () => {
  const [a, b] = await Promise.all([react(firstPayment), react(secondPayment)]);
  expect([a.applied, b.applied].sort()).toEqual([false, true]);
  expect(await countRows("grocery_order")).toBe(1);
  expect(await allocatedCapacity()).toBe(capacityLimit);
  expect(await countOpenFinanceExceptions()).toBe(1);
});

it("commits one order when two successful payments race for one quote", async () => {
  const results = await Promise.all([reactToQuote("payment-a"), reactToQuote("payment-b")]);
  expect(results.filter((result) => result.applied)).toHaveLength(1);
  expect(await countOrdersForQuote(quoteId)).toBe(1);
});
```

- [ ] **Step 2: Run and observe RED**

Run: `pnpm --filter @freshmarkets/core test -- src/orders/application/apply-checkout-payment-reaction.integration.test.ts src/commerce/concurrency.integration.test.ts`

Expected: one race overcommits capacity or persists dependent rows after a zero-change guard.

- [ ] **Step 3: Add guarded statements and post-rollback classification**

After the capacity update, add a sentinel whose `SELECT` depends on `changes() = 0`; do the same immediately after quote consumption. Insert `checkout_quote_id` on the reaction link. Ensure the capacity statement is omitted for Instant, and create the finance exception only after the atomic batch rolled back.

```sql
INSERT INTO commitment_abort(id)
SELECT -3 WHERE changes() = 0;
```

- [ ] **Step 4: Run order/concurrency suites GREEN**

Run: `pnpm --filter @freshmarkets/core test -- src/orders/application/apply-checkout-payment-reaction.integration.test.ts src/commerce/concurrency.integration.test.ts src/payments/application/reconciliation.integration.test.ts`

Expected: PASS with exactly one order and no partial snapshots/reservations/demand for either loser.

- [ ] **Step 5: Commit**

```powershell
git add apps/core/src/orders/application/apply-checkout-payment-reaction.ts apps/core/src/orders/application/apply-checkout-payment-reaction.integration.test.ts apps/core/src/commerce/concurrency.integration.test.ts
git commit -m "fix(orders): guard capacity and quote commitment"
```

### Task 6: Executed Provider-Customer Mapping

**Files:**
- Modify: `apps/core/src/payments/infrastructure/d1/payment-repository.ts`
- Modify: `apps/core/src/payments/application/create-payment.ts`
- Modify: `apps/core/src/payments/application/begin-recurring-authorization.ts`
- Modify: `apps/core/src/payments/application/create-payment.integration.test.ts`
- Modify: `apps/core/src/payments/application/recurring-authorization.integration.test.ts`

**Interfaces:**
- Produces: `upsertProviderCustomer(input): Promise<D1Result>` that executes.
- Retains: statement builders only when named `...Statement` and passed visibly to `database.batch()`.

- [ ] **Step 1: Add persistence/reuse/provider-conflict tests**

```ts
it("persists and reuses one provider customer mapping", async () => {
  await createPaymentCommand("key-1");
  await createPaymentCommand("key-2");
  expect(provider.customerReferences).toEqual(["MOCK_cust_customer-1", "MOCK_cust_customer-1"]);
  expect(await providerCustomerRows()).toHaveLength(1);
});

it("does not let another provider overwrite an owned customer mapping", async () => {
  await seedProviderCustomer("MOCK");
  await expect(beginWithProvider("SECONDARY")).resolves.toMatchObject({ ok: false, error: { code: "CONFIGURATION_ERROR" } });
});
```

- [ ] **Step 2: Run and observe RED**

Run: `pnpm --filter @freshmarkets/core test -- src/payments/application/create-payment.integration.test.ts src/payments/application/recurring-authorization.integration.test.ts`

Expected: provider-customer row is absent after the first command.

- [ ] **Step 3: Execute the write and classify conflicts safely**

Change the repository return type to `Promise<D1Result>` and call `.run()` internally. Do not use `ON CONFLICT(customer_id)` to overwrite a different provider. Convert ownership/unique conflicts to stable configuration or reconciliation errors without calling the provider.

- [ ] **Step 4: Run focused suites GREEN**

Run: `pnpm --filter @freshmarkets/core test -- src/payments/application/create-payment.integration.test.ts src/payments/application/recurring-authorization.integration.test.ts`

Expected: PASS and the mapping is durable before provider payment/authorization creation.

- [ ] **Step 5: Commit**

```powershell
git add apps/core/src/payments
git commit -m "fix(payments): execute provider customer persistence"
```

### Task 7: Resumable Payment Actions and Ambiguous Payment Outcomes

**Files:**
- Modify: `apps/core/src/payments/infrastructure/d1/payment-repository.ts`
- Modify: `apps/core/src/payments/application/create-payment.ts`
- Modify: `apps/core/src/payments/application/apply-observation.ts`
- Modify: `apps/core/src/payments/application/create-payment.integration.test.ts`
- Modify: `packages/contracts/src/payments.ts`
- Modify: `packages/contracts/src/payments.test.ts`

**Interfaces:**
- Consumes: Task 2 `payment_provider_action`.
- Produces: `findActiveProviderAction`, `recordProviderActionStatement`, and `consumeProviderActionsStatement`.
- Produces: `PAYMENT_OUTCOME_UNRESOLVED` for thrown/timeout/parse/persistence ambiguity and `PAYMENT_ACTION_EXPIRED` for unrecoverable expired actions.

- [ ] **Step 1: Add action replay and timeout tests**

```ts
it("returns the same usable redirect action on idempotent replay", async () => {
  const first = await createPaymentCommand("same-key");
  const replay = await createPaymentCommand("same-key");
  expect(replay.value.redirectUrl).toBe(first.value.redirectUrl);
  expect(replay.value.redirectUrl).not.toBeNull();
  expect(provider.createPayment).toHaveBeenCalledTimes(1);
});

it("records provider timeout as unresolved instead of FAILED", async () => {
  provider.createPayment.mockRejectedValueOnce(new Error("timeout"));
  const result = await createPaymentCommand("timeout-key");
  expect(result).toMatchObject({ ok: false, error: { code: "PAYMENT_OUTCOME_UNRESOLVED" } });
  expect(await intentState("timeout-key")).toBe("INITIATED");
  expect(await reconciliationCategory("timeout-key")).toBe("AMBIGUOUS_OUTCOME");
});
```

- [ ] **Step 2: Run and observe RED**

Run: `pnpm --filter @freshmarkets/core test -- src/payments/application/create-payment.integration.test.ts`

Expected: replay has a null URL/token and provider throw marks the intent `FAILED`.

- [ ] **Step 3: Persist accepted actions atomically with attempt/status**

When provider returns `REDIRECT`/`SDK`, include the action row in the same D1 batch as attempt and intent transition. On replay, return only a valid ACTIVE action; mark actions consumed when a terminal provider observation lands. Treat provider typed `ok:false` as definitive; treat thrown and post-acceptance local failures as unresolved with reconciliation.

- [ ] **Step 4: Run payment/contracts GREEN**

Run: `pnpm --filter @freshmarkets/core test -- src/payments/application/create-payment.integration.test.ts src/payments/application/reconciliation.integration.test.ts`

Run: `pnpm --filter @freshmarkets/contracts test -- src/payments.test.ts`

Expected: PASS; replay never advertises REDIRECT/SDK with null continuation data.

- [ ] **Step 5: Commit**

```powershell
git add apps/core/src/payments packages/contracts/src/payments.ts packages/contracts/src/payments.test.ts
git commit -m "fix(payments): persist recoverable provider actions"
```

### Task 8: Recurring Authorization Claim-First Replay

**Files:**
- Modify: `apps/core/src/payments/application/begin-recurring-authorization.ts`
- Modify: `apps/core/src/payments/application/complete-recurring-authorization.ts`
- Modify: `apps/core/src/payments/application/recurring-authorization.integration.test.ts`

**Interfaces:**
- Consumes: Task 2 provider actions and Task 6 executed provider mapping.
- Produces: one `PROCESSING` idempotency claim before `provider.createAuthorization`.
- Produces: exact still-valid REDIRECT/SDK replay; ambiguous calls return `AUTHORIZATION_OUTCOME_UNRESOLVED`.

- [ ] **Step 1: Add concurrent and replay tests**

```ts
it("allows only one provider authorization call for concurrent identical commands", async () => {
  const [a, b] = await Promise.all([begin(command), begin(command)]);
  expect(provider.createAuthorization).toHaveBeenCalledTimes(1);
  expect([a, b].some((result) => result.ok)).toBe(true);
  expect(await idempotencyRows(command.idempotencyKey)).toHaveLength(1);
});

it("replays the same unexpired SDK token", async () => {
  const first = await begin(command);
  const replay = await begin(command);
  expect(replay).toEqual(first);
});
```

- [ ] **Step 2: Run and observe RED**

Run: `pnpm --filter @freshmarkets/core test -- src/payments/application/recurring-authorization.integration.test.ts`

Expected: two provider calls can occur or replay returns `NONE` with null continuation.

- [ ] **Step 3: Claim before the provider and persist action with authorization**

Atomically `INSERT` the PROCESSING idempotency claim before the provider call. The winner calls the provider; concurrent losers read the same claim and return stable processing/replay behavior. Persist authorization plus provider action plus SUCCEEDED claim together. On ambiguity, retain the claim as PROCESSING and write reconciliation rather than FAILED.

- [ ] **Step 4: Run recurring authorization GREEN**

Run: `pnpm --filter @freshmarkets/core test -- src/payments/application/recurring-authorization.integration.test.ts src/membership/application/start-promotional-trial.integration.test.ts`

Expected: PASS and trial still requires a provider-confirmed recurring-capable ACTIVE authorization.

- [ ] **Step 5: Commit**

```powershell
git add apps/core/src/payments/application/begin-recurring-authorization.ts apps/core/src/payments/application/complete-recurring-authorization.ts apps/core/src/payments/application/recurring-authorization.integration.test.ts
git commit -m "fix(payments): claim recurring authorization before provider call"
```

### Task 9: Atomic Refund Budget Reservation

**Files:**
- Modify: `apps/core/src/payments/infrastructure/d1/payment-repository.ts`
- Modify: `apps/core/src/payments/application/request-refund.ts`
- Modify: `apps/core/src/payments/application/refund.integration.test.ts`
- Modify: `apps/core/src/payments/application/apply-observation.ts`

**Interfaces:**
- Produces: `claimRefundBudget(input): Promise<boolean>` implemented as one guarded `INSERT ... SELECT`.
- Reserves statuses: `REQUESTED`, `APPROVED`, `PROCESSING`, `ESCALATED`, and `SUCCEEDED`.
- Releases statuses: `REJECTED` and definitive `FAILED`.
- Produces: `REFUND_AMOUNT_UNAVAILABLE` without a provider call.

- [ ] **Step 1: Add sequential and concurrent over-refund tests**

```ts
it("reserves outstanding REQUESTED and ESCALATED refund value", async () => {
  await seedRefund({ amountMinor: 6_000, status: "ESCALATED" });
  const result = await requestRefundCommand({ amountMinor: 4_001 });
  expect(result).toMatchObject({ ok: false, error: { code: "REFUND_AMOUNT_UNAVAILABLE" } });
  expect(provider.requestRefund).not.toHaveBeenCalled();
});

it("allows only one concurrent full-refund claim", async () => {
  const [a, b] = await Promise.all([refundAll("key-a"), refundAll("key-b")]);
  expect([a.ok, b.ok].sort()).toEqual([false, true]);
  expect(provider.requestRefund).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run and observe RED**

Run: `pnpm --filter @freshmarkets/core test -- src/payments/application/refund.integration.test.ts`

Expected: a second outstanding refund can claim more than the captured amount.

- [ ] **Step 3: Replace read-then-insert with one guarded claim**

```sql
INSERT INTO payment_refund (...)
SELECT ...
WHERE ? <= (
  SELECT pi.amount_minor - COALESCE(SUM(CASE WHEN pr.status IN
    ('REQUESTED','APPROVED','PROCESSING','ESCALATED','SUCCEEDED') THEN pr.amount_minor ELSE 0 END), 0)
  FROM payment_intent pi
  LEFT JOIN payment_refund pr ON pr.payment_intent_id=pi.id
  WHERE pi.id=? AND pi.status IN ('SUCCEEDED','PARTIALLY_REFUNDED')
  GROUP BY pi.id, pi.amount_minor
);
```

After provider observations, derive payment state from canonical SUCCEEDED refund totals only; do not release ambiguous ESCALATED value.

- [ ] **Step 4: Run refund/reconciliation suites GREEN**

Run: `pnpm --filter @freshmarkets/core test -- src/payments/application/refund.integration.test.ts src/payments/application/ingest-provider-event.integration.test.ts src/payments/application/reconciliation.integration.test.ts`

Expected: PASS for partial completion, rejection release, ambiguous escalation, and final `PARTIALLY_REFUNDED`/`REFUNDED` totals.

- [ ] **Step 5: Commit**

```powershell
git add apps/core/src/payments
git commit -m "fix(refunds): reserve refundable value atomically"
```

### Task 10: Idempotent Financial Observations and Safe Telemetry

**Files:**
- Create: `apps/core/src/payments/application/financial-observability.ts`
- Create: `apps/core/src/payments/application/financial-observability.test.ts`
- Modify: `apps/core/src/payments/application/apply-observation.ts`
- Modify: `apps/core/src/payments/application/ingest-provider-event.integration.test.ts`
- Modify: `apps/core/src/payments/application/refund.integration.test.ts`

**Interfaces:**
- Produces: `recordFinancialEvent(event)` accepting only request ID, command scope, application/provider identity, attempt count, safe outcome code, and age/duration integers.
- Produces: replay-safe payment/refund observation handlers that cannot duplicate attempts, reactions, orders, membership transitions, or refund totals.
- Excludes: cookies, authorization headers, redirect URLs, SDK tokens, provider payloads, addresses, and reconciliation details.

- [ ] **Step 1: Add duplicate-observation and telemetry-redaction tests**

```ts
it("replaying one claimed provider observation creates one financial reaction", async () => {
  await ingestProviderEvent(event);
  await ingestProviderEvent(event);
  expect(await reactionRowsForProviderEvent(event.providerEventId)).toHaveLength(1);
  expect(await committedOrders()).toHaveLength(1);
});

it("emits only the safe financial event vocabulary", () => {
  const output = recordFinancialEvent({
    event: "payment_outcome_unresolved",
    requestId: "request-1",
    provider: "MOCK",
    aggregateId: "intent-1",
    attemptCount: 1,
  });
  expect(JSON.stringify(output)).not.toMatch(/redirect|token|payload|address|cookie/i);
});
```

- [ ] **Step 2: Run and observe RED**

Run: `pnpm --filter @freshmarkets/core test -- src/payments/application/financial-observability.test.ts src/payments/application/ingest-provider-event.integration.test.ts src/payments/application/refund.integration.test.ts`

Expected: FAIL because the safe event helper does not exist or duplicate financial observation creates duplicate downstream state.

- [ ] **Step 3: Make observation writes and downstream reactions idempotent**

Use provider event identity, conditional payment/refund transitions, unique reaction identity, and existing order/membership reaction claims. Record safe events for capacity conflicts, unresolved payment/authorization/refund outcomes, provider-command replay, expired actions, refund-budget rejection, and finance-exception age. Use structured JSON output without sensitive values.

- [ ] **Step 4: Run financial observation suites GREEN**

Run: `pnpm --filter @freshmarkets/core test -- src/payments/application/financial-observability.test.ts src/payments/application/ingest-provider-event.integration.test.ts src/payments/application/refund.integration.test.ts src/orders/application/apply-checkout-payment-reaction.integration.test.ts src/membership/application/apply-payment-reaction.integration.test.ts`

Expected: PASS with one canonical transition/reaction per observation and redacted structured events.

- [ ] **Step 5: Commit**

```powershell
git add apps/core/src/payments apps/core/src/orders/application/apply-checkout-payment-reaction.integration.test.ts apps/core/src/membership/application/apply-payment-reaction.integration.test.ts
git commit -m "fix(payments): make financial observations replay safe"
```

### Task 11: Financial Contracts, Canonical Documentation, and Program Verification

**Files:**
- Modify: `packages/contracts/src/checkout.ts`
- Modify: `packages/contracts/src/payments.ts`
- Modify: `packages/contracts/src/index.ts` only for additive exports that do not overlap Admin/Maps sections
- Modify: `docs/architecture/DOMAIN_MODEL.md`
- Modify: `docs/architecture/STATE_MACHINES.md`
- Modify: `docs/architecture/DATA_MODEL.md`
- Modify: `docs/architecture/API_CONTRACTS.md`
- Modify: `docs/product/MVP_SCOPE.md`
- Modify: `docs/product/IMPLEMENTATION_PLAN.md`
- Modify: `IMPLEMENTATION_STATUS.md`

**Interfaces:**
- Produces: stable errors `TRIAL_ENDED`, `SUBSCRIPTION_GRACE_ENDED`, `MINIMUM_ORDER_NOT_MET`, `CAPACITY_UNAVAILABLE`, `PAYMENT_OUTCOME_UNRESOLVED`, `AUTHORIZATION_OUTCOME_UNRESOLVED`, `PAYMENT_ACTION_EXPIRED`, and `REFUND_AMOUNT_UNAVAILABLE`.
- Produces: public quote components without provider references, action secrets, payloads, or reconciliation JSON.

- [ ] **Step 1: Add contract leak and error-vocabulary tests**

```ts
it("exposes explicit quote components and no provider continuation secrets", () => {
  expect(CheckoutQuoteViewSchema.parse(quoteFixture())).toMatchObject({ merchandiseSubtotalMinor: 20_000, totalMinor: 20_200 });
  expect(Object.keys(CustomerOrderSchema.parse(orderFixture()))).not.toContain("clientToken");
});
```

- [ ] **Step 2: Run contracts and observe any RED drift**

Run: `pnpm --filter @freshmarkets/contracts test`

Expected: FAIL until all additive schemas/error codes match Core results.

- [ ] **Step 3: Update canonical documents and implementation status**

Document the executable entitlement decision, minimum basis, explicit financial fields, quote/capacity guards, action persistence/expiry, ambiguous outcome classification, and refund reservation statuses. Do not claim a production payment provider; retain the launch readiness gate.

- [ ] **Step 4: Run focused and full validation**

Run: `pnpm --filter @freshmarkets/contracts test`

Run: `pnpm --filter @freshmarkets/core test -- src/membership src/checkout src/payments src/orders src/commerce/concurrency.integration.test.ts`

Run: `pnpm naming:check`

Run: `pnpm migration:check`

Run: `pnpm typecheck`

Run: `pnpm lint`

Run: `pnpm test`

Run: `pnpm --filter @freshmarkets/core build`

Run: `pnpm --filter @freshmarkets/web build`

Expected: every command exits 0. If unrelated excluded Admin/Maps formatting is still red after integration, report it separately and do not format or rewrite those files from this program.

- [ ] **Step 5: Inspect final diff for secrets, placeholders, and boundary violations**

Run: `rg -n "clientToken|redirectUrl|provider_reference|payload_json|details_json" apps/web packages/contracts/src`

Run: `rg -n "SELECT status FROM subscription|status IN \('TRIALING','ACTIVE'\)" apps/core/src/checkout apps/core/src/orders`

Run: `git diff --check`

Expected: no provider continuation secrets in ordinary customer DTOs, no direct entitled-status SQL in Checkout/Orders, and no whitespace errors.

- [ ] **Step 6: Commit**

```powershell
git add packages/contracts docs/architecture docs/product IMPLEMENTATION_STATUS.md
git commit -m "docs(remediation): record financial safety guarantees"
```
