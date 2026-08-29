# Admin Slices 1–9 Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all 30 findings in `ADMIN_SLICES_1_9_REVIEW.md` and make Admin Slices 1–9 conform to the canonical architecture, domain model, state machines, contracts, and readiness gates.

**Architecture:** Land the remediation in dependency order: command integrity first, canonical data migrations and contracts second, Core and Web workflows third, then authenticated browser/performance evidence. Every behavioral change follows red-green-refactor, and contracts, Core, Web, migrations, tests, and canonical documentation remain consistent at each commit.

**Tech Stack:** TypeScript, Cloudflare Workers Service Bindings, D1/SQLite migrations, vinext/React, Vitest with Worker-local integration, Playwright, oxfmt, oxlint.

**Spec:** `docs/superpowers/specs/ADMIN_SLICES_1_9_REMEDIATION_DESIGN.md`

## Global Constraints

- Preserve `apps/web -> typed Service Binding -> apps/core`; Web never accesses authoritative D1 directly.
- Preserve explicit commands, expected aggregate versions, stable idempotency keys, capability-based IAM, and purpose-built DTOs.
- Use forward-only migrations; do not edit existing migration files.
- Store money, base quantities, conversion factors, and versions as integers.
- Keep historical order, price, fulfillment, and delivery snapshots immutable.
- Use the canonical sourcing values `STOCKED`, `PLANNED`, `ON_DEMAND`, and `MIXED` only.
- Keep `RESOLVED` terminal for order issues.
- Do not change the existing owner edit in `docs/superpowers/plans/DOORDASH_REFERENCE_FRONTEND_PLAN.md`.
- Do not add public APIs, CORS, microservices, Durable Objects, Workflows, KV, or Queues.
- Run focused tests after every red-green cycle and the complete validation matrix before completion.

---

### Task 1: Make cancellation idempotency aggregate-safe

**Files:**

- Modify: `apps/core/src/orders/application/cancel-order.ts`
- Modify: `apps/core/src/admin/application/finance-commands.ts`
- Test: `apps/core/src/admin/application/admin-finance.integration.test.ts`
- Create: `apps/core/src/orders/application/cancel-order.integration.test.ts`

**Interfaces:**

- Consumes: `CancelOrderCommand { orderId, expectedVersion, reasonCode, idempotencyKey, requestId }`.
- Produces: a cancellation replay bound to the full command hash and original `orderId`; changed input returns `IDEMPOTENCY_CONFLICT` and never emits an Admin audit.

```ts
const hash = await requestHash({
  orderId: command.orderId,
  expectedVersion: command.expectedVersion,
  reasonCode: command.reasonCode,
});
// SUCCEEDED result_reference is the canceled order ID, not its state.
```

- [ ] **Step 1: Write the failing cross-order replay test**

  Seed two cancellable committed orders. Cancel the first with key `cancel-shared`, then submit the second with the same key. Assert `IDEMPOTENCY_CONFLICT`, the second order remains unchanged, and no `ORDER.CANCELED` audit names the second order.

- [ ] **Step 2: Run the focused test and verify RED**

  Run: `pnpm --filter @freshmarkets/core test -- src/admin/application/admin-finance.integration.test.ts`

  Expected: the second command currently reports success or creates false audit evidence.

- [ ] **Step 3: Bind the idempotency record to canonical input**

  Replace the constant hash with `requestHash({ orderId, expectedVersion, reasonCode })`. Persist the order ID as `result_reference`; on replay compare hashes, reload that order, and return its actual cancellation outcome.

- [ ] **Step 4: Guard the Admin audit against false replay**

  Make `cancelAdminOrder` append audit only for the order returned by the canonical command and only when the current invocation caused, or validly replayed, that same aggregate result.

- [ ] **Step 5: Run focused tests and verify GREEN**

  Run: `pnpm --filter @freshmarkets/core test -- src/orders/application/cancel-order.integration.test.ts src/admin/application/admin-finance.integration.test.ts`

- [ ] **Step 6: Commit**

  Run: `git add apps/core/src/orders/application/cancel-order.ts apps/core/src/admin/application/finance-commands.ts apps/core/src/orders/application/cancel-order.integration.test.ts apps/core/src/admin/application/admin-finance.integration.test.ts && git commit -m "fix(admin): bind cancellation idempotency to orders"`

### Task 2: Standardize atomic Admin command completion

**Files:**

- Create: `apps/core/src/admin/application/admin-command-batch.ts`
- Modify: `apps/core/src/admin/application/customer-commands.ts`
- Modify: `apps/core/src/admin/application/update-admin-staff.ts`
- Modify: `apps/core/src/admin/application/update-admin-role.ts`
- Modify: `apps/core/src/admin/application/archive-admin-role.ts`
- Modify: `apps/core/src/admin/application/revoke-admin-staff-sessions.ts`
- Modify: `apps/core/src/admin/application/promotion-commands.ts`
- Modify: `apps/core/src/admin/application/finance-commands.ts`
- Modify: `apps/core/src/admin/application/operations-commands.ts`
- Test: corresponding `apps/core/src/admin/application/admin-*.integration.test.ts` files

