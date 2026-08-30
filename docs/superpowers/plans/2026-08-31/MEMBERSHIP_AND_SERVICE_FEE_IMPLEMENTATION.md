# Membership and Service Fee Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Scheduled membership pricing globally configurable and grandfathered, make Instant checkout membership-free, and apply the global FreshMarkets Service Fee to Instant quotes only.

**Architecture:** Membership owns global price versions and agreed Subscription price snapshots. Checkout owns Service Fee resolution/calculation and snapshots its evidence into quotes and Orders; mode-aware eligibility requires membership only for Scheduled fulfillment. Capability-protected Core configuration methods are published for the separate Admin Dashboard workstream.

**Tech Stack:** TypeScript, Cloudflare Workers, D1/SQLite migrations, Vitest Workers pool, vinext/React, typed Service Bindings

**Spec:** `docs/superpowers/specs/2026-08-31/COMMERCE_PRICING_PAYMENTS_CANCELLATION_DESIGN.md`

## Global Constraints

- Membership has one global effective-dated price and currency.
- Existing Subscriptions retain their agreed price; new price versions affect only new Subscriptions.
- Instant checkout requires authentication but no membership.
- Scheduled checkout requires eligible membership.
- The global FreshMarkets Service Fee supports `FLAT`, `PERCENTAGE`, and `MIXED` and applies only to Instant.
- The percentage base is the complete payable amount before the Service Fee.
- Payment-time revalidation must reject stale fee evidence and require a replacement quote.
- Do not edit Admin Dashboard UI, Maps code, or migrations `0041`-`0047`.

---

### Task 1: Add pricing and Service Fee persistence

**Files:**
- Create: `apps/core/migrations/0048_membership_and_service_fee.sql`
- Modify: `apps/core/src/membership/infrastructure/membership-schema.integration.test.ts`
- Modify: `apps/core/src/checkout/infrastructure/checkout-schema.integration.test.ts`
- Modify: `apps/core/src/orders/infrastructure/order-schema.integration.test.ts`

**Interfaces:**
- Consumes: existing `subscription_offer`, `subscription`, `checkout_quote`, and `grocery_order`
- Produces: `membership_price_version`, `service_fee_configuration`, agreed Subscription price fields, and quote/Order fee evidence

- [ ] **Step 1: Write failing migration assertions**

```ts
expect(await columns(env.DB, "membership_price_version")).toContain("effective_from");
expect(await columns(env.DB, "subscription")).toEqual(
  expect.arrayContaining(["agreed_price_version_id", "agreed_amount_minor", "agreed_currency"]),
);
expect(await columns(env.DB, "service_fee_configuration")).toContain("percentage_basis_points");
expect(await columns(env.DB, "checkout_quote")).toContain("service_fee_snapshot_json");
expect(await columns(env.DB, "grocery_order")).toContain("service_fee_snapshot_json");
```

- [ ] **Step 2: Run schema tests and verify failure**

```powershell
pnpm --filter @freshmarkets/core test -- src/membership/infrastructure/membership-schema.integration.test.ts src/checkout/infrastructure/checkout-schema.integration.test.ts src/orders/infrastructure/order-schema.integration.test.ts
```

Expected: FAIL because migration `0048` and the new columns do not exist.

- [ ] **Step 3: Add migration `0048`**

Create these authoritative shapes:

```sql
CREATE TABLE membership_price_version (
  id TEXT PRIMARY KEY,
  offer_id TEXT NOT NULL REFERENCES subscription_offer(id),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL,
  effective_from INTEGER NOT NULL,
  effective_to INTEGER,
  version INTEGER NOT NULL CHECK (version >= 1),
  created_by_staff_id TEXT,
  created_at INTEGER NOT NULL,
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);

CREATE TABLE service_fee_configuration (
  id TEXT PRIMARY KEY,
  fee_type TEXT NOT NULL CHECK (fee_type IN ('FLAT','PERCENTAGE','MIXED')),
  flat_minor INTEGER NOT NULL CHECK (flat_minor >= 0),
  percentage_basis_points INTEGER NOT NULL CHECK (percentage_basis_points BETWEEN 0 AND 10000),
  currency TEXT NOT NULL,
  effective_from INTEGER NOT NULL,
  effective_to INTEGER,
  version INTEGER NOT NULL CHECK (version >= 1),
  created_by_staff_id TEXT,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  CHECK (effective_to IS NULL OR effective_to > effective_from),
  CHECK ((fee_type='FLAT' AND flat_minor>0 AND percentage_basis_points=0)
      OR (fee_type='PERCENTAGE' AND flat_minor=0 AND percentage_basis_points>0)
      OR (fee_type='MIXED' AND flat_minor>0 AND percentage_basis_points>0))
);
```

