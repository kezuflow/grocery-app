# Coordinated Order Cancellation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement customer-visible, mode-aware cancellation with exact refund sets, Scheduled amendment coordination, FreshMarkets-caused full refunds, and audited staff exceptions.

**Architecture:** Orders owns cancellation policy and an explicit cancellation aggregate. Payments owns each provider refund; verified refund observations advance cancellation members, and Orders becomes `CANCELED` only when the required set succeeds. Operational effects release exactly once when a valid cancellation is accepted, independently from later financial retries.

**Tech Stack:** TypeScript, Cloudflare Workers, D1, Vitest Workers pool, typed Service Bindings, vinext/React, Playwright

**Spec:** `docs/superpowers/specs/2026-08-31/COMMERCE_PRICING_PAYMENTS_CANCELLATION_DESIGN.md`

## Global Constraints

- Instant customer cancellation closes on entry to `FULFILLMENT_PENDING`.
- Instant customer refund retains the snapshotted FreshMarkets Service Fee only.
- Scheduled customer cancellation closes at the earlier of the snapshotted cutoff or `FULFILLMENT_PENDING`.
- Scheduled cancellation refunds the original payment and all committed paid additions as one coordinated set.
- Additions cannot be canceled independently.
- FreshMarkets-caused cancellations refund every applicable payment in full.
- Post-lock exception refunds require `refunds.manage`, global scope, reason, and immutable audit evidence.
- Partial refund success never marks the Order canceled or duplicates a refund.
- Do not edit Admin Dashboard UI or Maps code.

---

### Task 1: Model cancellation policy as a pure domain decision

**Files:**
- Create: `apps/core/src/orders/domain/cancellation-policy.ts`
- Create: `apps/core/src/orders/domain/cancellation-policy.test.ts`
- Modify: `apps/core/src/orders/domain/order-state-machine.test.ts`

**Interfaces:**
- Consumes: actor, cause, fulfillment mode, Order state, cutoff, Service Fee, and gross payment total
- Produces: `decideOrderCancellation(input): CancellationDecision`

- [ ] **Step 1: Write the policy matrix tests**

```ts
expect(decideOrderCancellation({ actor: "CUSTOMER", cause: "CUSTOMER_REQUEST", mode: "INSTANT", orderState: "COMMITTED", serviceFeeMinor: 2500, grossPaidMinor: 100000, now, cutoffAt: null })).toMatchObject({ allowed: true, refundMinor: 97500 });
expect(decideOrderCancellation({ actor: "CUSTOMER", cause: "CUSTOMER_REQUEST", mode: "INSTANT", orderState: "FULFILLMENT_PENDING", serviceFeeMinor: 2500, grossPaidMinor: 100000, now, cutoffAt: null })).toMatchObject({ allowed: false, code: "CANCELLATION_WINDOW_CLOSED" });
expect(decideOrderCancellation({ actor: "CUSTOMER", cause: "CUSTOMER_REQUEST", mode: "SCHEDULED", orderState: "COMMITTED", serviceFeeMinor: 0, grossPaidMinor: 100000, now, cutoffAt: now + 1 })).toMatchObject({ allowed: true, refundMinor: 100000 });
expect(decideOrderCancellation({ actor: "CUSTOMER", cause: "CUSTOMER_REQUEST", mode: "SCHEDULED", orderState: "FULFILLMENT_PENDING", serviceFeeMinor: 0, grossPaidMinor: 100000, now, cutoffAt: now + 1 })).toMatchObject({ allowed: false, code: "CANCELLATION_WINDOW_CLOSED" });
expect(decideOrderCancellation({ actor: "BUSINESS", cause: "STOCK_UNAVAILABLE", mode: "INSTANT", orderState: "FULFILLMENT_PENDING", serviceFeeMinor: 2500, grossPaidMinor: 100000, now, cutoffAt: null })).toMatchObject({ allowed: true, refundMinor: 100000 });
```

Cover every Order state, equality at cutoff, missing cutoff, zero Service Fee, and unsafe totals.

- [ ] **Step 2: Run and confirm failure**

```powershell
pnpm --filter @freshmarkets/core test -- src/orders/domain/cancellation-policy.test.ts src/orders/domain/order-state-machine.test.ts
```

Expected: FAIL because the policy does not exist.

- [ ] **Step 3: Implement the closed decision types**