**Interfaces:**

- Produces: `runGuardedAdminCommand(database, { mutation, audit, idempotencySuccess, verify })`, which treats a zero-row CAS as stale and prevents audit/idempotency success from surviving it.
- Consumes: existing D1 prepared statements and existing audit/idempotency record formats; it does not introduce a new storage authority.

```ts
type GuardedAdminCommand = {
  statements: readonly D1PreparedStatement[];
  verify: () => Promise<boolean>;
  staleMessage: string;
};

export async function runGuardedAdminCommand(
  database: D1Database,
  command: GuardedAdminCommand,
): Promise<{ ok: true } | { ok: false; code: "STALE_VERSION" | "CONFLICT" }>;
```

- [ ] **Step 1: Add failing stale/privacy and injected-failure tests**

  For privacy action, staff update, role update/archive, session revocation, promotion grant, membership action, and one operations command, assert: a stale/failed mutation creates neither audit nor `SUCCEEDED` idempotency; an audit/idempotency failure does not leave the authoritative mutation committed.

- [ ] **Step 2: Run each affected integration file and verify RED**

  Run: `pnpm --filter @freshmarkets/core test -- src/admin/application/admin-customers.integration.test.ts src/admin/application/admin-staff-access.integration.test.ts src/admin/application/admin-roles.integration.test.ts src/admin/application/admin-promotions.integration.test.ts src/admin/application/admin-finance.integration.test.ts src/admin/application/admin-operations-commands.integration.test.ts`

- [ ] **Step 3: Implement the guarded batch helper**

  Accept prepared statements plus a post-batch verification query. Return `STALE_VERSION` when the expected aggregate version was not advanced. Ensure audit and idempotency statements contain the same guard where D1 batching cannot branch.

- [ ] **Step 4: Migrate each listed command to the helper**

  Remove standalone ignored audit writes and unconditional idempotency completion. Keep the command's existing capability, reason, and result DTO behavior.

- [ ] **Step 5: Run affected tests and verify GREEN**

  Run the command from Step 2 and assert all suites pass.

- [ ] **Step 6: Commit**

  Run: `git add apps/core/src/admin/application && git commit -m "fix(admin): make command audit completion atomic"`

### Task 3: Normalize Core RPC input and correct customer/audit reads

**Files:**

- Modify: `apps/core/src/index.ts`
- Modify: `apps/core/src/admin/application/list-admin-customers.ts`
- Modify: `apps/core/src/admin/application/customer-commands.ts`
- Modify: `apps/web/app/api/admin/privacy-requests/route.ts`
- Create: `apps/web/app/admin/audit/[audit-event-id]/page.tsx`
- Test: `apps/core/src/admin/application/admin-customers.integration.test.ts`
- Test: `apps/core/src/audit/application/admin-audit.integration.test.ts`
- Test: `apps/web/app/api/admin/customer-routes.test.ts`
- Test: `apps/web/app/api/admin/foundation-routes.test.ts`

**Interfaces:**

- Produces: every validated Core endpoint delegates `validation.data`; CRM order summaries count committed orders using `committed_at`; invalid privacy status returns `VALIDATION_FAILED`; audit detail is reachable at its existing link.

```ts
const validation = requestSchema.safeParse(input);
if (!validation.success) return fail(/* existing validation response */);
return command(deps, validation.data);
```

```sql
SELECT COUNT(*), MAX(committed_at)
FROM grocery_order
WHERE customer_id = ? AND committed_at IS NOT NULL;
```

- [ ] **Step 1: Add failing normalization and committed-order tests**

  Prove trimmed IDs/filter values reach the command and seed draft plus committed orders to assert only committed rows contribute to `orderCount` and `lastOrderAt`.

- [ ] **Step 2: Add failing privacy filter and audit-route tests**

  Assert an unknown privacy status returns 400/`VALIDATION_FAILED`, and render the audit detail route for success, not-found, forbidden, and redacted payloads.

- [ ] **Step 3: Run focused tests and verify RED**

  Run: `pnpm --filter @freshmarkets/core test -- src/admin/application/admin-customers.integration.test.ts src/audit/application/admin-audit.integration.test.ts && pnpm --filter @freshmarkets/web test -- app/api/admin/customer-routes.test.ts app/api/admin/foundation-routes.test.ts`

- [ ] **Step 4: Delegate schema output and repair reads/routes**

  Replace raw `input` delegation with `validation.data` across Admin Core entrypoints, filter customer order summaries on canonical commitment, reject invalid status values, and implement the audit detail page using the existing API.

- [ ] **Step 5: Run focused tests and verify GREEN**

  Repeat Step 3.

- [ ] **Step 6: Commit**

  Run: `git add apps/core/src/index.ts apps/core/src/admin/application apps/core/src/audit/application apps/web/app/admin/audit apps/web/app/api/admin && git commit -m "fix(admin): normalize requests and correct audit crm reads"`

