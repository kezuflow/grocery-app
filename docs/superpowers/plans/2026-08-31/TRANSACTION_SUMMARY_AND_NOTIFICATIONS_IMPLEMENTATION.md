# Transaction Summary and Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give customers a printable provisional transaction summary and durable cancellation/refund email updates without claiming official BIR invoice issuance.

**Architecture:** Orders projects a purpose-built transaction summary from immutable Order, payment, amendment, and invoice-readiness snapshots. Notifications projects authoritative cancellation/refund transitions into the existing durable outbox; Cloudflare Email delivery remains a retryable adapter and production sender activation stays externally gated.

**Tech Stack:** TypeScript, Cloudflare Workers, D1, typed Service Bindings, vinext/React, CSS print media, Vitest, Playwright, Cloudflare Email binding

**Spec:** `docs/superpowers/specs/2026-08-31/COMMERCE_PRICING_PAYMENTS_CANCELLATION_DESIGN.md`

## Global Constraints

- The document must say `NOT AN OFFICIAL BIR INVOICE` prominently.
- It must not allocate an official serial, invent taxpayer facts, compute unapproved VAT, or claim regulatory compliance.
- All amounts come from immutable Core snapshots; Web performs presentation only.
- Notification failure never rolls back Order, Payment, Refund, or cancellation state.
- Intended sender is `notifications@freshmarkets.ph`, but production remains fail-closed until the domain is onboarded and configured.
- Do not edit Admin Dashboard or Maps implementation files.

---

### Task 1: Publish a bounded provisional transaction-summary read model

**Files:**
- Modify: `packages/contracts/src/orders.ts`
- Modify: `packages/contracts/src/core-service.ts`
- Modify: `packages/contracts/src/orders.test.ts`
- Create: `apps/core/src/orders/application/get-provisional-transaction-summary.ts`
- Create: `apps/core/src/orders/application/get-provisional-transaction-summary.integration.test.ts`
- Modify: `apps/core/src/entrypoint/orders-rpc.ts`
- Modify: `apps/core/src/index.ts`

**Interfaces:**
- Consumes: immutable Order/item/address/financial snapshots, Payments/Refund summaries, amendments, and invoice readiness
- Produces: `getProvisionalTransactionSummary(request): RpcResult<ProvisionalTransactionSummaryView>`

- [ ] **Step 1: Write failing contract and projection tests**

```ts
export type ProvisionalTransactionSummaryView = {
  documentKind: "PROVISIONAL_TRANSACTION_SUMMARY";
  disclaimer: "NOT AN OFFICIAL BIR INVOICE";
  orderNumber: string;
  committedAt: string;
  currency: string;
  buyer: { recipient: string | null; addressLines: readonly string[] };
  lines: readonly CustomerOrderLineSnapshot[];
  financial: CustomerOrderFinancialView;
  payments: CustomerOrderDetailView["payments"];
  refunds: CustomerOrderDetailView["refunds"];
  amendments: CustomerOrderDetailView["amendments"];
  officialInvoice: { status: "NOT_READY" | "READY" | "ISSUED"; identifier: string | null };
};
```

Test ownership concealment, legacy total-only Orders, Instant Service Fee, Scheduled zero Service Fee, amendments, refunds, and absence of seller/TIN/tax-policy internals.

- [ ] **Step 2: Run and confirm failure**

```powershell
pnpm --filter @freshmarkets/contracts test -- src/orders.test.ts src/core-service.test.ts
pnpm --filter @freshmarkets/core test -- src/orders/application/get-provisional-transaction-summary.integration.test.ts
```

Expected: read model and method do not exist.

- [ ] **Step 3: Implement the projection and RPC**

Core derives the summary from the same safe parsing and financial helpers used by customer Order detail. It returns the literal disclaimer from the contract, never accepts it from storage/client input, and maps incomplete invoice readiness to `NOT_READY`.

