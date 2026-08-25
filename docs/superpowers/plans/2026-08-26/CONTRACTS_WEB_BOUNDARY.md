# Contracts and Web Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore a truthful typechecked Service Binding surface with closed domain vocabularies, stable client idempotency, required optimistic versions, domain-grouped target contracts, and one checked Web/Core binding adapter.

**Architecture:** Split only contract concepts needed by downstream remediation into focused source modules while retaining `packages/contracts/src/index.ts` as the compatibility export surface. Distinguish implemented Core RPCs from target domain service interfaces until each downstream plan supplies the implementation. Web routes obtain Core through one checked adapter and use one request/idempotency helper instead of repeated unsafe casts and server-generated retry identities.

**Tech Stack:** TypeScript, Cloudflare Service Binding RPC, Zod, Vitest, vinext.

**Spec:** `docs/architecture/API_CONTRACTS.md`; `docs/architecture/ARCHITECTURE.md` Web to Core Boundary; `docs/architecture/STATE_MACHINES.md`; `AGENTS.md` Repository and Testing Conventions.

## Global Constraints

- Priority: P1, with immediate correction of the current typecheck breakage.
- Begins only after Plans 01–03 pass their P0 gates.
- Do not advertise an RPC as implemented until Core actually supplies it.
- Do not make D1 rows, Better Auth records, provider payloads, or Cloudflare handles contract DTOs.
- Preserve current implemented consumers through explicit compatibility interfaces; do not maintain a second business implementation.
- Client/application/admin mutations require caller-stable idempotency keys. Web may generate a key once in the browser for a new user action but must reuse it on retries; a route never substitutes a fresh key.
- `expectedVersion` is required for lifecycle commands where concurrent mutation is possible. Provider events are excluded and never use this field.

---

## Dependencies and Decision Blockers

- Depends on Plans 01–03.
- Produces interfaces required by Plans 05–08.
- None of the unresolved provider, dunning, cancellation-default, recovery, or billing-anchor decisions blocks the contract structure.
- Policy-dependent operations expose explicit reason/exception fields without inventing the policy result.

## Migration and Compatibility Impact

- Migration impact: none.
- Compatibility: existing RPCs remain in `LegacyCommerceService` or `LegacyOperationsService` until their callers move. `commitMockOrder` is sandbox-only from Plan 02.
- Dirty Phase 4C declarations are not retained as implemented methods. Canonical Membership target types are rewritten here; Plan 06 adds them to the implemented Core surface only with working commands.
- Contract version must change when the first new implemented grouped service replaces a compatibility surface; do not bump merely for internal file movement.

## Task Impact Matrix

| Task | Depends on | Migration impact | Compatibility impact | Unresolved product-decision blocker |
|---|---|---|---|---|
| 1. Truthful baseline | Plans 01–03 | None | Unimplemented dirty Phase 4C contract methods are removed from the implemented surface; closed vocabularies replace strings | None |
| 2. Grouped contracts | Task 1 | None | Legacy methods are isolated and compile-time distinguished until owning plans migrate callers | None |
| 3. Checked binding | Task 2 | None | Routes keep behavior but obtain Core only through one checked adapter | None |
| 4. Command metadata | Task 3 | None | Client retries reuse idempotency keys and required versions; provider-event DTOs remain excluded | None |

## Task Acceptance Matrix

| Task | Acceptance criteria |
|---|---|
| 1. Truthful baseline | Root typecheck passes with no contract advertising an absent Core method; all state/error vocabularies are closed and `CANCELED` is canonical |
| 2. Grouped contracts | Contracts are grouped by bounded context, DTO-only, and distinguish implemented target ports from temporary legacy surfaces |
| 3. Checked binding | All Web callers acquire Core through one runtime-checked typed adapter; no repeated unsafe Service Binding casts remain |
| 4. Command metadata | One user attempt reuses a stable idempotency key; concurrent lifecycle mutations require a version; provider events expose neither client field |

## Task 1: Restore truthful typecheck baseline and closed common vocabularies

