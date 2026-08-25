# Operations Surfaces and Core Structure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the remediation program by making operational commands/read models explicit, enforcing staff and rider scopes, replacing generic operations plumbing, and decomposing the Core entrypoint into bounded-context composition without changing the two-deployment architecture.

**Architecture:** `apps/core` remains one authoritative Cloudflare Worker and an internal modular monolith. Each bounded context exposes application ports registered in a small composition root. Admin and rider Web surfaces call purpose-built commands and read models through the checked Service Binding client; they do not receive generic table access or arbitrary state mutation.

**Tech Stack:** Cloudflare Workers, D1, TypeScript, Zod, shared Service Binding contracts, Vitest Workers pool, Playwright, vinext.

**Spec:** `docs/architecture/ARCHITECTURE.md` deployment/module boundaries; `docs/architecture/DOMAIN_MODEL.md` Inventory, Procurement, Receiving, Fulfillment, Delivery, and IAM ownership; `docs/architecture/STATE_MACHINES.md` operational transitions; `docs/architecture/API_CONTRACTS.md` admin/rider command and query rules; `docs/architecture/DATA_MODEL.md` operational data; `docs/product/MVP_SCOPE.md` admin and rider outcomes.

## Global Constraints

- Priority: P1 authorization/domain correctness before P2 maintainability and UI quality.
- Depends on Plans 03, 04, and 07. Start entrypoint extraction only after their public ports stabilize.
- `apps/core` remains one Worker. Do not create microservices, public HTTP APIs, CORS, Durable Objects, Workflows, KV, or Queues.
- Preserve the single Core Worker modular-monolith deployment while extracting ownership boundaries.
- Preserve layer direction: entrypoint/transport -> application command/query -> domain policy -> repository -> D1/integration.
- Better Auth supplies identity only. IAM owns staff identity, roles, permissions, and location scopes.
- Assigned rider jobs and every staff/rider operation require explicit scoped authorization in Core.
- Generic operations endpoints and arbitrary target-state updates are forbidden.
- Operational read models are purpose-built for queues, scanning, decisions, and exceptions; raw D1/ORM rows are never contracts.
- Create migration `0019_operations_integrity.sql` only if Task 2's schema audit proves accepted migrations through `0018` cannot enforce a named invariant. Do not create an empty or organizational migration.

---

## Dependencies and Decision Blockers

- Production payment-provider selection does not block operational command/read-model work.
- Paid-success/downstream failure policy affects which finance exception action is eventually automated. Surface retry/manual-review facts and permissions, but do not add an automatic refund or guaranteed-retry button until the policy is approved.
- Membership dunning, cancellation default, and recurring billing anchor do not block operational scopes.
- Exact operational transition names and ownership come from canonical state machines; if current implementation contains an extra transition, delete/isolate it rather than documenting it as architecture.

## Migration and Compatibility Impact

- Default: no migration. Reuse accepted operational tables and the integrity migration from Plan 03.
- Conditional: create `apps/core/migrations/0019_operations_integrity.sql` only for a reviewed, test-proven database invariant such as a missing rider-assignment uniqueness constraint or immutable transition-event identity.
- If `0019` is required, add a migration test and update `apps/core/migrations/README.md`; never edit migrations `0001`–`0018`.
- Generic `/api/operations` routes and broad RPC methods stay temporarily as compatibility shims only until every known consumer is migrated in Task 4, then are removed in that task.
- Existing audit/history is preserved. No state/event rewrite is authorized.

## Task Impact Matrix

| Task | Depends on | Migration impact | Compatibility impact | Unresolved product-decision blocker |
|---|---|---|---|---|
| 1. Composition root | Plans 03, 04, and 07 ports stabilized | None | Mechanical move preserves Worker and RPC behavior | None |
| 2. Command integrity | Task 1 and Plan 03 | Conditional `0019` only after a failing schema invariant test | Broad entrypoint methods migrate to explicit context commands | None |
| 3. Read models | Task 2 | None beyond a justified `0019` | Generic rows are replaced by scoped decision DTOs | Recovery policy limits finance-exception actions to retry/manual review |
| 4. Domain routes | Task 3 and Plan 04 client | None | Generic `/api/operations` and broad RPCs are removed after all consumers migrate | None |
| 5. Admin/rider UI | Task 4 | None | Existing broad/generic screens are replaced by purpose-built surfaces | Recovery policy blocks automatic finance action only |
| 6. Residual cleanup | Tasks 1–5 and Plans 01–07 | None | Deletes temporary compatibility surfaces after consumer proof | None |