- [ ] **Step 4: Run contracts/Core tests**

```powershell
pnpm --filter @freshmarkets/contracts test -- src/orders.test.ts src/core-service.test.ts
pnpm --filter @freshmarkets/core test -- src/orders/application/get-provisional-transaction-summary.integration.test.ts src/entrypoint/orders-rpc.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add packages/contracts/src apps/core/src/orders/application/get-provisional-transaction-summary* apps/core/src/entrypoint/orders-rpc.ts apps/core/src/index.ts
git commit -m "feat(orders): expose provisional transaction summaries"
```

### Task 2: Build the printable customer document

**Files:**
- Create: `apps/web/app/api/commerce/orders/[order-id]/transaction-summary/route.ts`
- Create: `apps/web/app/api/commerce/orders/[order-id]/transaction-summary/route.test.ts`
- Create: `apps/web/app/orders/[order-id]/transaction-summary/page.tsx`
- Create: `apps/web/app/orders/[order-id]/transaction-summary/page.test.tsx`
- Create: `apps/web/components/storefront/orders/transaction-summary.tsx`
- Create: `apps/web/components/storefront/orders/transaction-summary.test.tsx`
- Modify: `apps/web/app/orders/[order-id]/page.tsx`

**Interfaces:**
- Consumes: Task 1 read model
- Produces: accessible printable HTML summary; no PDF or official invoice

- [ ] **Step 1: Write failing rendering tests**

```tsx
expect(screen.getByText("NOT AN OFFICIAL BIR INVOICE")).toBeVisible();
expect(screen.getByText("FreshMarkets Service Fee")).toHaveTextContent("₱25.00");
expect(screen.queryByText(/TIN|official serial/i)).not.toBeInTheDocument();
```

Test total-only legacy display, refunds/amendments, print button, loading/error/not-found states, and no client recomputation.

- [ ] **Step 2: Run and confirm failure**

```powershell
pnpm --filter @freshmarkets/web test -- app/orders/[order-id]/transaction-summary components/storefront/orders/transaction-summary.test.tsx
```

Expected: FAIL because the page/component do not exist.

- [ ] **Step 3: Implement printable HTML**

Use semantic sections/tables, tabular numerals, and `@media print` rules that remove navigation/actions while keeping the disclaimer on every printed page header. The order-detail action label is `View transaction summary`, never `Download official invoice`.

- [ ] **Step 4: Run Web tests and vinext check**

```powershell
pnpm --filter @freshmarkets/web test -- app/api/commerce/orders/[order-id]/transaction-summary app/orders/[order-id]/transaction-summary components/storefront/orders/transaction-summary.test.tsx app/orders/[order-id]/page.test.tsx
pnpm --filter @freshmarkets/web check:vinext
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/web/app/api/commerce/orders apps/web/app/orders apps/web/components/storefront/orders
git commit -m "feat(storefront): add printable transaction summary"
```

### Task 3: Project cancellation and refund notifications

**Files:**
- Modify: `apps/core/src/notifications/domain/notification.ts`
- Modify: `apps/core/src/notifications/domain/notification.test.ts`
- Modify: `apps/core/src/notifications/application/project-domain-notifications.ts`
- Modify: `apps/core/src/notifications/application/notification-outbox.integration.test.ts`
- Modify: `apps/core/src/notifications/infrastructure/email-templates.ts`
- Modify: `apps/core/src/notifications/infrastructure/email-templates.test.ts`
- Modify: cancellation coordinator transition points from the prior plan

**Interfaces:**
- Consumes: authoritative cancellation/refund transitions
- Produces: durable notification intents for requested, progressing, completed, and exception states

- [ ] **Step 1: Write failing notification tests**