Add agreed-price fields to `subscription`; add `pre_service_fee_total_minor`, `service_fee_configuration_id`, and `service_fee_snapshot_json` to quote and Order tables. Backfill one price version from the existing active offer and backfill existing Subscriptions from that version. Do not seed a guessed Service Fee; missing configuration intentionally makes Instant checkout unavailable.

- [ ] **Step 4: Verify fresh and upgrade paths**

```powershell
pnpm migration:check
pnpm --filter @freshmarkets/core test -- src/membership/infrastructure/membership-schema.integration.test.ts src/checkout/infrastructure/checkout-schema.integration.test.ts src/orders/infrastructure/order-schema.integration.test.ts
```

Expected: PASS for fresh migration and the maintained upgrade fixtures.

- [ ] **Step 5: Commit**

```powershell
git add apps/core/migrations/0048_membership_and_service_fee.sql apps/core/src/membership/infrastructure apps/core/src/checkout/infrastructure apps/core/src/orders/infrastructure
git commit -m "feat(commerce): persist pricing configurations"
```

### Task 2: Implement exact Service Fee policy

**Files:**
- Create: `apps/core/src/checkout/domain/service-fee.ts`
- Create: `apps/core/src/checkout/domain/service-fee.test.ts`
- Create: `apps/core/src/checkout/application/resolve-service-fee.ts`
- Create: `apps/core/src/checkout/application/resolve-service-fee.integration.test.ts`

**Interfaces:**
- Consumes: active `service_fee_configuration` row and pre-fee financial total
- Produces: `calculateServiceFee(input): ServiceFeeCalculation` and `resolveServiceFee(database, input)`

- [ ] **Step 1: Write failing formula tests**

```ts
expect(calculateServiceFee({ feeType: "FLAT", flatMinor: 2500, basisPoints: 0, baseMinor: 100000 })).toMatchObject({ feeMinor: 2500 });
expect(calculateServiceFee({ feeType: "PERCENTAGE", flatMinor: 0, basisPoints: 350, baseMinor: 100001 })).toMatchObject({ feeMinor: 3501 });
expect(calculateServiceFee({ feeType: "MIXED", flatMinor: 1500, basisPoints: 300, baseMinor: 100000 })).toMatchObject({ feeMinor: 4500 });
```

Also test zero/negative bases, unsafe integers, invalid shape combinations, and ceiling at a fractional centavo.

- [ ] **Step 2: Run and confirm failure**

```powershell
pnpm --filter @freshmarkets/core test -- src/checkout/domain/service-fee.test.ts
```

Expected: FAIL because the module is missing.

- [ ] **Step 3: Implement the domain interface**

```ts
export type ServiceFeeCalculation = {
  configurationId: string;
  configurationVersion: number;
  feeType: "FLAT" | "PERCENTAGE" | "MIXED";
  currency: string;
  flatMinor: number;
  percentageBasisPoints: number;
  baseMinor: number;
  feeMinor: number;
};

export function calculateServiceFee(input: {
  configurationId?: string;
  configurationVersion?: number;
  feeType: ServiceFeeCalculation["feeType"];
  currency?: string;
  flatMinor: number;
  basisPoints: number;
  baseMinor: number;
}): ServiceFeeCalculation;
```

Use integer quotient/remainder arithmetic rather than floating point. `resolveServiceFee` must select exactly one effective row for the requested currency and instant; zero or multiple rows return `CONFIGURATION_ERROR`.

- [ ] **Step 4: Run domain and integration tests**

```powershell
pnpm --filter @freshmarkets/core test -- src/checkout/domain/service-fee.test.ts src/checkout/application/resolve-service-fee.integration.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/core/src/checkout/domain/service-fee.ts apps/core/src/checkout/domain/service-fee.test.ts apps/core/src/checkout/application/resolve-service-fee.ts apps/core/src/checkout/application/resolve-service-fee.integration.test.ts
git commit -m "feat(checkout): calculate global service fees"
```

### Task 3: Publish capability-protected configuration contracts

**Files:**
- Create: `packages/contracts/src/commerce-configuration.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/src/core-service.ts`
- Create: `apps/core/src/admin/application/commerce-configuration.ts`
- Create: `apps/core/src/admin/application/commerce-configuration.integration.test.ts`
- Create: `apps/core/src/entrypoint/commerce-configuration-rpc.ts`
- Modify: `apps/core/src/index.ts`

**Interfaces:**
- Consumes: Task 1 tables and existing `memberships.manage`/`payments.manage` capabilities
- Produces: four typed Core methods for reading/updating membership price and Service Fee