### Task 4: Complete IAM scope and staff workflows

**Files:**

- Modify: `packages/contracts/src/admin-staff-access.ts`
- Modify: `packages/contracts/src/admin-staff-access.test.ts`
- Create: `apps/core/src/admin/application/revoke-admin-staff-invitation.ts`
- Modify: `apps/core/src/admin/application/set-admin-staff-scopes.ts`
- Modify: `apps/core/src/index.ts`
- Create: `apps/web/app/api/admin/staff/invitations/[invitation-id]/revoke/route.ts`
- Modify: `apps/web/app/admin/staff/page.tsx`
- Modify: `apps/web/app/admin/staff/[staff-id]/page.tsx`
- Modify: `apps/web/app/api/admin/staff/[staff-id]/route.ts`
- Modify: `apps/web/app/api/admin/staff/[staff-id]/scopes/route.ts`
- Test: `apps/core/src/admin/application/admin-staff-access.integration.test.ts`
- Test: `apps/web/app/api/admin/staff-access-routes.test.ts`
- Test: `apps/web/tests/admin-staff-access.spec.ts`

**Interfaces:**

- Produces: `revokeAdminStaffInvitation({ invitationId, reason, idempotencyKey })`; staff detail mutations consume Core-derived versions; scope assignment validates active market/location geography.

```ts
export type RevokeAdminStaffInvitationRequest = AuthenticatedRequest & {
  invitationId: string;
  reason: string;
  idempotencyKey: string;
};
```

```ts
await fetch(`/api/admin/staff/invitations/${invitationId}/revoke`, {
  method: "POST",
  body: JSON.stringify({ reason, idempotencyKey }),
});
```

- [ ] **Step 1: Add failing contract/Core tests**

  Test invitation revocation replay/conflict/audit, unknown and inactive geography rejection, staff update stale versions, role assignment, and scope replacement.

- [ ] **Step 2: Verify RED with contract and Core suites**

  Run: `pnpm --filter @freshmarkets/contracts test -- src/admin-staff-access.test.ts && pnpm --filter @freshmarkets/core test -- src/admin/application/admin-staff-access.integration.test.ts`

- [ ] **Step 3: Implement the invitation command and geography validation**

  Add the typed RPC method, Core command, guarded audit/idempotency behavior, and BFF revoke route. Verify referenced global/market/location scopes against canonical geography and active state.

- [ ] **Step 4: Complete the staff Web controls**

  Replace the broken invitation POST, add status/profile, roles, and scopes controls, submit current versions, preserve retry keys, and render permission/stale/error states.

- [ ] **Step 5: Run focused Core/Web/browser tests and verify GREEN**

  Run: `pnpm --filter @freshmarkets/core test -- src/admin/application/admin-staff-access.integration.test.ts && pnpm --filter @freshmarkets/web test -- app/api/admin/staff-access-routes.test.ts && pnpm --filter @freshmarkets/web exec playwright test tests/admin-staff-access.spec.ts`

- [ ] **Step 6: Commit**

  Run: `git add packages/contracts/src/admin-staff-access* apps/core/src/admin apps/core/src/index.ts apps/web/app/admin/staff apps/web/app/api/admin/staff apps/web/tests/admin-staff-access.spec.ts && git commit -m "fix(admin): complete staff and scope administration"`

### Task 5: Make Admin scope selection explicit

**Files:**

- Modify: `packages/contracts/src/admin-foundation.ts`
- Modify: `packages/contracts/src/admin-analytics.ts`
- Modify: `apps/core/src/analytics/application/analytics-access.ts`
- Modify: scoped Admin access helpers under `apps/core/src/admin/application/*-administration-access.ts`
- Modify: `apps/web/app/admin/admin-context-provider.tsx`
- Modify: `apps/web/components/admin/admin-shell.tsx`
- Modify: `apps/web/components/admin/use-admin-location.ts`
- Modify: all scoped Admin pages and BFF route utilities
- Test: `apps/core/src/admin/application/admin-context.integration.test.ts`
- Test: `apps/core/src/analytics/application/analytics.integration.test.ts`
- Test: `apps/web/components/admin/admin-accessibility.test.tsx`
- Test: `apps/web/tests/admin-foundation.spec.ts`
- Test: `apps/web/tests/admin-analytics.spec.ts`

**Interfaces:**

- Produces: `AdminSelectedScope { kind, marketId?, locationId? }`, selected explicitly in Web session state and supplied to scoped RPC calls; ambiguous omission returns validation failure.

```ts
export type AdminSelectedScope =
  | { kind: "GLOBAL" }
  | { kind: "MARKET"; marketId: string }
  | { kind: "LOCATION"; marketId: string; locationId: string };
```

```ts
if (!request.scope && context.scopes.length > 1) {
  return failure("VALIDATION_FAILED", "Select an Admin scope", request.requestId);
}
```

- [ ] **Step 1: Add failing multi-scope Core tests**

  Seed a staff identity with two location scopes. Assert analytics and scoped operations reject omitted scope, accept either assigned explicit scope, and reject an unassigned scope.