**Files:**
- Create: `packages/contracts/src/common.ts`
- Create: `packages/contracts/src/states.ts`
- Test: `packages/contracts/src/states.test.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/src/index.test.ts`
- Modify: `packages/validation/src/index.ts`
- Modify: `packages/validation/src/index.test.ts`
- Modify: `apps/web/lib/core-client/health.test.ts`
- Modify: `apps/web/app/api/commerce/trial/route.ts` only to remove use of an unimplemented dirty method or route it to the retained sandbox compatibility interface

**Interfaces:**
- Produces: `SubscriptionState = "PENDING" | "TRIALING" | "ACTIVE" | "PAST_DUE" | "PAUSED" | "CANCELED" | "EXPIRED"`
- Produces: `PaymentState = "INITIATED" | "REQUIRES_ACTION" | "PROCESSING" | "SUCCEEDED" | "FAILED" | "EXPIRED" | "PARTIALLY_REFUNDED" | "REFUNDED"`
- Produces: closed `OrderState`, `RefundState`, and stable `AppErrorCode` unions from canonical docs
- Produces: required `expectedVersionSchema`
- Produces: `HealthService = Pick<CoreServiceBinding, "health">` use at the health-test boundary

- [ ] **Step 1: Preserve evidence of the current failure**

Run: `pnpm typecheck`

Expected on the dirty Phase 4C worktree: FAIL for missing trial-route `idempotencyKey` and missing subscription methods on the full health mock. In an isolated clean worktree, record whether the failure is absent; do not reintroduce the dirty declarations to recreate it.

- [ ] **Step 2: Write failing closed-vocabulary tests**

```ts
expect(subscriptionStates).toEqual([
  "PENDING",
  "TRIALING",
  "ACTIVE",
  "PAST_DUE",
  "PAUSED",
  "CANCELED",
  "EXPIRED",
]);
expect(subscriptionStates).not.toContain("CANCELLED");
expect(expectedVersionSchema.safeParse(undefined).success).toBe(false);
expect(expectedVersionSchema.safeParse(0).success).toBe(true);
```

Add compile-time fixtures with `satisfies` for every closed DTO state and error code.

- [ ] **Step 3: Run focused tests and prove failure**

Run: `pnpm --filter @freshmarkets/contracts test && pnpm --filter @freshmarkets/validation test`

Expected: FAIL because state arrays do not exist and `expectedVersionSchema` currently accepts `undefined`.

- [ ] **Step 4: Implement common/state modules and truthful mocks**

Move shared envelope/error types to `common.ts`, export state arrays with derived union types from `states.ts`, and re-export from `index.ts`. Remove noncanonical dirty Phase 4C fields such as offer `trialDays`, provider-coupled membership start input, arbitrary subscription status strings, and unimplemented methods from the implemented binding. Change health tests to mock only `Pick<CoreServiceBinding, "health">`.

- [ ] **Step 5: Run focused tests and typecheck**

Run: `pnpm --filter @freshmarkets/contracts test && pnpm --filter @freshmarkets/validation test && pnpm typecheck`

Expected: all commands exit 0.

- [ ] **Step 6: Commit the truthful baseline**

Run: `git add packages/contracts/src/common.ts packages/contracts/src/states.ts packages/contracts/src/states.test.ts packages/contracts/src/index.ts packages/contracts/src/index.test.ts packages/validation/src/index.ts packages/validation/src/index.test.ts apps/web/lib/core-client/health.test.ts apps/web/app/api/commerce/trial/route.ts && git commit -m "fix(contracts): restore truthful typed boundary"`

## Task 2: Domain-grouped target contracts and explicit compatibility surfaces

**Files:**
- Create: `packages/contracts/src/auth.ts`
- Create: `packages/contracts/src/catalog.ts`
- Create: `packages/contracts/src/membership.ts`
- Create: `packages/contracts/src/payments.ts`
- Create: `packages/contracts/src/checkout.ts`
- Create: `packages/contracts/src/orders.ts`
- Create: `packages/contracts/src/operations.ts`
- Create: `packages/contracts/src/core-service.ts`
- Test: `packages/contracts/src/core-service.test.ts`
- Modify: `packages/contracts/src/index.ts`