```ts
export type CancellationActor = "CUSTOMER" | "BUSINESS" | "STAFF_EXCEPTION";
export type CancellationCause = "CUSTOMER_REQUEST" | "STOCK_UNAVAILABLE" | "OPERATIONAL_FAILURE" | "FAILED_DELIVERY" | "DUPLICATE_CHARGE" | "DAMAGED_GOODS" | "OTHER";
export type CancellationDecision =
  | { allowed: true; retainedServiceFeeMinor: number; refundMinor: number }
  | { allowed: false; code: "CANCELLATION_WINDOW_CLOSED" | "ORDER_NOT_CANCELABLE" | "CUTOFF_EVIDENCE_MISSING" };
```

Customer cancellation is allowed only in `COMMITTED`. Scheduled additionally requires `now < cutoffAt`; this makes the lock the earlier of cutoff or fulfillment start. Business cancellation can enter the existing exception/cancellation path but cannot rewrite a delivered Order without the staff-exception command.

- [ ] **Step 4: Run domain tests**

```powershell
pnpm --filter @freshmarkets/core test -- src/orders/domain/cancellation-policy.test.ts src/orders/domain/order-state-machine.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/core/src/orders/domain
git commit -m "feat(orders): define cancellation policy"
```

### Task 2: Persist cancellation aggregates and refund members

**Files:**
- Create: `apps/core/migrations/0050_coordinated_order_cancellations.sql`
- Modify: `apps/core/src/orders/infrastructure/order-schema.integration.test.ts`
- Modify: `apps/core/src/iam/order-issue-migration.integration.test.ts`

**Interfaces:**
- Consumes: Order, original Payment Intent, amendment Payment Intents, and Task 1 decision
- Produces: `order_cancellation` and `order_cancellation_refund_member`

- [ ] **Step 1: Write failing schema tests**

```ts
expect(await columns(env.DB, "order_cancellation")).toContain("retained_service_fee_minor");
expect(await columns(env.DB, "order_cancellation_refund_member")).toEqual(
  expect.arrayContaining(["payment_intent_id", "required_amount_minor", "refund_id", "status"]),
);
```

- [ ] **Step 2: Run and confirm failure**

```powershell
pnpm --filter @freshmarkets/core test -- src/orders/infrastructure/order-schema.integration.test.ts src/iam/order-issue-migration.integration.test.ts
```

Expected: FAIL because migration `0050` is absent.

- [ ] **Step 3: Add migration `0050`**