- [ ] **Step 2: Add failing provider/shell tests**

  Assert scope-load failure renders an error, multi-scope users see a selector, the selection survives navigation/session storage, and scoped requests contain the selection.

- [ ] **Step 3: Run focused suites and verify RED**

  Run: `pnpm --filter @freshmarkets/core test -- src/admin/application/admin-context.integration.test.ts src/analytics/application/analytics.integration.test.ts && pnpm --filter @freshmarkets/web test -- components/admin/admin-accessibility.test.tsx`

- [ ] **Step 4: Implement explicit selection end to end**

  Add the shared DTO, verify assignments in Core, remove `context.scopes[0]` fallback, make scope-load failure explicit, and route all scoped pages through the selected-scope provider.

- [ ] **Step 5: Run focused and browser tests and verify GREEN**

  Run: `pnpm --filter @freshmarkets/core test -- src/admin/application/admin-context.integration.test.ts src/analytics/application/analytics.integration.test.ts && pnpm --filter @freshmarkets/web test -- components/admin/admin-accessibility.test.tsx && pnpm --filter @freshmarkets/web exec playwright test tests/admin-foundation.spec.ts tests/admin-analytics.spec.ts`

- [ ] **Step 6: Commit**

  Run: `git add packages/contracts apps/core/src/admin apps/core/src/analytics apps/web/app/admin apps/web/app/api/admin apps/web/components/admin apps/web/tests && git commit -m "feat(admin): require explicit operational scope"`

### Task 6: Migrate catalog units, SKU quantities, and sourcing vocabulary

**Files:**

- Create: `apps/core/migrations/0034_admin_catalog_canonicalization.sql`
- Modify: `packages/contracts/src/admin-catalog.ts`
- Modify: `packages/contracts/src/admin-catalog.test.ts`
- Modify: `packages/contracts/src/catalog.ts`
- Modify: `apps/core/src/admin/application/catalog-commands.ts`
- Modify: `apps/core/src/admin/application/catalog-reads.ts`
- Modify: catalog seed generator/types under `apps/core/src/catalog/seed/`
- Modify: `apps/core/scripts/generate-produce-catalog.ts`
- Test: `apps/core/src/admin/application/admin-catalog.integration.test.ts`
- Test: `apps/core/src/catalog/catalog-schema.integration.test.ts`
- Test: `apps/core/src/catalog/seed/produce-catalog.integrity.test.ts`
- Create: `apps/core/src/iam/admin-catalog-canonicalization-migration.integration.test.ts`

**Interfaces:**

- Produces: `AdminUnitCreateRequest` with canonical base/conversion integers; `AdminSkuCreateRequest.sellQuantity`; sourcing enums exactly `STOCKED | PLANNED | ON_DEMAND | MIXED`; read DTOs expose current versions.

```ts
export type AdminUnitCreateRequest = AuthenticatedRequest & {
  code: string;
  displayName: string;
  dimension: "MASS" | "VOLUME" | "COUNT";
  canonicalBaseCode: "GRAM" | "MILLILITER" | "PIECE";
  conversionNumerator: number;
  conversionDenominator: number;
  idempotencyKey: string;
};
```

```sql
UPDATE sku_location_availability
SET sourcing_mode = CASE sourcing_mode
  WHEN 'PLANNED_PROCUREMENT' THEN 'PLANNED'
  WHEN 'HYBRID' THEN 'MIXED'
  ELSE sourcing_mode
END;
```

- [ ] **Step 1: Write failing contract and migration tests**

  Assert exact unit conversion fields, positive integers, same-dimension conversion, required SKU sell quantity, and the closed sourcing set. Assert migration maps `PLANNED_PROCUREMENT -> PLANNED` and `HYBRID -> MIXED` without losing rows.

- [ ] **Step 2: Verify RED**

  Run: `pnpm --filter @freshmarkets/contracts test -- src/admin-catalog.test.ts src/catalog.test.ts && pnpm --filter @freshmarkets/core test -- src/catalog/catalog-schema.integration.test.ts src/admin/application/admin-catalog.integration.test.ts`

- [ ] **Step 3: Add the forward migration and contracts**

  Introduce canonical unit conversion columns/storage, backfill `GRAM`, `MILLILITER`, and `PIECE`, persist positive `sell_quantity`, migrate sourcing values, and add required checks/indexes. Do not modify migrations 0001–0033.

- [ ] **Step 4: Update Core and catalog generation**

  Validate conversions and SKU dimensions in Core; update seed types/generator and generated catalog SQL to canonical values.

- [ ] **Step 5: Run focused suites plus migration/catalog checks and verify GREEN**

  Run: `pnpm --filter @freshmarkets/contracts test -- src/admin-catalog.test.ts src/catalog.test.ts && pnpm --filter @freshmarkets/core test -- src/catalog src/admin/application/admin-catalog.integration.test.ts && pnpm migration:check && pnpm catalog:check`