**Interfaces:**
- Produces: `AuthService`, `CatalogService`, `MembershipService`, `PaymentsService`, `CheckoutService`, `OrdersService`, `OperationsService`
- Produces: `ImplementedCoreService` composed only from services currently supplied by Core
- Produces: `LegacyCommerceService` containing guarded sandbox compatibility methods
- Produces: `LegacyOperationsService` containing generic operations pending Plan 08
- Produces: `CoreServiceBinding = ImplementedCoreService & LegacyCommerceService & LegacyOperationsService`

- [ ] **Step 1: Write failing composition tests**

Use compile-time `satisfies` fixtures to prove:

```ts
const membershipTarget: MembershipService = membershipFixture;
const paymentsTarget: PaymentsService = paymentsFixture;
const implemented: ImplementedCoreService = implementedFixture;
```

Assert `commitMockOrder` is absent from `CheckoutService`, provider payload fields are absent from `MembershipService`, and generic actions are absent from `OperationsService` target command groups.

- [ ] **Step 2: Run focused tests and prove failure**

Run: `pnpm --filter @freshmarkets/contracts exec vitest run src/core-service.test.ts`

Expected: FAIL because grouped interfaces do not exist.

- [ ] **Step 3: Create focused modules without bulk-renaming consumers**

Define the exact target methods already approved in `API_CONTRACTS.md`. Keep `index.ts` re-exports so existing imports compile. Place compatibility-only methods in explicitly named legacy interfaces with comments naming their replacement plan and removal gate.

- [ ] **Step 4: Run contract tests and typecheck**

Run: `pnpm --filter @freshmarkets/contracts test && pnpm typecheck`

Expected: all commands exit 0.

- [ ] **Step 5: Commit grouped contracts**

Run: `git add packages/contracts/src && git commit -m "refactor(contracts): group core domain services"`

## Task 3: One checked Web/Core Service Binding adapter

**Files:**
- Create: `apps/web/lib/core-client/core.ts`
- Test: `apps/web/lib/core-client/core.test.ts`
- Modify: every `apps/web/app/api/**/route.ts` file that currently contains `as unknown as CoreServiceBinding`
- Modify: `apps/web/lib/core-client/health.ts`
- Modify: `apps/web/lib/core-client/health.test.ts`

**Interfaces:**
- Consumes: generated `Cloudflare.Env["CORE"]`
- Produces: `coreClient(binding: Cloudflare.Env["CORE"]): CoreServiceBinding`
- Produces: one isolated, documented type assertion at this adapter only if Wrangler cannot emit the RPC method shape
- Verifies: a health contract call and representative error result at runtime

- [ ] **Step 1: Write failing adapter tests**

Assert `coreClient(binding).health` delegates exactly once and returns the typed health response. Add a source scan assertion that no route file contains `as unknown as CoreServiceBinding`.

- [ ] **Step 2: Run tests and prove failure**

Run: `pnpm --filter @freshmarkets/web exec vitest run --config vitest.config.ts lib/core-client/core.test.ts`

Expected: FAIL because the adapter does not exist and route casts remain.

- [ ] **Step 3: Implement and adopt the checked adapter**

Keep the unavoidable cross-config assertion in `core.ts` only, document why the generated binding is `Service`, and constrain it with `satisfies`/compile fixtures against `CoreServiceBinding`. Replace every route cast with `coreClient(env.CORE)`.

- [ ] **Step 4: Run Web tests, typecheck, and source scan**

Run: `pnpm --filter @freshmarkets/web test && pnpm typecheck && rg -n "as unknown as CoreServiceBinding" apps/web`

Expected: tests/typecheck pass; ripgrep returns no match.

- [ ] **Step 5: Commit the adapter migration**