```sql
CREATE TABLE order_cancellation (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE REFERENCES grocery_order(id),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('CUSTOMER','BUSINESS','STAFF_EXCEPTION')),
  cause TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('REQUESTED','REFUNDS_PROCESSING','COMPLETED','EXCEPTION')),
  retained_service_fee_minor INTEGER NOT NULL CHECK (retained_service_fee_minor >= 0),
  required_refund_minor INTEGER NOT NULL CHECK (required_refund_minor >= 0),
  version INTEGER NOT NULL CHECK (version >= 1),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

The member table has a unique `(cancellation_id, payment_intent_id)`, nullable unique `refund_id`, required amount/currency, canonical status, attempts, and timestamps. Add indexes for due/unfinished sets. Reuse existing audit tables for staff evidence rather than duplicating Audit ownership.

- [ ] **Step 4: Run migration checks**

```powershell
pnpm migration:check
pnpm --filter @freshmarkets/core test -- src/orders/infrastructure/order-schema.integration.test.ts src/iam/order-issue-migration.integration.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/core/migrations/0050_coordinated_order_cancellations.sql apps/core/src/orders/infrastructure apps/core/src/iam
git commit -m "feat(orders): persist cancellation refund sets"
```

### Task 3: Build the idempotent cancellation coordinator

**Files:**
- Replace internals: `apps/core/src/orders/application/cancel-order.ts`
- Create: `apps/core/src/orders/application/build-cancellation-refund-set.ts`
- Create: `apps/core/src/orders/application/advance-order-cancellation.ts`
- Modify: `apps/core/src/orders/application/cancel-order.integration.test.ts`
- Create: `apps/core/src/orders/application/coordinated-cancellation.integration.test.ts`
- Modify: `apps/core/src/payments/application/ingest-provider-event.ts`
- Modify: `apps/core/src/payments/application/reconcile-payment.ts`

**Interfaces:**
- Consumes: Task 1 decision, Task 2 tables, Payments `requestRefund`
- Produces: `requestOrderCancellation` and replay-safe `advanceOrderCancellation`

- [ ] **Step 1: Write failing multi-payment tests**

```ts
const cancellation = await requestOrderCancellation(db, scheduledOrderWithTwoAmendments);
expect(cancellation.value.refunds).toHaveLength(3);
await observeRefundSucceeded(cancellation.value.refunds[0].refundId);
expect(await orderState(orderId)).toBe("CANCELLATION_REQUESTED");
await observeRemainingRefundsSucceeded(cancellation.value.refunds.slice(1));
expect(await orderState(orderId)).toBe("CANCELED");
```

Also test one rejected member, retry/replay, duplicate observation, non-committed amendment closure, exact Instant retained Service Fee, and business full refund.

- [ ] **Step 2: Run and confirm failure**

```powershell
pnpm --filter @freshmarkets/core test -- src/orders/application/cancel-order.integration.test.ts src/orders/application/coordinated-cancellation.integration.test.ts
```

Expected: current single-refund implementation prematurely finalizes or omits amendments.

- [ ] **Step 3: Implement cancellation acceptance transaction**

In one D1 batch:

```text
claim command idempotency
compare expected Order version
insert cancellation aggregate and all refund members
transition Order to CANCELLATION_REQUESTED
release inventory reservations / committed demand / capacity exactly once
close non-committed amendments
record audit evidence
complete idempotency claim
```

After persistence, request each unrequested refund through Payments using `order-cancel:{cancellationId}:{paymentIntentId}`. Provider timeouts leave the member retryable; they do not roll back operational cancellation.

- [ ] **Step 4: Advance only from canonical refund observations**

```ts
export async function advanceOrderCancellation(
  database: D1Database,
  input: { paymentIntentId: string; refundId: string; refundState: RefundState },
): Promise<{ applied: boolean; completed: boolean }>;
```

Wire both webhook ingestion and reconciliation to this function. Transition to `CANCELED` only when no member is outside `SUCCEEDED`.

- [ ] **Step 5: Run focused Order/Payments tests and commit**

```powershell
pnpm --filter @freshmarkets/core test -- src/orders/application src/payments/application/refund.integration.test.ts src/payments/application/ingest-provider-event.integration.test.ts src/payments/application/reconciliation.integration.test.ts
git add apps/core/src/orders/application apps/core/src/payments/application
git commit -m "feat(orders): coordinate cancellation refunds"
```

### Task 4: Publish customer and staff cancellation contracts

**Files:**
- Modify: `packages/contracts/src/orders.ts`
- Modify: `packages/contracts/src/core-service.ts`
- Modify: `packages/contracts/src/orders.test.ts`
- Modify: `apps/core/src/entrypoint/orders-rpc.ts`
- Modify: `apps/core/src/index.ts`
- Modify: `apps/core/src/admin/application/finance-commands.ts`
- Modify: `apps/core/src/admin/application/admin-finance.integration.test.ts`

**Interfaces:**
- Consumes: coordinator from Task 3
- Produces: customer `cancelCustomerOrder` and audited staff exception surface

- [ ] **Step 1: Write failing contract tests**

```ts
export type CancelCustomerOrderRequest = AuthenticatedRequest & {
  orderId: string;
  expectedVersion: number;
  reason: string;
  idempotencyKey: string;
};