- [ ] **Step 6: Commit**

  Run: `git add apps/core/migrations/0034_admin_catalog_canonicalization.sql packages/contracts/src/admin-catalog* packages/contracts/src/catalog* apps/core/src/catalog apps/core/src/admin/application/catalog-* apps/core/scripts && git commit -m "fix(catalog): canonicalize units skus and sourcing"`

### Task 7: Enforce non-overlapping deterministic prices

**Files:**

- Create: `apps/core/migrations/0035_price_version_guards.sql`
- Modify: `apps/core/src/admin/application/catalog-commands.ts`
- Modify: `apps/core/src/catalog/service.ts`
- Modify: `apps/web/app/admin/catalog/products/[product-id]/page.tsx`
- Modify: `apps/web/app/admin/inventory/page.tsx`
- Test: `apps/core/src/admin/application/admin-catalog.integration.test.ts`
- Test: `apps/core/src/catalog/service.integration.test.ts`
- Test: `apps/web/app/api/admin/catalog-routes.test.ts`

**Interfaces:**

- Produces: one effective standard price per precedence key and deterministic selection; product, availability, inventory, and price actions consume versions returned by Core.

```sql
UPDATE price_version
SET valid_to = ?
WHERE sku_id = ? AND market_id = ?
  AND location_id IS ? AND price_type = ?
  AND valid_to IS NULL AND valid_from < ?;
```

```sql
SELECT amount_minor, currency, version
FROM price_version
WHERE sku_id = ? AND market_id = ? AND valid_from <= ?
  AND (valid_to IS NULL OR valid_to > ?)
ORDER BY CASE WHEN location_id = ? THEN 0 ELSE 1 END, version DESC
LIMIT 1;
```

- [ ] **Step 1: Add failing replacement/concurrency tests**

  Insert a current price, set a successor, and assert the predecessor closes at the new `validFrom`. Race two writers and assert one wins. Query the storefront repeatedly and assert amount/currency/version belong to the same row.

- [ ] **Step 2: Add failing Web version tests**

  Assert product, availability, and inventory requests submit DTO versions rather than constants and display stale-version recovery.

- [ ] **Step 3: Verify RED**

  Run: `pnpm --filter @freshmarkets/core test -- src/admin/application/admin-catalog.integration.test.ts src/catalog/service.integration.test.ts && pnpm --filter @freshmarkets/web test -- app/api/admin/catalog-routes.test.ts`

- [ ] **Step 4: Implement atomic price succession and deterministic reads**

  Close the active row and insert its successor in one guarded command. Add supporting uniqueness/overlap indexes and replace grouped non-aggregated reads with an ordered winner query.

- [ ] **Step 5: Replace hard-coded Web versions**

  Expose and submit current versions/allowed actions, retain form intent on `STALE_VERSION`, and refresh the affected row.

- [ ] **Step 6: Run focused suites and verify GREEN**

  Repeat Step 3 and run `pnpm migration:check`.

- [ ] **Step 7: Commit**

  Run: `git add apps/core/migrations/0035_price_version_guards.sql apps/core/src/admin/application/catalog-commands.ts apps/core/src/catalog/service* apps/web/app/admin/catalog apps/web/app/admin/inventory apps/web/app/api/admin/catalog-routes.test.ts && git commit -m "fix(catalog): enforce deterministic price versions"`

### Task 8: Protect promotion ownership and grant uniqueness

**Files:**

- Create: `apps/core/migrations/0036_promotion_grant_uniqueness.sql`
- Modify: `packages/contracts/src/admin-promotions.ts`
- Modify: `apps/core/src/admin/application/promotion-commands.ts`
- Modify: `apps/web/app/admin/promotions/page.tsx`
- Modify: `apps/web/app/admin/promotions/[promotion-id]/page.tsx`
- Test: `packages/contracts/src/admin-promotions.test.ts`
- Test: `apps/core/src/admin/application/admin-promotions.integration.test.ts`
- Test: `apps/web/app/api/admin/promotion-routes.test.ts`

**Interfaces:**

- Produces: an explicit reserved benefit-code guard and one promotion/customer grant; identical retries replay and different intent conflicts.

```ts
const reservedBenefitCodes = new Set(["INTRO_TRIAL", "LEGACY_TRIAL_HISTORY"]);
if (reservedBenefitCodes.has(code)) {
  return failure("VALIDATION_FAILED", "Promotion code is reserved", request.requestId);
}
```

```sql
CREATE UNIQUE INDEX promotion_grant_promotion_customer_unique
ON promotion_grant(benefit_code, customer_id);
```

- [ ] **Step 1: Add failing reserved-code and duplicate-grant tests**

  Reject `INTRO_TRIAL` and every system-owned membership code. Submit two keys for the same promotion/customer and assert no duplicate grant; assert an exact retry returns the original grant.

- [ ] **Step 2: Verify RED**

  Run: `pnpm --filter @freshmarkets/contracts test -- src/admin-promotions.test.ts && pnpm --filter @freshmarkets/core test -- src/admin/application/admin-promotions.integration.test.ts`