## Task 1: Extract the Core composition root without behavior changes

**Files:**
- Create: `apps/core/src/entrypoint/core-service.ts`
- Create: `apps/core/src/entrypoint/composition.ts`
- Create: `apps/core/src/entrypoint/transport-errors.ts`
- Test: `apps/core/src/entrypoint/composition.test.ts`
- Modify: `apps/core/src/index.ts`
- Modify: `apps/core/src/index.test.ts`

**Interfaces:**
- `createCoreService(env, executionContext): CoreServiceBinding`
- `composeApplication(env): { auth, iam, catalog, pricing, promotions, inventory, procurement, receiving, fulfillment, delivery, membership, payments, checkout, orders, audit }`
- `apps/core/src/index.ts` exports/fetches the Worker entrypoint and contains no domain decisions or repository SQL.

- [ ] **Step 1: Write characterization tests before moving code**

Capture current accepted health, auth proxy, typed RPC registration, domain-error mapping, and execution-context behavior. Add a structural test that each RPC delegates once to an application port and that composition dependencies point inward.

- [ ] **Step 2: Run characterization tests**

Run: `pnpm --filter @freshmarkets/core exec vitest run --config vitest.config.ts src/index.test.ts src/entrypoint/composition.test.ts`

Expected initial result: the existing index tests pass where applicable and the new composition test fails because the composition root is absent.

- [ ] **Step 3: Extract transport and wiring mechanically**

Move dependency construction and transport/error translation without changing domain behavior or contract names. Instantiate context repositories/services in `composition.ts`; expose only application ports to `core-service.ts`. Keep auth HTTP handling narrow and provider webhooks narrow.

- [ ] **Step 4: Enforce the structural boundary**

Add a test/lintable scan asserting `entrypoint` files do not contain SQL and `index.ts` does not import D1 repositories or state-machine internals. Do not split deployments or introduce package-per-domain fragmentation.

- [ ] **Step 5: Run tests and commit**

Run: `pnpm --filter @freshmarkets/core exec vitest run --config vitest.config.ts src/index.test.ts src/entrypoint/composition.test.ts && pnpm typecheck`

Expected: all commands exit 0 with no contract or runtime behavior change.

Run: `git add apps/core/src/index.ts apps/core/src/index.test.ts apps/core/src/entrypoint && git commit -m "refactor(core): extract bounded-context composition"`

**Acceptance criteria:** Core is still one Worker; its entrypoint is thin; context ownership/dependencies are visible; no business behavior or schema changed.

## Task 2: Audit and close operational command/state integrity

**Files:**
- Create: `apps/core/src/operations/application/operational-command-audit.test.ts`
- Create if proven necessary: `apps/core/migrations/0019_operations_integrity.sql`
- Create if migration is necessary: `apps/core/src/operations/infrastructure/operations-schema.integration.test.ts`
- Create: `apps/core/src/procurement/application/start-procurement.ts`
- Create: `apps/core/src/receiving/application/receive-procurement.ts`
- Create: `apps/core/src/fulfillment/application/advance-fulfillment.ts`
- Create: `apps/core/src/delivery/application/advance-delivery.ts`
- Modify if migration is necessary: `apps/core/migrations/README.md`

**Interfaces:**
- Each command has a domain-specific name, authenticated staff/rider actor, stable idempotency key, expected aggregate version, legal transition input, and reason/evidence fields required by policy.
- Commands append immutable transition/audit events and update the aggregate under CAS in one transaction.
- No command accepts an arbitrary table name, row patch, or unconstrained target state.

- [ ] **Step 1: Write the operational matrix test**

Enumerate Procurement, Receiving, Fulfillment, and Delivery commands against canonical legal/illegal transitions, required roles/permissions/location scopes, version conflicts, replay behavior, evidence requirements, and transaction rollback. Include cross-location denial and rider assignment denial.

- [ ] **Step 2: Run the matrix and record exact failures**

Run: `pnpm --filter @freshmarkets/core exec vitest run --config vitest.config.ts src/operations/application/operational-command-audit.test.ts`

Expected: FAIL only on concrete gaps; use the failure list to determine whether application fixes suffice.

- [ ] **Step 3: Decide the conditional migration from evidence**

If a named invariant cannot be enforced safely with migrations through `0018`, write a failing schema test first, then create `0019_operations_integrity.sql` containing only those constraints/indexes/events. If all invariants are enforceable already, record “no migration required” in the execution log and do not create `0019`.

- [ ] **Step 4: Implement the minimum command fixes**

