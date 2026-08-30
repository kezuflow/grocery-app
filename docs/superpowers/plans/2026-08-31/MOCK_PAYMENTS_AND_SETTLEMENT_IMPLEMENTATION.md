# Mock Payments and Settlement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide a safe end-to-end development payment simulator and record provider-neutral gross, processing-cost, adjustment, and net-settlement observations without pretending to integrate PayMongo.

**Architecture:** Extend the Payments provider port with optional settlement evidence and persist immutable provider observations. The deterministic mock remains the only development/test provider and gains a runtime-gated simulator that produces signed events through the normal inbox; production continues to fail closed.

**Tech Stack:** TypeScript, Cloudflare Workers, D1, Web Crypto, Vitest Workers pool, vinext/React, Playwright

**Spec:** `docs/superpowers/specs/2026-08-31/COMMERCE_PRICING_PAYMENTS_CANCELLATION_DESIGN.md`

## Global Constraints

- Browser return state never proves payment success.
- Mock controls are available only in `development` and `test`.
- Production never registers or falls back to `mock`.
- PayMongo pass-on fees remain disabled and are not simulated as a FreshMarkets charge.
- Actual provider processing costs remain distinct from the FreshMarkets Service Fee.
- Do not add PayMongo credentials, guessed vendor payloads, or production vendor code.

---

### Task 1: Persist provider-neutral settlement observations

**Files:**
- Create: `apps/core/migrations/0049_payment_settlement_observations.sql`
- Modify: `apps/core/src/payments/infrastructure/payment-schema.integration.test.ts`
- Modify: `apps/core/src/payments/ports/payment-provider.ts`
- Modify: `apps/core/src/payments/application/financial-observability.ts`
- Modify: `apps/core/src/payments/application/financial-observability.test.ts`

**Interfaces:**
- Consumes: canonical Payment Intent/Attempt and verified provider event identity
- Produces: `ProviderSettlementObservation` and immutable `payment_settlement_observation`

- [ ] **Step 1: Write failing schema and arithmetic tests**

```ts
expect(await columns(env.DB, "payment_settlement_observation")).toEqual(
  expect.arrayContaining(["gross_minor", "processing_cost_minor", "withholding_minor", "adjustment_minor", "net_minor"]),
);
expect(validateSettlement({ grossMinor: 100000, processingCostMinor: 4500, withholdingMinor: 0, adjustmentMinor: 0, netMinor: 95500 })).toBe(true);
```

- [ ] **Step 2: Run and confirm failure**

```powershell
pnpm --filter @freshmarkets/core test -- src/payments/infrastructure/payment-schema.integration.test.ts src/payments/application/financial-observability.test.ts
```

Expected: FAIL because settlement storage/types do not exist.

- [ ] **Step 3: Add migration and exact provider-neutral type**

```ts
export type ProviderSettlementObservation = {
  grossMinor: number;
  processingCostMinor: number;
  withholdingMinor: number;
  adjustmentMinor: number;
  netMinor: number;
  currency: string;
  observedAt: number;
};
```

The migration creates one immutable row per `(provider, provider_event_id, payment_intent_id)` with nonnegative components and the invariant:

```text
netMinor = grossMinor - processingCostMinor - withholdingMinor + adjustmentMinor
```

- [ ] **Step 4: Run migration and focused tests**

```powershell
pnpm migration:check
pnpm --filter @freshmarkets/core test -- src/payments/infrastructure/payment-schema.integration.test.ts src/payments/application/financial-observability.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/core/migrations/0049_payment_settlement_observations.sql apps/core/src/payments
git commit -m "feat(payments): record settlement observations"
```

### Task 2: Extend the deterministic mock provider

**Files:**
- Modify: `apps/core/src/payments/infrastructure/providers/mock-payment-provider.ts`
- Modify: `apps/core/src/payments/infrastructure/providers/provider-contract.test.ts`
- Modify: `apps/core/src/payments/http/provider-webhook.test.ts`
- Modify: `apps/core/src/payments/application/ingest-provider-event.ts`
- Modify: `apps/core/src/payments/application/ingest-provider-event.integration.test.ts`

**Interfaces:**
- Consumes: settlement type from Task 1 and existing signed mock event
- Produces: deterministic payment/refund outcomes with optional settlement evidence

- [ ] **Step 1: Write failing signed-event tests**

```ts
const body = JSON.stringify({
  eventId: "evt-paid-1",
  reference: "mock_pay_checkout-1",
  vendorState: "paid",
  amountMinor: 100000,
  currency: "PHP",
  settlement: { grossMinor: 100000, processingCostMinor: 4500, withholdingMinor: 0, adjustmentMinor: 0, netMinor: 95500 },
});
expect(await ingestSignedMock(body)).toMatchObject({ ok: true });
```

Test invalid arithmetic, duplicate event identity, refund events, rejection, expiry, and reconciliation replay.

- [ ] **Step 2: Run and confirm failure**

```powershell
pnpm --filter @freshmarkets/core test -- src/payments/infrastructure/providers/provider-contract.test.ts src/payments/http/provider-webhook.test.ts src/payments/application/ingest-provider-event.integration.test.ts
```

Expected: settlement evidence is rejected or ignored.

- [ ] **Step 3: Implement verified settlement ingestion**