```ts
expect(projectCancellationNotification({ state: "REQUESTED" }).eventType).toBe("ORDER_CANCELLATION_REQUESTED");
expect(projectCancellationNotification({ state: "COMPLETED" }).eventType).toBe("ORDER_CANCELLATION_COMPLETED");
expect(projectCancellationNotification({ state: "EXCEPTION" }).eventType).toBe("ORDER_REFUND_EXCEPTION");
```

Integration tests assert one outbox row per transition idempotency key and safe replay after a scheduler retry.

- [ ] **Step 2: Run and confirm failure**

```powershell
pnpm --filter @freshmarkets/core test -- src/notifications
```

Expected: notification vocabulary/templates do not include cancellation events.

- [ ] **Step 3: Implement controlled templates and projections**

Add closed event types:

```ts
"ORDER_CANCELLATION_REQUESTED" | "ORDER_REFUND_PROGRESSING" | "ORDER_REFUND_COMPLETED" | "ORDER_CANCELLATION_COMPLETED" | "ORDER_REFUND_EXCEPTION"
```

Templates include order number, customer-safe state, amount/currency when authoritative, and support direction. They exclude provider references, internal exception details, staff identity, and routing authority.

- [ ] **Step 4: Run notification and scheduler tests**

```powershell
pnpm --filter @freshmarkets/core test -- src/notifications src/scheduling/jobs/notification-delivery.ts
```

Expected: PASS; delivery failure leaves canonical commerce state unchanged.

- [ ] **Step 5: Commit**

```powershell
git add apps/core/src/notifications apps/core/src/orders/application apps/core/src/scheduling
git commit -m "feat(notifications): report cancellation progress"
```

### Task 4: Document sender activation and verify the customer journey

**Files:**
- Modify: `apps/core/wrangler.jsonc` only if a non-secret sender variable placeholder is absent
- Modify: `apps/core/README.md`
- Modify: `apps/web/README.md`
- Modify: `docs/architecture/API_CONTRACTS.md`
- Modify: `docs/architecture/DATA_MODEL.md`
- Modify: `docs/product/IMPLEMENTATION_STATUS.md`
- Create: `apps/web/tests/transaction-summary-and-cancellation-email.spec.ts`

**Interfaces:**
- Consumes: Tasks 1-3 and existing Cloudflare Email adapter/outbox
- Produces: documented external activation steps and end-to-end customer evidence

- [ ] **Step 1: Add the customer-flow E2E test**

```ts
test("customer sees cancellation progress and a provisional transaction summary", async ({ page }) => {
  await openCommittedOrder(page);
  await page.getByRole("link", { name: "View transaction summary" }).click();
  await expect(page.getByText("NOT AN OFFICIAL BIR INVOICE")).toBeVisible();
});
```

The Core fixture also asserts the outbox contains the expected cancellation/refund template sequence.

- [ ] **Step 2: Document production sender requirements**

State that `AUTH_EMAIL_FROM=notifications@freshmarkets.ph` is intended but must not be enabled until `freshmarkets.ph` is owned, onboarded in Cloudflare Email, and authenticated. Missing configuration continues to produce durable retryable failure.

- [ ] **Step 3: Run final program checks**

```powershell
pnpm architecture:check
pnpm readiness:check
pnpm lint
pnpm typecheck
pnpm --filter @freshmarkets/core test -- src/notifications src/orders/application/get-provisional-transaction-summary.integration.test.ts
pnpm --filter @freshmarkets/web test
pnpm --filter @freshmarkets/web test:e2e -- transaction-summary-and-cancellation-email.spec.ts
pnpm --filter @freshmarkets/web check:vinext
pnpm --filter @freshmarkets/core build
pnpm --filter @freshmarkets/web build
git diff --check
```

Expected: all pass; Web build may retain only the established chunk-size advisory.

- [ ] **Step 4: Commit**

```powershell
git add apps/core/wrangler.jsonc apps/core/README.md apps/web/README.md docs apps/web/tests/transaction-summary-and-cancellation-email.spec.ts
git commit -m "docs(commerce): record transaction document readiness"
```