export type OrderCancellationView = {
  cancellationId: string;
  status: "REQUESTED" | "REFUNDS_PROCESSING" | "COMPLETED" | "EXCEPTION";
  requiredRefundMinor: number;
  retainedServiceFeeMinor: number;
  currency: string;
  refunds: readonly { paymentId: string; refundId: string | null; amountMinor: number; status: RefundState | "NOT_REQUESTED" }[];
};
```

- [ ] **Step 2: Run and confirm failure**

```powershell
pnpm --filter @freshmarkets/contracts test -- src/orders.test.ts src/core-service.test.ts
pnpm --filter @freshmarkets/core test -- src/entrypoint/orders-rpc.test.ts src/admin/application/admin-finance.integration.test.ts
```

Expected: methods/types do not exist.

- [ ] **Step 3: Implement ownership and capability boundaries**

Add `cancelCustomerOrder` to `OrdersService`; resolve Customer ownership in Core. Staff exception commands continue through Admin finance surfaces, require `refunds.manage` and global scope, and pass actor/cause/reason into the coordinator. Customer input cannot select `BUSINESS` or `STAFF_EXCEPTION`.

- [ ] **Step 4: Run contracts, RPC, and authorization tests**

```powershell
pnpm --filter @freshmarkets/contracts test
pnpm --filter @freshmarkets/core test -- src/entrypoint/orders-rpc.test.ts src/admin/application/admin-finance.integration.test.ts src/orders/application
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add packages/contracts/src apps/core/src/entrypoint/orders-rpc.ts apps/core/src/index.ts apps/core/src/admin/application
git commit -m "feat(orders): expose authorized cancellation commands"
```

### Task 5: Add customer cancellation experience

**Files:**
- Modify: `apps/core/src/orders/application/get-customer-order-detail.ts`
- Modify: `apps/core/src/orders/application/get-customer-order-detail.integration.test.ts`
- Create: `apps/web/app/api/commerce/orders/[order-id]/cancel/route.ts`
- Create: `apps/web/app/api/commerce/orders/[order-id]/cancel/route.test.ts`
- Create: `apps/web/components/storefront/orders/cancel-order-action.tsx`
- Create: `apps/web/components/storefront/orders/cancel-order-action.test.tsx`
- Modify: `apps/web/app/orders/[order-id]/page.tsx`
- Modify: `apps/web/app/orders/[order-id]/page.test.tsx`
- Create: `apps/web/tests/customer-order-cancellation.spec.ts`

**Interfaces:**
- Consumes: Task 4 contract and Core-derived action availability
- Produces: accessible cancellation confirmation/progress UI

- [ ] **Step 1: Write action-availability and UI tests**

```ts
expect(instantCommitted.actions).toContainEqual({ action: "CANCEL", available: true, disabledReason: null });
expect(instantPicking.actions).toContainEqual(expect.objectContaining({ action: "CANCEL", available: false }));
expect(scheduledBeforeCutoff.actions).toContainEqual(expect.objectContaining({ action: "CANCEL", available: true }));
```

The component test confirms reason entry, explicit refund summary, stale-version refresh, processing state, and no optimistic `CANCELED` label.

- [ ] **Step 2: Run and confirm failure**

```powershell
pnpm --filter @freshmarkets/core test -- src/orders/application/get-customer-order-detail.integration.test.ts
pnpm --filter @freshmarkets/web test -- components/storefront/orders/cancel-order-action.test.tsx app/orders/[order-id]/page.test.tsx
```

Expected: cancellation remains hard-coded unavailable.

- [ ] **Step 3: Implement thin Web route and Core-derived UI**

The route forwards session headers, `orderId`, `expectedVersion`, `reason`, and idempotency key to Core. The component renders the exact refundable amount and retained FreshMarkets Service Fee supplied by Core, not a client calculation.

- [ ] **Step 4: Run focused and end-to-end tests**

```powershell
pnpm --filter @freshmarkets/web test -- app/api/commerce/orders/[order-id]/cancel components/storefront/orders/cancel-order-action.test.tsx app/orders/[order-id]/page.test.tsx
pnpm --filter @freshmarkets/web test:e2e -- customer-order-cancellation.spec.ts
```

Expected: PASS for eligible Instant/Scheduled flows and locked-state messaging.

- [ ] **Step 5: Commit**

```powershell
git add apps/core/src/orders/application/get-customer-order-detail* apps/web/app/api/commerce/orders apps/web/components/storefront/orders apps/web/app/orders apps/web/tests/customer-order-cancellation.spec.ts
git commit -m "feat(storefront): add order cancellation flow"
```

### Task 6: Document and verify cancellation invariants

**Files:**
- Modify: `docs/architecture/DOMAIN_MODEL.md`
- Modify: `docs/architecture/STATE_MACHINES.md`
- Modify: `docs/architecture/DATA_MODEL.md`
- Modify: `docs/architecture/API_CONTRACTS.md`
- Modify: `docs/product/PRODUCT_SCOPE.md`
- Modify: `docs/product/IMPLEMENTATION_PLAN.md`
- Modify: `docs/product/IMPLEMENTATION_STATUS.md`

**Interfaces:**
- Consumes: Tasks 1-5
- Produces: canonical cancellation/refund policy and verified program

- [ ] **Step 1: Update canonical rules**

Document the policy matrix, refund-set aggregate, operational-release timing, amendment coordination, staff exceptions, and customer action DTOs.

- [ ] **Step 2: Run the program gate**

```powershell
pnpm migration:check
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

- [ ] **Step 3: Commit**

```powershell
git add docs
git commit -m "docs(orders): define coordinated cancellation"
```