Add optional `settlement` to `VerifiedProviderEvent`. The mock parser validates it before returning a trusted event. `ingestProviderEvent` inserts the observation using the same inbox identity/compare-and-swap transaction as canonical Payment processing. Invalid evidence fails closed without changing Payment state.

- [ ] **Step 4: Run focused Payment tests**

```powershell
pnpm --filter @freshmarkets/core test -- src/payments
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/core/src/payments
git commit -m "feat(payments): simulate verified settlement data"
```

### Task 3: Add runtime-gated local payment controls

**Files:**
- Modify: `packages/contracts/src/payments.ts`
- Modify: `packages/contracts/src/core-service.ts`
- Create: `apps/core/src/payments/application/simulate-mock-provider-event.ts`
- Create: `apps/core/src/payments/application/simulate-mock-provider-event.integration.test.ts`
- Modify: `apps/core/src/entrypoint/payments-rpc.ts`
- Modify: `apps/core/src/index.ts`
- Create: `apps/web/app/development/mock-payments/[provider-reference]/page.tsx`
- Create: `apps/web/app/development/mock-payments/[provider-reference]/mock-payment-controls.tsx`
- Create: `apps/web/app/development/mock-payments/[provider-reference]/mock-payment-controls.test.tsx`
- Create: `apps/web/app/api/development/mock-payments/[provider-reference]/route.ts`
- Create: route tests

**Interfaces:**
- Consumes: mock provider reference and requested outcome
- Produces: runtime-gated `simulateMockProviderEvent` that submits a signed event through normal ingestion

- [ ] **Step 1: Write runtime-boundary tests**

```ts
expect(await simulate({ environment: "production", outcome: "SUCCEEDED" })).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
expect(await simulate({ environment: "test", outcome: "SUCCEEDED" })).toMatchObject({ ok: true });
```

Web tests must prove the page and route return 404 outside development/test and never accept an arbitrary amount or customer identifier.

- [ ] **Step 2: Run and confirm failure**

```powershell
pnpm --filter @freshmarkets/core test -- src/payments/application/simulate-mock-provider-event.integration.test.ts
pnpm --filter @freshmarkets/web test -- app/development/mock-payments app/api/development/mock-payments
```

Expected: FAIL because simulator surfaces do not exist.

- [ ] **Step 3: Implement the constrained simulator**

```ts
export type MockPaymentOutcome = "SUCCEEDED" | "FAILED" | "EXPIRED";
export type SimulateMockPaymentRequest = AuthenticatedRequest & {
  providerReference: string;
  outcome: MockPaymentOutcome;
  idempotencyKey: string;
};
```

Core loads the existing Payment Intent/Attempt by provider reference, derives amount/currency/customer server-side, signs the mock payload internally, and invokes the normal webhook ingestion application function. It never allows the client to choose amount, currency, payment identity, settlement arithmetic, or canonical state outside the closed outcome set.

- [ ] **Step 4: Run simulator and regression tests**

```powershell
pnpm --filter @freshmarkets/core test -- src/payments
pnpm --filter @freshmarkets/web test -- app/development/mock-payments app/api/development/mock-payments app/checkout/checkout-client.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add packages/contracts/src apps/core/src/payments apps/core/src/entrypoint/payments-rpc.ts apps/core/src/index.ts apps/web/app/development apps/web/app/api/development
git commit -m "feat(payments): add local payment simulator"
```

### Task 4: Prove the mock customer journey and production fail-closed behavior

**Files:**
- Create: `apps/web/tests/mock-payment-journey.spec.ts`
- Modify: `apps/core/src/payments/infrastructure/providers/runtime-providers.test.ts`
- Modify: `docs/architecture/API_CONTRACTS.md`
- Modify: `docs/architecture/DATA_MODEL.md`
- Modify: `docs/product/IMPLEMENTATION_STATUS.md`

**Interfaces:**
- Consumes: Tasks 1-3
- Produces: verified local end-to-end payment evidence and documented production boundary

- [ ] **Step 1: Add the end-to-end flow**

```ts
test("mock checkout commits only after a verified provider event", async ({ page }) => {
  await startInstantCheckout(page);
  await expect(page).toHaveURL(/development\/mock-payments/);
  await page.getByRole("button", { name: "Approve test payment" }).click();
  await expect(page.getByText(/order confirmed/i)).toBeVisible();
});
```

Add decline and browser-return-without-event cases.

- [ ] **Step 2: Run E2E and provider registry tests**

```powershell
pnpm --filter @freshmarkets/core test -- src/payments/infrastructure/providers/runtime-providers.test.ts
pnpm --filter @freshmarkets/web test:e2e -- mock-payment-journey.spec.ts
```

Expected: PASS; production/test environment assertions show no fallback.

- [ ] **Step 3: Update canonical provider-neutral documentation**

Document settlement observations, simulator runtime gates, signed-event requirement, and deferred PayMongo integration. Do not document mock outcomes as production behavior.

- [ ] **Step 4: Run the program gate**

```powershell
pnpm architecture:check
pnpm readiness:check
pnpm lint
pnpm typecheck
pnpm --filter @freshmarkets/contracts test
pnpm --filter @freshmarkets/core test
pnpm --filter @freshmarkets/web test
git diff --check
```

Expected: all pass.

- [ ] **Step 5: Commit**

```powershell
git add apps/web/tests/mock-payment-journey.spec.ts apps/core/src/payments/infrastructure/providers/runtime-providers.test.ts docs
git commit -m "test(payments): prove the mock payment journey"
```