- [ ] **Step 1: Write contract and authorization tests first**

```ts
export type UpdateServiceFeeConfigurationRequest = AuthenticatedRequest & {
  expectedVersion: number;
  feeType: "FLAT" | "PERCENTAGE" | "MIXED";
  flatMinor: number;
  percentageBasisPoints: number;
  currency: string;
  effectiveFrom: string;
  reason: string;
  idempotencyKey: string;
};
```

Test that `payments.manage` plus global scope is required for Service Fee changes and `memberships.manage` plus global scope is required for membership price changes. Readers use `payments.read` and `memberships.read` respectively.

- [ ] **Step 2: Run and confirm failures**

```powershell
pnpm --filter @freshmarkets/contracts test -- src/core-service.test.ts
pnpm --filter @freshmarkets/core test -- src/admin/application/commerce-configuration.integration.test.ts
```

Expected: FAIL because contracts/RPC do not exist.

- [ ] **Step 3: Implement commands and reads**

Add these exact Core methods:

```ts
getMembershipPriceConfiguration(request): Promise<RpcResult<MembershipPriceConfigurationView>>;
updateMembershipPriceConfiguration(request): Promise<RpcResult<MembershipPriceConfigurationView>>;
getServiceFeeConfiguration(request): Promise<RpcResult<ServiceFeeConfigurationView>>;
updateServiceFeeConfiguration(request): Promise<RpcResult<ServiceFeeConfigurationView>>;
```

Commands close the prior effective range and insert a new version atomically, reject overlap/stale version/idempotency reuse, and record audit evidence. Do not add Admin Web pages in this task.

- [ ] **Step 4: Run focused contract/Core tests**

```powershell
pnpm --filter @freshmarkets/contracts test -- src/core-service.test.ts
pnpm --filter @freshmarkets/core test -- src/admin/application/commerce-configuration.integration.test.ts src/index.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add packages/contracts/src apps/core/src/admin/application/commerce-configuration* apps/core/src/entrypoint/commerce-configuration-rpc.ts apps/core/src/index.ts
git commit -m "feat(admin): expose commerce pricing configuration"
```

### Task 4: Snapshot global membership prices

**Files:**
- Modify: `packages/contracts/src/membership.ts`
- Modify: `apps/core/src/membership/application/get-membership-experience.ts`
- Modify: `apps/core/src/membership/application/start-promotional-trial.ts`
- Modify: `apps/core/src/membership/application/process-membership-renewals.ts`
- Modify: `apps/core/src/membership/infrastructure/d1/membership-repository.ts`
- Modify: `apps/core/src/membership/application/get-membership-experience.integration.test.ts`
- Modify: `apps/core/src/membership/application/process-membership-renewals.integration.test.ts`

**Interfaces:**
- Consumes: active membership price from Task 1
- Produces: offer `priceVersion`, Subscription `agreedAmountMinor`/`agreedCurrency`, renewal using agreed price

- [ ] **Step 1: Write grandfathering tests**

```ts
expect(firstSubscription.agreedAmountMinor).toBe(19900);
await installPrice({ amountMinor: 24900, version: 2 });
expect((await load(firstSubscription.id)).agreedAmountMinor).toBe(19900);
expect((await enrollSecondCustomer()).agreedAmountMinor).toBe(24900);
expect(await renewalAmount(firstSubscription.id)).toBe(19900);
```

- [ ] **Step 2: Run focused Membership tests**

```powershell
pnpm --filter @freshmarkets/core test -- src/membership/application/get-membership-experience.integration.test.ts src/membership/application/process-membership-renewals.integration.test.ts
```

Expected: FAIL because enrollment/renewal still reads `subscription_offer.fee_minor`.

- [ ] **Step 3: Implement price resolution and snapshots**

Extend the view:

```ts
export type MembershipOfferView = {
  offerId: string;
  priceVersionId: string;
  priceVersion: number;
  code: string;
  name: string;
  amountMinor: number;
  currency: string;
  billingInterval: "CALENDAR_MONTH";
};
```

Enrollment and trial creation atomically copy the active price into Subscription agreed fields. Renewal reads only those agreed fields. No command in this program reprices existing Subscriptions.

- [ ] **Step 4: Run Membership and Payments reaction tests**

```powershell
pnpm --filter @freshmarkets/core test -- src/membership src/payments/application/create-payment.integration.test.ts src/payments/application/reconciliation.integration.test.ts
pnpm --filter @freshmarkets/contracts test -- src/membership.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add packages/contracts/src/membership* apps/core/src/membership apps/core/src/payments/application
git commit -m "feat(membership): grandfather subscription prices"
```