Route each write through its owning context, authorize in Core IAM, load current versions, apply the canonical state machine, use the Plan 03 atomic inventory/receiving primitives, and append audit records. Delete arbitrary state/field mutation paths after consumers migrate.

- [ ] **Step 5: Run tests and commit**

Run: `pnpm --filter @freshmarkets/core exec vitest run --config vitest.config.ts src/operations/application/operational-command-audit.test.ts src/commerce/concurrency.integration.test.ts`

If `0019` exists, also run: `pnpm --filter @freshmarkets/core exec vitest run --config vitest.config.ts src/operations/infrastructure/operations-schema.integration.test.ts`

Expected: all applicable commands exit 0; run concurrency cases three times.

Run without `0019`: `git add apps/core/src/operations apps/core/src/procurement apps/core/src/receiving apps/core/src/fulfillment apps/core/src/delivery && git commit -m "fix(operations): enforce scoped legal commands"`

Run with `0019`: add `apps/core/migrations/0019_operations_integrity.sql apps/core/migrations/README.md` to that commit.

**Acceptance criteria:** every operational write is context-owned, authorized, versioned, idempotent, legally transitioned, audited, and atomic; an additional migration exists only if justified by a failing invariant test.

## Task 3: Add domain-specific operational read models

**Files:**
- Create: `apps/core/src/procurement/application/list-procurement-queue.ts`
- Create: `apps/core/src/receiving/application/get-receiving-workbench.ts`
- Create: `apps/core/src/fulfillment/application/list-fulfillment-queue.ts`
- Create: `apps/core/src/delivery/application/list-delivery-dispatch.ts`
- Create: `apps/core/src/delivery/application/list-rider-jobs.ts`
- Create: `apps/core/src/audit/application/list-operational-exceptions.ts`
- Test: `apps/core/src/operations/application/operational-read-models.integration.test.ts`
- Modify: `packages/contracts/src/operations.ts`
- Modify: `packages/contracts/src/core-service.ts`

**Interfaces:**
- Procurement queue: cycle/location/supplier grouping, committed demand, status, cutoff, shortages, expected version, allowed actions.
- Receiving workbench: purchase order lines, received/rejected remaining quantities, evidence, discrepancies, inventory posting status, expected version.
- Fulfillment queue: wave/order/location/zone, reservation/demand readiness, exceptions, expected version, allowed actions.
- Delivery dispatch/rider jobs: assigned rider, route/sequence/address snapshot/status/evidence, scoped allowed actions, expected version.
- Exception view includes finance reaction failures as read-only/manual-review facts; it does not expose provider secrets.

- [ ] **Step 1: Write failing projection/authorization tests**

Seed two locations, multiple roles, assigned/unassigned riders, normal and exception cases. Assert stable ordering, pagination cursor, location filtering, permission filtering, allowed-action derivation, snapshot use, no raw rows, and no cross-location/rider leakage.

- [ ] **Step 2: Run test and prove failure**

Run: `pnpm --filter @freshmarkets/core exec vitest run --config vitest.config.ts src/operations/application/operational-read-models.integration.test.ts`

Expected: FAIL because the domain-specific read models do not exist.

- [ ] **Step 3: Implement read-only query services**

Query through repositories owned by each context. Join/project only the fields required by the operator decision. Compute `allowedActions` from IAM plus legal transition policy; the UI must not invent authorization.

- [ ] **Step 4: Add typed contracts**

Use tagged read-model DTOs and opaque pagination cursors. Keep location IDs explicit and provider/infrastructure types absent.

- [ ] **Step 5: Run tests and commit**

Run: `pnpm --filter @freshmarkets/core exec vitest run --config vitest.config.ts src/operations/application/operational-read-models.integration.test.ts && pnpm --filter @freshmarkets/contracts test && pnpm typecheck`

Expected: all commands exit 0.

Run: `git add apps/core/src/procurement apps/core/src/receiving apps/core/src/fulfillment apps/core/src/delivery apps/core/src/audit apps/core/src/operations packages/contracts/src/operations.ts packages/contracts/src/core-service.ts && git commit -m "feat(operations): add scoped operational read models"`

**Acceptance criteria:** each role sees only decision-ready, location-scoped data and legal actions; contracts contain no generic rows, arbitrary mutations, or infrastructure types.

## Task 4: Replace the generic operations API with domain routes

