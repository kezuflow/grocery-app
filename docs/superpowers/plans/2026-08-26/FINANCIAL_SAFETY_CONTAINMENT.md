# Financial Safety Containment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fail closed anywhere the current compatibility implementation can fabricate a successful payment or refund, while retaining an explicitly enabled local sandbox path until the canonical Payments and Checkout plans replace it.

**Architecture:** Add a minimal environment policy at the existing Core/Web boundary rather than refactoring commerce first. Production cannot execute `commitMockOrder`, synthesize `SUCCEEDED` payment/refund rows, or release paid-order commitments through the generic operation. Local sandbox behavior remains available only when both environment and explicit payment mode permit it.

**Tech Stack:** Cloudflare Workers, Service Bindings, TypeScript, D1, Zod, Vitest, vinext.

**Spec:** `AGENTS.md` Locked Business Invariants; `docs/architecture/STATE_MACHINES.md` Payment Attempt, Refund, and Cancellation Effects; `docs/architecture/API_CONTRACTS.md` Checkout/Payment/Order Commitment; `docs/product/MVP_SCOPE.md` acceptance criterion 5.

## Global Constraints

- Priority: P0.
- Execute in an isolated clean worktree; do not absorb dirty Phase 4C changes.
- Do not create or modify migrations.
- This is containment, not the canonical Payments implementation. Do not create provider tables or choose a provider here.
- No P1 extraction may delay the fail-closed guard.
- Preserve read-only order history and existing local integration-test capability.
- Any disabled financial command must perform zero payment, refund, order, reservation, demand, capacity, ledger, audit, and idempotency writes.

---

## Dependencies and Decision Blockers

- Depends only on the approved docs/plans being committed.
- May run independently of Plans 01 and 03.
- Production provider selection does not block containment.
- Paid-success/downstream-commit recovery policy does not block containment because this plan refuses to fabricate success.
- Cancellation-default, dunning, and billing-anchor decisions do not affect this plan.

## Migration and Compatibility Impact

- Migration impact: none.
- Compatibility: `commitMockOrder` remains temporarily callable only for an explicit nonproduction sandbox. Production callers receive a stable failure; later Plan 04 removes it from public target contracts and Plan 07 replaces it.
- Compatibility: generic `advanceOrder` `REFUND`/paid `CANCEL` actions become fail-closed instead of reporting synthetic success.

## Task Impact Matrix

| Task | Depends on | Migration impact | Compatibility impact | Unresolved product-decision blocker |
|---|---|---|---|---|
| 1. Sandbox policy | None | None | Production `commitMockOrder` calls fail before writes; explicit local sandbox remains temporarily available | None |
| 2. Web containment | Task 1 | None | Production Web no longer exposes mock commitment; local-only UX is relabeled | None |
| 3. Refund/cancellation containment | Task 1 | None | Synthetic refund and unsafe paid-cancel calls fail before writes; later canonical replacements come from Plans 05 and 07 | Downstream recovery policy blocks replacement automation, not containment |

## Task Acceptance Matrix

| Task | Acceptance criteria |
|---|---|
| 1. Sandbox policy | Production and preview reject mock payment/order commitment before any D1 write; only explicit development+sandbox configuration permits it |
| 2. Web containment | No production-visible route or copy can invoke or imply synthetic payment/order success; stable local attempts reuse one idempotency key |
| 3. Refund/cancellation containment | Production cannot insert a synthetic successful refund or release paid commitments through a generic action; rejected calls leave all rows unchanged |

## Task 1: Explicit sandbox-payment policy

**Files:**
- Create: `apps/core/src/payments/sandbox-policy.ts`
- Test: `apps/core/src/payments/sandbox-policy.test.ts`
- Modify: `apps/core/src/index.ts`
- Modify: `apps/core/wrangler.jsonc`
- Modify: `apps/core/src/worker-configuration.d.ts` through type generation
- Modify: `packages/contracts/src/index.ts`

**Interfaces:**
- Consumes: `PaymentRuntimeEnvironment { ENVIRONMENT?: string; PAYMENT_MODE?: string }`
- Produces: `isSandboxPaymentEnabled(env: PaymentRuntimeEnvironment): boolean`
- Produces: error code `PAYMENT_PROVIDER_UNAVAILABLE`
- Guards: `CoreEntrypoint.commitMockOrder` before authentication-independent or D1 side effects

- [ ] **Step 1: Write failing policy tests**