### Task 5: Apply mode-aware eligibility and Instant Service Fees

**Files:**
- Modify: `apps/core/src/checkout/application/create-checkout-quote.ts`
- Modify: `apps/core/src/checkout/application/instant-quote.ts`
- Modify: `apps/core/src/checkout/application/revalidate-checkout-quote.ts`
- Modify: `apps/core/src/checkout/infrastructure/d1-checkout-repository.ts`
- Modify: `apps/core/src/orders/application/apply-checkout-payment-reaction.ts`
- Modify: `packages/contracts/src/checkout.ts`
- Modify: `apps/web/components/storefront/checkout/checkout-total-review.tsx`
- Modify: associated focused tests

**Interfaces:**
- Consumes: `resolveServiceFee`, Subscription entitlement, quote snapshot fields
- Produces: mode-aware quote/payment/commitment behavior and visible `FreshMarkets Service Fee`

- [ ] **Step 1: Write failing eligibility and formula integrations**

```ts
it("allows Instant checkout without membership and applies the active Service Fee", async () => {
  const quote = await createInstantQuoteFor(nonMember, mixedFee);
  expect(quote.serviceFeeMinor).toBe(expectedMixedFee);
});

it("rejects Scheduled checkout without eligible membership", async () => {
  expect(await createScheduledQuoteFor(nonMember)).toMatchObject({ ok: false, error: { code: "MEMBERSHIP_REQUIRED" } });
});
```

Also test revalidation after configuration change returns `PRICE_CHANGED`, and Order commitment copies the exact fee snapshot.

- [ ] **Step 2: Run and confirm failures**

```powershell
pnpm --filter @freshmarkets/core test -- src/checkout/application/instant-quote.integration.test.ts src/checkout/application/resolve-checkout-decision.integration.test.ts src/orders/application/instant-commitment.integration.test.ts
```

Expected: Instant non-member fails and Service Fee remains zero.

- [ ] **Step 3: Implement mode-aware flow**

Move entitlement checks after fulfillment-mode resolution. Scheduled executes `evaluateSubscriptionEntitlement`; Instant skips it. Calculate:

```ts
const preServiceFeeTotalMinor =
  merchandiseSubtotalMinor - itemDiscountMinor - orderDiscountMinor +
  deliverySubtotalMinor - deliveryDiscountMinor + taxMinor;
const serviceFee = await resolveServiceFee(database, { currency, baseMinor: preServiceFeeTotalMinor, at: now });
const totalMinor = preServiceFeeTotalMinor + serviceFee.feeMinor;
```

Persist the calculation snapshot in quote/Order evidence. Revalidation resolves current fee configuration and rejects any mismatch. Order commitment repeats entitlement only for Scheduled.

- [ ] **Step 4: Update customer presentation and tests**

Render `FreshMarkets Service Fee` only when `serviceFeeMinor > 0`. Run:

```powershell
pnpm --filter @freshmarkets/web test -- components/storefront/checkout/checkout-total-review.test.tsx app/checkout/checkout-client.test.tsx
pnpm --filter @freshmarkets/core test -- src/checkout src/orders/application/instant-commitment.integration.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/core/src/checkout apps/core/src/orders/application/apply-checkout-payment-reaction* packages/contracts/src/checkout* apps/web/components/storefront/checkout apps/web/app/checkout
git commit -m "feat(checkout): separate Instant and Scheduled pricing"
```

### Task 6: Update canonical commerce documentation and run the program gate

**Files:**
- Modify: `docs/architecture/ARCHITECTURE.md`
- Modify: `docs/architecture/DOMAIN_MODEL.md`
- Modify: `docs/architecture/STATE_MACHINES.md`
- Modify: `docs/architecture/DATA_MODEL.md`
- Modify: `docs/architecture/API_CONTRACTS.md`
- Modify: `docs/product/PRODUCT_SCOPE.md`
- Modify: `docs/product/IMPLEMENTATION_PLAN.md`
- Modify: `docs/product/IMPLEMENTATION_STATUS.md`

**Interfaces:**
- Consumes: implemented behavior from Tasks 1-5
- Produces: canonical rules matching runtime behavior

- [ ] **Step 1: Replace obsolete locked invariants**

Document the exact global/grandfathered membership price model, mode-specific entitlement, Service Fee formula, revalidation, and snapshots. Remove the fixed PHP 299.00 and universal-membership assertions.

- [ ] **Step 2: Run program verification**

```powershell
pnpm format:check
pnpm naming:check
pnpm terminology:check
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
git commit -m "docs(commerce): define launch pricing rules"
```