**Files:**
- Create: `apps/web/app/api/admin/procurement/route.ts`
- Create: `apps/web/app/api/admin/receiving/route.ts`
- Create: `apps/web/app/api/admin/fulfillment/route.ts`
- Create: `apps/web/app/api/admin/delivery/route.ts`
- Create: `apps/web/app/api/rider/jobs/route.ts`
- Test: `apps/web/app/api/admin/operations-routes.test.ts`
- Test: `apps/web/app/api/rider/jobs/route.test.ts`
- Modify: `apps/web/app/api/operations/route.ts`
- Modify: `apps/web/lib/core-client/core.ts`
- Modify: `apps/core/src/entrypoint/core-service.ts`
- Modify: `packages/contracts/src/core-service.ts`

**Interfaces and behavior:**
- Each route maps one domain query or explicit command through the Plan 04 checked Core client.
- Route payloads require idempotency and expected version where applicable; actor identity and scopes come from the authenticated Core session.
- Generic route becomes a temporary rejection/redirect only during the consumer transition and is deleted at task completion.

- [ ] **Step 1: Write failing route-contract tests**

Assert permission and location denials, stable domain-error mappings, idempotency replay, version conflict, malformed cursor, missing evidence, unassigned rider, and absence of arbitrary `action`/`targetState`/row-patch payloads.

- [ ] **Step 2: Run tests and prove failure**

Run: `pnpm --filter @freshmarkets/web exec vitest run --config vitest.config.ts app/api/admin/operations-routes.test.ts app/api/rider/jobs/route.test.ts`

Expected: FAIL because the domain routes are absent.

- [ ] **Step 3: Implement purpose-built routes**

Keep Web as BFF/presentation only. Reuse correlation IDs and idempotency keys, preserve exact Core error codes, and avoid all Service Binding casts outside `apps/web/lib/core-client/core.ts`.

- [ ] **Step 4: Remove the generic route and broad RPC methods**

Search for every `/api/operations` and generic operation RPC consumer, migrate it, then delete the generic route and compatibility contract methods. A route that merely hides an arbitrary state update behind another URL does not satisfy this task.

- [ ] **Step 5: Run tests and commit**

Run: `pnpm --filter @freshmarkets/web test && pnpm --filter @freshmarkets/contracts test && pnpm typecheck`

Expected: all commands exit 0.

Run: `git add apps/web/app/api/admin apps/web/app/api/rider apps/web/app/api/operations/route.ts apps/web/lib/core-client/core.ts apps/core/src/entrypoint/core-service.ts packages/contracts/src/core-service.ts && git commit -m "refactor(operations): replace generic web API"`

**Acceptance criteria:** no generic operations API/RPC remains; every route is domain-specific, typed, authorized in Core, and concurrency-safe.

## Task 5: Build admin and rider decision surfaces

**Files:**
- Create: `apps/web/app/admin/procurement/page.tsx`
- Create: `apps/web/app/admin/receiving/page.tsx`
- Create: `apps/web/app/admin/fulfillment/page.tsx`
- Create: `apps/web/app/admin/delivery/page.tsx`
- Create: `apps/web/app/rider/jobs/page.tsx`
- Create: `apps/web/components/operations/command-dialog.tsx`
- Test: `apps/web/tests/admin-operations.spec.ts`
- Test: `apps/web/tests/rider-jobs.spec.ts`
- Modify: `apps/web/app/admin/page.tsx`
- Modify: `apps/web/app/rider/page.tsx`

**Interfaces and UX rules:**
- Screens render domain read models, queues, exception emphasis, `allowedActions`, versions, and explicit evidence/reason inputs.
- Command controls preserve a stable idempotency key during retry and refresh the aggregate/read model after version conflict.
- Loading, empty, permission-denied, stale, cutoff, unavailable, and failed-command states are explicit.

- [ ] **Step 1: Write failing Playwright flows**

Cover location-scoped procurement, partial receiving/discrepancy, fulfillment exception, dispatch assignment, rider-only assigned jobs, proof-required delivery, duplicate submit, stale-version refresh, keyboard navigation, and accessible names/status announcements.

- [ ] **Step 2: Run browser tests and prove failure**

Run: `pnpm --filter @freshmarkets/web exec playwright test tests/admin-operations.spec.ts tests/rider-jobs.spec.ts`

Expected: FAIL because the purpose-built screens do not exist.

- [ ] **Step 3: Implement the smallest decision-ready UI**

Use shadcn/ui primitives and meaningful operational compositions. Do not create generic CRUD/table editors. Render server-derived actions and surface command outcomes without optimistic state fabrication.

- [ ] **Step 4: Verify responsive and permission states**

Exercise desktop admin, narrow tablet, and mobile rider viewports. Verify unauthorized routes reveal no scoped data and Core remains the final authorization authority.