- [ ] **Step 3: Add uniqueness migration and guarded command**

  Add the canonical promotion/customer uniqueness key, safely reconcile existing duplicates, reject reserved codes at creation, and use the atomic command pattern from Task 2.

- [ ] **Step 4: Update Web error/retry behavior**

  Preserve the grant intent and key, surface existing-grant replay versus conflict, and render paginated grant/redemption history.

- [ ] **Step 5: Run focused tests and verify GREEN**

  Run the tests from Step 2 plus `pnpm --filter @freshmarkets/web test -- app/api/admin/promotion-routes.test.ts` and `pnpm migration:check`.

- [ ] **Step 6: Commit**

  Run: `git add apps/core/migrations/0036_promotion_grant_uniqueness.sql packages/contracts/src/admin-promotions* apps/core/src/admin/application/promotion-commands.ts apps/web/app/admin/promotions apps/web/app/api/admin/promotion-routes.test.ts && git commit -m "fix(promotions): protect reserved grants"`

### Task 9: Canonicalize procurement, fulfillment, delivery, and issue states

**Files:**

- Create: `apps/core/migrations/0037_admin_operations_canonical_states.sql`
- Modify: `packages/contracts/src/admin-finance.ts`
- Modify: `packages/contracts/src/admin-operations.ts`
- Modify: `packages/contracts/src/operations.ts`
- Modify: `apps/core/src/commerce/state-machines.ts`
- Modify: `apps/core/src/procurement/application/create-procurement-requirement.ts`
- Modify: `apps/core/src/admin/application/operations-commands.ts`
- Modify: `apps/core/src/operations/application/advance-fulfillment.ts`
- Modify: `apps/core/src/operations/application/advance-delivery.ts`
- Modify: `apps/core/src/fulfillment/application/list-fulfillment-queue.ts`
- Modify: `apps/core/src/delivery/application/list-delivery-dispatch.ts`
- Modify: `apps/core/src/audit/application/list-operational-exceptions.ts`
- Modify: affected Admin operations/issue pages
- Test: contract state tests and Core operations/finance integration tests

**Interfaces:**

- Produces: terminal resolved issues, canonical fulfillment/delivery states and actions, one active procurement requirement per cycle/location/pool, and timestamp-based receiving exception cursors.

```ts
export const fulfillmentTransitions = {
  NOT_STARTED: ["PICKING"],
  PICKING: ["READY_TO_PACK", "SHORTED"],
  READY_TO_PACK: ["PACKING", "SHORTED"],
  PACKING: ["PACKED", "SHORTED"],
  PACKED: ["HANDED_OFF"],
  HANDED_OFF: ["COMPLETED"],
  SHORTED: ["PICKING", "READY_TO_PACK", "CANCELED", "ESCALATED"],
} as const;

export const deliveryJobTransitions = {
  UNASSIGNED: ["ASSIGNED"],
  ASSIGNED: ["EN_ROUTE"],
  EN_ROUTE: ["ARRIVED"],
  ARRIVED: ["DELIVERED", "FAILED"],
  FAILED: ["RETRY_SCHEDULED", "ESCALATED", "CANCELED"],
  RETRY_SCHEDULED: ["ASSIGNED"],
} as const;
```

```sql
CREATE UNIQUE INDEX procurement_requirement_active_context_unique
ON procurement_requirement(delivery_cycle_id, location_id, inventory_pool_id)
WHERE status != 'CLOSED';
```

- [ ] **Step 1: Add failing lifecycle and concurrency tests**

  Assert `REOPEN` is absent/illegal, enumerate every canonical legal/illegal fulfillment and delivery transition, run two procurement writers with distinct keys, and verify only one active requirement exists.

- [ ] **Step 2: Add failing exception chronology tests**

  Seed receiving exceptions with controlled UTC timestamps and assert age and cursor order use timestamps rather than insertion `rowid`.

- [ ] **Step 3: Verify RED**

  Run: `pnpm --filter @freshmarkets/contracts test -- src/admin-finance.test.ts src/admin-operations.test.ts && pnpm --filter @freshmarkets/core test -- src/admin/application/admin-finance.integration.test.ts src/admin/application/admin-operations-commands.integration.test.ts src/admin/application/operations-exception.integration.test.ts`

- [ ] **Step 4: Implement forward migration and guarded procurement**

  Add aggregate version/active uniqueness and operational timestamps; map simplified states explicitly. Move demand calculation and expected-version enforcement into the guarded procurement command.

- [ ] **Step 5: Replace state contracts, commands, queues, and UI together**

  Remove `REOPEN`; implement canonical assignment, picking/staging, dispatch/en-route/arrival/delivery/failure actions and Core-derived allowed actions.

- [ ] **Step 6: Run focused suites and verify GREEN**

  Repeat Step 3, add receiving/fulfillment/delivery suites, and run `pnpm migration:check`.

- [ ] **Step 7: Commit**

  Run: `git add apps/core/migrations/0037_admin_operations_canonical_states.sql packages/contracts apps/core/src/commerce apps/core/src/procurement apps/core/src/operations apps/core/src/fulfillment apps/core/src/delivery apps/core/src/audit apps/core/src/admin apps/web/app/admin && git commit -m "fix(operations): adopt canonical guarded lifecycles"`