Run: `git add apps/web/lib/core-client apps/web/app/api && git commit -m "refactor(web): centralize core binding adapter"`

## Task 4: Stable idempotency and required-version Web helpers

**Files:**
- Create: `apps/web/lib/core-client/commands.ts`
- Test: `apps/web/lib/core-client/commands.test.ts`
- Modify: mutation routes under `apps/web/app/api/commerce` and `apps/web/app/api/operations/route.ts`
- Modify: client pages that initiate mutations: `apps/web/app/account/page.tsx`, `apps/web/app/cart/page.tsx`, `apps/web/app/checkout/page.tsx`, `apps/web/app/admin/page.tsx`, `apps/web/app/rider/page.tsx`

**Interfaces:**
- Produces: `requireIdempotencyKey(request: Request, bodyKey?: unknown): string`
- Produces: `requireExpectedVersion(value: unknown): number`
- Produces errors: HTTP 400 `VALIDATION_FAILED` for missing/invalid fields
- Browser actions create one UUID when a new action begins, retain it through retry/recovery, and discard it only after terminal success or explicit abandonment

- [ ] **Step 1: Write failing helper tests**

```ts
expect(() => requireIdempotencyKey(requestWithoutKey)).toThrow("IDEMPOTENCY_KEY_REQUIRED");
expect(requireIdempotencyKey(requestWithHeader)).toBe("stable-command-1");
expect(() => requireExpectedVersion(undefined)).toThrow("EXPECTED_VERSION_REQUIRED");
expect(requireExpectedVersion(0)).toBe(0);
```

Add route tests proving two retries forward the same key and that a route never calls `crypto.randomUUID()` as a fallback.

- [ ] **Step 2: Run helper tests and prove failure**

Run: `pnpm --filter @freshmarkets/web exec vitest run --config vitest.config.ts lib/core-client/commands.test.ts`

Expected: FAIL because helpers do not exist and routes currently synthesize keys.

- [ ] **Step 3: Implement helpers and migrate mutation callers**

Use the `Idempotency-Key` header as primary transport with an exact matching body field accepted during compatibility. Reject mismatches. Require integer nonnegative versions. Keep keys in component state/local recovery state for the duration of one user action; do not persist them as long-lived identity.

- [ ] **Step 4: Run Web route tests and scans**

Run: `pnpm --filter @freshmarkets/web test && rg -n "idempotencyKey:\s*crypto\.randomUUID\(\)|expectedVersion\?" apps/web packages/contracts/src packages/validation/src`

Expected: tests pass; no mutation-route fallback or optional lifecycle version remains. Any provider-event types are exempt and contain no version field.

- [ ] **Step 5: Commit command-boundary helpers**

Run: `git add apps/web/lib/core-client/commands.ts apps/web/lib/core-client/commands.test.ts apps/web/app packages/contracts/src packages/validation/src && git commit -m "fix(web): preserve command idempotency and versions"`

## Final Acceptance Gate

- [ ] Run: `pnpm --filter @freshmarkets/contracts test && pnpm --filter @freshmarkets/validation test && pnpm --filter @freshmarkets/web test`
- [ ] Run: `pnpm typecheck && pnpm lint && pnpm format:check`
- [ ] Run: `pnpm naming:check && pnpm -r build && pnpm --filter @freshmarkets/web check:vinext`
- [ ] Run: `rg -n "status:\s*string|expectedVersion\?:|as unknown as CoreServiceBinding|idempotencyKey:\s*crypto\.randomUUID\(\)|commitMockOrder" packages/contracts/src apps/web`
- [ ] Confirm remaining `commitMockOrder` appears only in `LegacyCommerceService` and an explicit sandbox route/caller from Plan 02.
- [ ] Confirm `git status --short` lists only files declared above.

**Acceptance criteria:** root typecheck passes; canonical state/error DTOs are closed; unimplemented Phase 4C methods are not advertised as implemented; target contracts are domain-grouped; compatibility APIs are isolated; Web routes use one checked Core adapter; callers preserve stable idempotency and required versions.