- [ ] **Step 5: Run gates and commit**

Run: `pnpm --filter @freshmarkets/web exec playwright test tests/admin-operations.spec.ts tests/rider-jobs.spec.ts && pnpm --filter @freshmarkets/web test && pnpm --filter @freshmarkets/web check:vinext`

Expected: all commands exit 0.

Run: `git add apps/web/app/admin apps/web/app/rider apps/web/components/operations apps/web/tests/admin-operations.spec.ts apps/web/tests/rider-jobs.spec.ts && git commit -m "feat(operations): add admin and rider workspaces"`

**Acceptance criteria:** staff and riders can complete MVP operational work from scoped decision surfaces; the UI exposes no raw CRUD or unauthorized transition capability.

## Task 6: Remove residual compatibility surfaces and verify ownership

**Files:**
- Modify: `apps/core/src/entrypoint/core-service.ts`
- Modify: `apps/core/src/entrypoint/composition.ts`
- Modify: `apps/core/src/index.ts`
- Modify: `packages/contracts/src/core-service.ts`
- Test: `apps/core/src/architecture/ownership.test.ts`
- Test: `apps/web/lib/core-client/core.test.ts`

**Interfaces and scans:**
- One registered method per canonical application command/query.
- No `advanceOrder`, `adjustInventory`, `receiveProcurement`, `advanceDelivery`, `commitMockOrder`, `startTrial`, generic operation, or arbitrary target-state compatibility RPC remains unless its exact name is canonical and domain-scoped; broad legacy forms must be deleted.
- Better Auth schema/adapter imports only auth-owned tables; provider states/references only appear in Payments adapters/infrastructure.

- [ ] **Step 1: Write failing architecture scans**

Assert context import boundaries, entrypoint thinness, Better Auth ownership, provider vocabulary isolation, checked Web adapter use, absence of raw-row contracts, and removal of every compatibility symbol recorded in Plans 02–07.

- [ ] **Step 2: Run tests and inspect exact residuals**

Run: `pnpm --filter @freshmarkets/core exec vitest run --config vitest.config.ts src/architecture/ownership.test.ts && pnpm --filter @freshmarkets/web exec vitest run --config vitest.config.ts lib/core-client/core.test.ts`

Expected: FAIL on any residual compatibility/import violation.

- [ ] **Step 3: Delete residual wiring only after consumer proof**

Use `rg` to identify imports/callers, migrate any remaining declared consumer, delete the legacy surface, and rerun focused tests. Do not delete historical migrations/data or silently broaden a replacement method.

- [ ] **Step 4: Run full program verification and commit**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm format:check && pnpm naming:check && pnpm -r build && pnpm --filter @freshmarkets/web check:vinext`

Expected: all commands exit 0.

Run: `git add apps/core/src/entrypoint apps/core/src/index.ts apps/core/src/architecture packages/contracts/src/core-service.ts apps/web/lib/core-client/core.ts apps/web/lib/core-client/core.test.ts && git commit -m "refactor(core): remove remediation compatibility seams"`

**Acceptance criteria:** ownership is mechanically checked; the Core entrypoint exposes only canonical application ports; compatibility and generic mutation surfaces are absent.

## Final Acceptance Gate

- [ ] Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm format:check`
- [ ] Run: `pnpm naming:check && pnpm -r build && pnpm --filter @freshmarkets/web check:vinext`
- [ ] Apply migrations `0001` through the latest accepted migration (`0018` or justified `0019`) from a fresh database and from the previous accepted migration fixture.
- [ ] Repeat inventory, receiving, capacity, operational command, and payment-reaction concurrency tests three times.
- [ ] Run: `rg -n "commitMockOrder|advanceOrder|as unknown as CoreServiceBinding|/api/operations|targetState|trial_days|CANCELLED" apps/core/src apps/web packages/contracts/src`
- [ ] Run: `rg -n -i "provider.*(state|status|customer|subscription|payment)" apps/core/src packages/contracts/src --glob "!payments/**"`
- [ ] Review every result; permit only explicit adapter/infrastructure test fixtures and historical migration compatibility.
- [ ] Confirm no new deployment, public API, CORS, Durable Object, Workflow, KV, Queue, or raw-row contract was introduced.
- [ ] Confirm `git status --short` contains only files declared by the executing plan and no unrelated dirty Phase 4C changes were overwritten.

**Acceptance criteria:** operational flows are legal, scoped, idempotent, versioned, auditable, and decision-ready; Core remains a coherent modular monolith; architectural ownership and deployment boundaries match the canonical documentation.