### Task 10: Make analytics dimension-safe

**Files:**

- Modify: `packages/contracts/src/admin-analytics.ts`
- Modify: `apps/core/src/analytics/metric-definitions.ts`
- Modify: `apps/core/src/analytics/application/metric-queries.ts`
- Modify: `apps/core/src/analytics/application/get-analytics-overview.ts`
- Modify: `apps/core/src/analytics/application/get-metric-series.ts`
- Modify: `apps/web/app/admin/analytics/page.tsx`
- Test: `packages/contracts/src/admin-analytics.test.ts`
- Test: `apps/core/src/analytics/metric-definitions.test.ts`
- Test: `apps/core/src/analytics/application/analytics.integration.test.ts`
- Test: `apps/web/app/api/admin/analytics/analytics-routes.test.ts`

**Interfaces:**

- Produces: dimension metadata on scalar/series responses and unavailable results for ambiguous currency/base-unit requests; updated canonical metric-definition versions.

```ts
const dimensions = await distinctMetricDimensions(database, query);
if (!requestedDimension && dimensions.length > 1) {
  return unavailable("Select a currency or base unit", computedAt);
}
const effectiveDimension = requestedDimension ?? dimensions[0] ?? null;
```

- [ ] **Step 1: Add failing multi-dimension tests**

  Seed PHP and USD refunds and GRAM/MILLILITER/PIECE adjustments. Assert omitted dimensions never return a combined scalar, explicit dimensions return correct values, and a single discovered dimension is included in metadata.

- [ ] **Step 2: Verify RED**

  Run: `pnpm --filter @freshmarkets/contracts test -- src/admin-analytics.test.ts && pnpm --filter @freshmarkets/core test -- src/analytics`

- [ ] **Step 3: Implement dimension discovery and unavailable behavior**

  Query distinct dimensions before aggregation, reject ambiguity with a stable unavailable reason, return dimension metadata, and increment the affected metric definition versions.

- [ ] **Step 4: Update the Analytics page**

  Send selected scope, offer currency/base-unit controls where applicable, and render unavailable reasons without presenting zero.

- [ ] **Step 5: Run focused tests and verify GREEN**

  Run Step 2 plus `pnpm --filter @freshmarkets/web test -- app/api/admin/analytics/analytics-routes.test.ts`.

- [ ] **Step 6: Commit**

  Run: `git add packages/contracts/src/admin-analytics* apps/core/src/analytics apps/web/app/admin/analytics apps/web/app/api/admin/analytics && git commit -m "fix(analytics): prevent mixed dimension metrics"`

### Task 11: Complete pagination, retry, and destructive-action UX

**Files:**

- Create: `apps/web/components/admin/admin-command-state.ts`
- Create or modify: shared cursor pagination and confirmation components under `apps/web/components/admin/`
- Modify: Admin customer, promotion, catalog, inventory, finance, procurement, receiving, fulfillment, and delivery pages
- Modify: corresponding BFF route tests
- Test: `apps/web/components/admin/admin-accessibility.test.tsx`
- Test: all `apps/web/tests/admin-*.spec.ts` affected by commands and pagination

**Interfaces:**

- Produces: `useAdminCommandIntent()` retaining one idempotency key until definitive completion; cursor controls preserving scope/filter state; confirmation dialogs showing resource, amount/quantity, scope, reason, and consequence.

```ts
type AdminCommandIntent = {
  idempotencyKey: string;
  pending: boolean;
  submit<T>(run: (idempotencyKey: string) => Promise<RpcResult<T>>): Promise<RpcResult<T>>;
  reset(): void;
};
```

- [ ] **Step 1: Add failing component tests**

  Assert double submission calls fetch once, ambiguous failure reuses the same key, definitive completion rotates the key, and confirmation is required for adjustment/cancellation/refund.

- [ ] **Step 2: Add failing second-page browser fixtures**

  Mock or seed two cursor pages for every paginated Admin surface and assert operators can reach later records without losing filters or selected scope.

- [ ] **Step 3: Verify RED**

  Run: `pnpm --filter @freshmarkets/web test -- components/admin && pnpm --filter @freshmarkets/web exec playwright test tests/admin-customers.spec.ts tests/admin-promotions.spec.ts tests/admin-catalog.spec.ts tests/admin-finance.spec.ts tests/admin-operations.spec.ts`

- [ ] **Step 4: Implement shared intent, confirmation, and pagination behavior**

  Replace per-click UUID generation and ignored responses, disable pending controls, retain retry state, and consume every returned `nextCursor`.

- [ ] **Step 5: Run Web unit/browser tests and verify GREEN**

  Repeat Step 3 and run all `apps/web/tests/admin-*.spec.ts`.

- [ ] **Step 6: Commit**

  Run: `git add apps/web/components/admin apps/web/app/admin apps/web/app/api/admin apps/web/tests && git commit -m "fix(admin): complete pagination and command recovery"`