```ts
expect(isSandboxPaymentEnabled({ ENVIRONMENT: "production", PAYMENT_MODE: "sandbox" })).toBe(false);
expect(isSandboxPaymentEnabled({ ENVIRONMENT: "preview", PAYMENT_MODE: "sandbox" })).toBe(false);
expect(isSandboxPaymentEnabled({ ENVIRONMENT: "development", PAYMENT_MODE: "disabled" })).toBe(false);
expect(isSandboxPaymentEnabled({ ENVIRONMENT: "development", PAYMENT_MODE: "sandbox" })).toBe(true);
expect(isSandboxPaymentEnabled({ ENVIRONMENT: "test", PAYMENT_MODE: "sandbox" })).toBe(true);
```

- [ ] **Step 2: Run the focused test and prove failure**

Run: `pnpm --filter @freshmarkets/core exec vitest run --config vitest.config.ts src/payments/sandbox-policy.test.ts`

Expected: FAIL because the policy module does not exist.

- [ ] **Step 3: Implement the policy and Core guard**

Implement the pure function exactly as tested. At the first line of `commitMockOrder` after request ID extraction, return:

```ts
{
  ok: false,
  error: {
    code: "PAYMENT_PROVIDER_UNAVAILABLE",
    message: "A payment provider is not configured for this environment.",
    requestId,
  },
}
```

when the policy is false. Do not claim an idempotency record before this guard. Add the closed error code to `AppErrorCode`. Set local Core Wrangler `PAYMENT_MODE` to `sandbox`; document no production default in config comments.

- [ ] **Step 4: Prove production performs zero writes**

Add an integration case that calls the guarded method with a production-shaped environment/entrypoint factory, then queries counts for `payment_attempt`, `payment_event`, `grocery_order`, `idempotency_records`, `capacity_allocation`, `inventory_reservation`, and `committed_procurement_demand`. Every count must remain zero.

- [ ] **Step 5: Run focused tests and type generation**

Run: `pnpm --filter @freshmarkets/core types && pnpm --filter @freshmarkets/core exec vitest run --config vitest.config.ts src/payments/sandbox-policy.test.ts src/financial-safety.integration.test.ts`

Expected: all tests pass.

- [ ] **Step 6: Commit the Core containment guard**

Run: `git add apps/core/src/payments/sandbox-policy.ts apps/core/src/payments/sandbox-policy.test.ts apps/core/src/financial-safety.integration.test.ts apps/core/src/index.ts apps/core/wrangler.jsonc apps/core/src/worker-configuration.d.ts packages/contracts/src/index.ts && git commit -m "fix(payments): fail closed outside explicit sandbox"`

## Task 2: Remove sandbox commitment from production Web behavior

**Files:**
- Create: `apps/web/lib/payments/runtime-policy.ts`
- Test: `apps/web/lib/payments/runtime-policy.test.ts`
- Modify: `apps/web/app/api/commerce/checkout/route.ts`
- Modify: `apps/web/app/checkout/page.tsx`
- Modify: `apps/web/wrangler.jsonc`
- Modify: `apps/web/worker-configuration.d.ts` through type generation

**Interfaces:**
- Produces: `isWebSandboxPaymentEnabled(env: { ENVIRONMENT?: string; PAYMENT_MODE?: string }): boolean`
- Checkout POST in disabled mode returns HTTP 503 with `PAYMENT_PROVIDER_UNAVAILABLE`
- Checkout UI receives or fetches a capability flag and cannot render a button that claims payment/order success in disabled mode

- [ ] **Step 1: Write failing route-policy tests**

Test the same environment matrix as Core. Add a route-helper test that submits `{ commit: true }` with disabled policy and asserts HTTP 503, stable error code, and that the mocked Core `commitMockOrder` method was not called.

- [ ] **Step 2: Run the focused Web test and prove failure**

Run: `pnpm --filter @freshmarkets/web exec vitest run --config vitest.config.ts lib/payments/runtime-policy.test.ts app/api/commerce/checkout/route.test.ts`

Expected: FAIL because the policy/helper tests and guarded route do not exist.

- [ ] **Step 3: Implement Web fail-closed behavior**

Add explicit local `ENVIRONMENT=development` and `PAYMENT_MODE=sandbox` vars. In all other environments, do not call `commitMockOrder`. Replace “paid and committed” sandbox copy with “Local sandbox order” and label it nonproduction. Do not generate a new idempotency key on the server; the explicit local client must send and reuse one key per user attempt.

- [ ] **Step 4: Regenerate binding types and run tests**