### Task 12: Provision authenticated readiness and reconcile documentation

**Files:**

- Modify: `apps/web/playwright.config.ts`
- Create: `apps/web/tests/admin-authenticated-fixture.ts`
- Modify: all `apps/web/tests/admin-*.spec.ts`
- Modify: `scripts/verify-worker-readiness.mjs`
- Modify: `scripts/verify-worker-readiness.test.mjs`
- Modify: `docs/superpowers/reports/ADMIN_READINESS_SLICE_9_PERFORMANCE.md`
- Modify: `docs/superpowers/reports/ADMIN_READINESS_SLICE_9_FINAL.md`
- Modify: `docs/superpowers/plans/ADMIN_CRM_ANALYTICS_PROGRAM_MAP.md`
- Modify: `docs/product/IMPLEMENTATION_STATUS.md`
- Modify: canonical architecture/domain/state/data/API documents only where implementation terminology must be synchronized
- Modify: `docs/reviews/ADMIN_SLICES_1_9_REVIEW.md` to record remediation evidence

**Interfaces:**

- Produces: deterministic authenticated staff/browser setup; shell-free Worker verifier; evidence-based readiness report using actual Admin routes and measured Web Vitals.

```ts
const executable = process.platform === "win32" ? `${command}.cmd` : command;
const result = spawnSync(executable, args, {
  cwd: root,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
  timeout: 120_000,
  shell: false,
});
```

- [ ] **Step 1: Add the failing Worker launcher test**

  Assert Windows `.cmd` execution does not set `shell: true` with an argument array and preserves exit/stdout/stderr behavior.

- [ ] **Step 2: Add authenticated browser setup and journeys**

  Provision a deterministic staff identity with capabilities/scopes through test setup. For each slice, test at least one successful command and one capability or scope denial without relying only on mocked browser state.

- [ ] **Step 3: Run focused verifier/browser tests and verify RED where behavior is absent**

  Run: `node --test scripts/verify-worker-readiness.test.mjs && pnpm --filter @freshmarkets/web exec playwright test --list`

- [ ] **Step 4: Fix the launcher and complete authenticated flows**

  Resolve the platform executable without a shell, remove unused auth-email flags, and make browser prerequisites fail/skip with explicit evidence rather than silently passing.

- [ ] **Step 5: Run the complete validation matrix**

  Run:

  ```powershell
  pnpm format:check
  pnpm naming:check
  pnpm migration:check
  pnpm lint
  pnpm typecheck
  pnpm test
  pnpm -r build
  node scripts/verify-worker-readiness.mjs
  pnpm --filter @freshmarkets/web exec playwright test
  ```

  Expected: every required command exits 0 with no unresolved warning classified as a release gate.

- [ ] **Step 6: Collect representative authenticated performance evidence**

  Measure actual list, detail, operations (`/admin/procurement`, `/admin/receiving`, `/admin/fulfillment`, `/admin/delivery`), and analytics routes. Record LCP, INP, CLS, request/network observations, fixture, browser, and environment. Mark missing evidence blocked.

- [ ] **Step 7: Reconcile documentation and review status**

  Remove stale authorization/duplicate Slice 5 text, correct route names, record exact commands/counts, and mark each of C1–C3, I1–I22, and M1–M5 fixed with its regression evidence.

- [ ] **Step 8: Commit**

  Run: `git add apps/web/tests apps/web/playwright.config.ts scripts/verify-worker-readiness* docs/superpowers/reports docs/superpowers/plans/ADMIN_CRM_ANALYTICS_PROGRAM_MAP.md docs/product/IMPLEMENTATION_STATUS.md docs/architecture docs/reviews/ADMIN_SLICES_1_9_REVIEW.md && git commit -m "test(admin): complete authenticated readiness evidence"`

## Finding coverage

| Review findings | Plan task |
| --------------- | --------- |
| C1              | Task 1    |
| I1–I2           | Task 2    |
| I6, I8–I9, M1   | Task 3    |
| I3–I5           | Task 4    |
| I7              | Task 5    |
| I12–I14         | Task 6    |
| C2, I15         | Task 7    |
| I10–I11         | Task 8    |
| C3, I16–I17, M3 | Task 9    |
| I18             | Task 10   |
| I19–I20, M2     | Task 11   |
| I21–I22, M4–M5  | Task 12   |

## Final review checkpoint

- [ ] Re-read `AGENTS.md`, the remediation spec, the review report, and the canonical Admin/Analytics architecture, domain, state, data, API, and design documents.
- [ ] Confirm every finding ID C1–C3, I1–I22, and M1–M5 has a code/test/document artifact or an approved canonical supersession.
- [ ] Run `git status --short`, inspect the complete branch diff, and verify the pre-existing DoorDash plan edit was not included in remediation commits.
- [ ] Use `superpowers:requesting-code-review` for an independent implementation review.
- [ ] Use `superpowers:verification-before-completion` and rerun the complete validation matrix before any completion claim.