Run: `pnpm --filter @freshmarkets/web types && pnpm --filter @freshmarkets/web exec vitest run --config vitest.config.ts lib/payments/runtime-policy.test.ts app/api/commerce/checkout/route.test.ts`

Expected: all tests pass.

- [ ] **Step 5: Commit Web containment**

Run: `git add apps/web/lib/payments/runtime-policy.ts apps/web/lib/payments/runtime-policy.test.ts apps/web/app/api/commerce/checkout/route.ts apps/web/app/api/commerce/checkout/route.test.ts apps/web/app/checkout/page.tsx apps/web/wrangler.jsonc apps/web/worker-configuration.d.ts && git commit -m "fix(web): hide synthetic checkout outside local sandbox"`

## Task 3: Disable synthetic refund and unsafe paid cancellation

**Files:**
- Create: `apps/core/src/orders/financial-safety.ts`
- Test: `apps/core/src/orders/financial-safety.test.ts`
- Modify: `apps/core/src/index.ts`
- Modify: `apps/core/src/validation.ts`
- Modify: `packages/contracts/src/index.ts`
- Test: `apps/core/src/financial-safety.integration.test.ts`
- Modify: `apps/web/app/api/operations/route.ts`

**Interfaces:**
- Produces: `financialOperationDisposition(action: "CANCEL" | "REFUND", orderStatus: string): "REQUIRES_CANONICAL_ORCHESTRATION"`
- Produces: error code `FINANCIAL_OPERATION_REQUIRES_REVIEW`
- Guarantees: compatibility command performs no refund/order/inventory/capacity/demand mutation

- [ ] **Step 1: Write failing domain and integration tests**

Assert that both actions on a paid `COMMITTED` order return `FINANCIAL_OPERATION_REQUIRES_REVIEW`. Snapshot counts and row versions before/after; assert no change in `refund`, `payment_attempt`, `grocery_order`, `inventory_reservation`, `committed_procurement_demand`, `capacity_allocation`, `inventory_ledger_entries`, or `idempotency_records`.

- [ ] **Step 2: Run focused tests and prove failure**

Run: `pnpm --filter @freshmarkets/core exec vitest run --config vitest.config.ts src/orders/financial-safety.test.ts src/financial-safety.integration.test.ts`

Expected: FAIL because current `advanceOrder` inserts a successful refund and releases commitments.

- [ ] **Step 3: Implement fail-closed compatibility behavior**

Authorize and load the order first, then return the stable error before claiming idempotency or changing state. Remove the synthetic refund insert and cancellation release statements from the compatibility path. Keep the canonical replacement actions for Plan 07, not this slice. Update the generic Web operations route to surface the stable 409 response and never report success.

- [ ] **Step 4: Run focused regression tests**

Run: `pnpm --filter @freshmarkets/core exec vitest run --config vitest.config.ts src/orders/financial-safety.test.ts src/financial-safety.integration.test.ts && pnpm --filter @freshmarkets/web test`

Expected: all tests pass; zero-write assertions hold.

- [ ] **Step 5: Commit financial-operation containment**

Run: `git add apps/core/src/orders/financial-safety.ts apps/core/src/orders/financial-safety.test.ts apps/core/src/financial-safety.integration.test.ts apps/core/src/index.ts apps/core/src/validation.ts packages/contracts/src/index.ts apps/web/app/api/operations/route.ts && git commit -m "fix(orders): block synthetic refunds and cancellation"`

## Final Acceptance Gate

- [ ] Run: `pnpm --filter @freshmarkets/core exec vitest run --config vitest.config.ts src/payments/sandbox-policy.test.ts src/orders/financial-safety.test.ts src/financial-safety.integration.test.ts`
- [ ] Run: `pnpm --filter @freshmarkets/web test`
- [ ] Run: `pnpm test && pnpm lint && pnpm format:check`
- [ ] Run: `rg -n "INSERT INTO refund.*SUCCEEDED|paymentStatus:\s*\"SUCCEEDED\"|commitMockOrder" apps/core/src apps/web/app`
- [ ] Confirm any remaining `commitMockOrder` match is guarded by both explicit nonproduction environment and sandbox mode, and no production path inserts fabricated success.
- [ ] Confirm `git status --short` lists only files declared above.

**Acceptance criteria:** production/preview cannot manufacture payment or refund success; paid cancellation cannot silently release commitments; disabled operations make zero writes; explicit local sandbox behavior remains testable; no provider or unresolved product policy is invented.
