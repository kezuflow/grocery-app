# Inventory, Procurement, and Receiving Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make inventory adjustment and receiving replay-safe and atomic, enforce quantity/procurement-state guards, and prove reservation and committed-demand integrity under concurrency.

**Architecture:** Extract only the high-risk inventory/receiving commands from the Worker entrypoint into focused Core application modules backed by D1 transactional batches. Each accepted stock delta is inseparable from its ledger evidence and idempotency completion. Receiving records append immutable delta events and conditionally update current totals/inventory; procurement state and remaining quantity are checked in the same command boundary.

**Tech Stack:** Cloudflare D1 transactional `batch()`, TypeScript, Zod, Vitest Workers pool.

**Spec:** `AGENTS.md` Locked Business Invariants; `docs/architecture/DOMAIN_MODEL.md` Supply and Inventory; `docs/architecture/STATE_MACHINES.md` Procurement, Receiving, and Fulfillment; `docs/architecture/DATA_MODEL.md` Inventory/Committed Demand and Concurrency Boundaries.

## Global Constraints

- Priority: P0 for atomicity/replay/quantity integrity; P1 for explicit command ownership and complete concurrency coverage.
- Execute in an isolated clean worktree and preserve the dirty Phase 4C worktree.
- Applied migrations `0001`–`0014` are immutable.
- This plan owns replacement migration `0015_inventory_receiving_integrity.sql`; the unaccepted draft subscription migration must not coexist with it.
- Do not merge inventory reservation and committed procurement demand into one record or status.
- Quantities are exact integer base units. Never permit `on_hand < 0`, `reserved < 0`, `reserved > on_hand` for stocked inventory, or receipt totals beyond expected quantity without an explicit future exception policy.
- Do not introduce a generic repository framework. Extract only commands required for these integrity fixes.

---

## Dependencies and Decision Blockers

- Depends only on approved docs/plans and the clean execution baseline.
- May run independently of Plans 01 and 02.
- None of the unresolved payment, cancellation, dunning, or billing-anchor decisions blocks this plan.
- Supplier over-delivery policy is not canonical. Therefore the command must reject accepted/rejected totals above expected quantity rather than invent an overage policy.

## Migration and Compatibility Impact

- Remove in the isolated worktree: `apps/core/migrations/0015_phase4c_subscriptions.sql`, only after the hash check in Plan 00.
- Create: `apps/core/migrations/0015_inventory_receiving_integrity.sql`.
- Add immutable `receiving_event` rows with unique command idempotency identity and quantity checks.
- Add supporting indexes only; do not rewrite existing balances, requirements, receipts, reservations, demand, or ledger history.
- Existing generic RPC names remain compatibility adapters but delegate to the new commands.

## Task Impact Matrix

| Task | Depends on | Migration impact | Compatibility impact | Unresolved product-decision blocker |
|---|---|---|---|---|
| 1. Persistence | None; verify rejected-draft hash first | Replaces unaccepted draft with `0015_inventory_receiving_integrity.sql` | Historical accepted migrations stay immutable; no subscription objects survive in `0015` | None |
| 2. Inventory adjustment | Task 1 | Uses `0015`; no additional migration | Existing adjustment consumer migrates to a versioned/idempotent command | None |
| 3. Receiving | Tasks 1–2 | Uses `0015`; no additional migration | Existing receiving RPC becomes a guarded command with replay-stable result | None |
| 4. Reservation/demand evidence | Tasks 2–3 | None | Existing stocked and planned flows retain behavior only where canonical separation tests pass | None |

## Task Acceptance Matrix

| Task | Acceptance criteria |
|---|---|
| 1. Persistence | Rejected draft `0015` is hash-checked and replaced; fresh/upgrade schemas enforce receiving/idempotency integrity without subscription architecture |
| 2. Inventory adjustment | Balance, ledger, version, audit, and idempotency completion commit atomically; replay is stable and concurrent stale writes lose safely |
| 3. Receiving | Legal procurement state and positive remaining quantity are enforced; duplicate/reordered receipt requests cannot double-post inventory |
| 4. Reservation/demand evidence | Stocked reservations and planned committed demand remain distinct under mixed sourcing, retries, cancellation, and concurrent capacity/inventory mutation |

## Task 1: Replace draft 0015 with receiving-integrity persistence

**Files:**
- Remove: `apps/core/migrations/0015_phase4c_subscriptions.sql`
- Create: `apps/core/migrations/0015_inventory_receiving_integrity.sql`
- Test: `apps/core/src/inventory/inventory-migration.integration.test.ts`

**Interfaces:**
- Produces table `receiving_event(id, receiving_record_id, procurement_requirement_id, location_id, inventory_pool_id, accepted_delta, rejected_delta, reason, idempotency_key, occurred_at)`
- Produces unique index on `receiving_event(idempotency_key)`
- Produces indexes on receiving record/time and requirement/time
- Preserves all tables and rows from migrations `0001`–`0014`

- [ ] **Step 1: Verify and remove only the known draft**

Run: `Get-FileHash apps/core/migrations/0015_phase4c_subscriptions.sql -Algorithm SHA256`

Expected: `08BBFD508A04873DA2DF3FC87558850003AC1640EE2FB6195DBDF73AF20FED2C`. If the hash differs, stop. If it matches, remove only this unapplied draft in the isolated worktree.

- [ ] **Step 2: Write a failing migration test**

The test must query `sqlite_master` for `receiving_event`, assert unique idempotency by attempting two rows with the same key, and assert database rejection for negative deltas:

```ts
await expect(insertEvent({ acceptedDelta: -1, rejectedDelta: 0 })).rejects.toThrow();
await insertEvent({ acceptedDelta: 1, rejectedDelta: 0, idempotencyKey: "receive-1" });
await expect(
  insertEvent({ acceptedDelta: 1, rejectedDelta: 0, idempotencyKey: "receive-1" }),
).rejects.toThrow();
```

- [ ] **Step 3: Run the migration test and prove failure**

Run: `pnpm --filter @freshmarkets/core exec vitest run --config vitest.config.ts src/inventory/inventory-migration.integration.test.ts`

Expected: FAIL because `receiving_event` does not exist.

- [ ] **Step 4: Create the additive migration**

Use exact nonnegative checks:

```sql
CHECK (accepted_delta >= 0),
CHECK (rejected_delta >= 0),
CHECK (accepted_delta + rejected_delta > 0)
```

Reference existing receiving, requirement, location, and inventory-pool identities where current D1 foreign-key compatibility permits. Add no subscription or payment statement.

- [ ] **Step 5: Run migration tests from a fresh D1 database**

Run: `pnpm --filter @freshmarkets/core exec vitest run --config vitest.config.ts src/inventory/inventory-migration.integration.test.ts`

Expected: the new table/constraint/uniqueness tests pass and all tracked migrations apply.

- [ ] **Step 6: Commit the migration replacement**

Run: `git add -A apps/core/migrations/0015_phase4c_subscriptions.sql apps/core/migrations/0015_inventory_receiving_integrity.sql apps/core/src/inventory/inventory-migration.integration.test.ts && git commit -m "fix(inventory): add receiving integrity evidence"`

## Task 2: Atomic inventory adjustment command

**Files:**
- Create: `apps/core/src/inventory/application/adjust-inventory.ts`
- Create: `apps/core/src/inventory/infrastructure/inventory-repository.ts`
- Test: `apps/core/src/inventory/application/adjust-inventory.integration.test.ts`
- Modify: `apps/core/src/index.ts`
- Modify: `apps/core/src/validation.ts`
- Modify: `packages/contracts/src/index.ts` only for a closed result DTO/error code needed before Plan 04

**Interfaces:**
- Consumes: `AdjustInventoryCommand { requestId, actorId, locationId, inventoryPoolId, deltaBase, reason, expectedVersion, idempotencyKey }`
- Produces: `InventoryAdjustmentResult { locationId, inventoryPoolId, onHandBase, reservedBase, version, ledgerEntryId }`
- Produces errors: `STALE_VERSION`, `INSUFFICIENT_STOCK`, `IDEMPOTENCY_CONFLICT`, `NOT_FOUND`
- Repository operation: `executeAdjustment(command, requestHash): Promise<InventoryAdjustmentExecution>`

- [ ] **Step 1: Write failing command-level tests**

Cover:

```ts
await expectAdjustment({ deltaBase: -6, expectedVersion: 1 }).toFail("INSUFFICIENT_STOCK");
await expectAdjustment({ deltaBase: 3, expectedVersion: 0 }).toFail("STALE_VERSION");
const first = await adjust(command);
const replay = await adjust(command);
expect(replay).toEqual(first);
await expectAdjustment({ ...command, deltaBase: 2 }).toFail("IDEMPOTENCY_CONFLICT");
```

After every failure, assert unchanged balance/version and zero new ledger rows. After success, assert exactly one balance version increment, one ledger row, and one `SUCCEEDED` idempotency record.

- [ ] **Step 2: Run the focused test and prove failure**

Run: `pnpm --filter @freshmarkets/core exec vitest run --config vitest.config.ts src/inventory/application/adjust-inventory.integration.test.ts`

Expected: FAIL because the command/repository modules do not exist and the current implementation can mutate before ledger completion.

- [ ] **Step 3: Implement one transactional batch**

The repository batch must execute in this order:

1. Insert `idempotency_records` in `PROCESSING` with unique scope/key and request hash.
2. Conditionally update `inventory_balance` where identity/version match and resulting quantities satisfy invariants.
3. Insert one `inventory_ledger_entries` row only when the conditional update produced the expected new version.
4. Mark idempotency `SUCCEEDED` only when that ledger row exists; otherwise mark it `FAILED` without mutating balance.

If the batch aborts on duplicate idempotency identity, read and resolve the existing record. Never perform the balance update in a separate `.run()` call.

- [ ] **Step 4: Delegate the compatibility RPC**

Keep authorization/scope resolution in the application boundary, derive `actorId` from authenticated context, validate required `expectedVersion`, and call `adjustInventory`. Remove the client-header actor fallback and the old standalone balance update.

- [ ] **Step 5: Run focused tests**

Run: `pnpm --filter @freshmarkets/core exec vitest run --config vitest.config.ts src/inventory/application/adjust-inventory.integration.test.ts src/auth/authorization.test.ts`

Expected: all tests pass.

- [ ] **Step 6: Commit atomic adjustment**

Run: `git add apps/core/src/inventory apps/core/src/index.ts apps/core/src/validation.ts packages/contracts/src/index.ts && git commit -m "fix(inventory): make adjustment ledger atomic"`

## Task 3: Replay-safe guarded receiving commands

**Files:**
- Create: `apps/core/src/procurement/application/start-receiving.ts`
- Create: `apps/core/src/procurement/application/record-received-line.ts`
- Create: `apps/core/src/procurement/infrastructure/receiving-repository.ts`
- Test: `apps/core/src/procurement/application/receiving.integration.test.ts`
- Modify: `apps/core/src/index.ts`
- Modify: `apps/core/src/validation.ts`
- Modify: `packages/contracts/src/index.ts` only for temporary compatibility command/result types

**Interfaces:**
- Consumes: `StartReceivingCommand { requirementId, expectedVersion, idempotencyKey, actorId, requestId }`
- Consumes: `RecordReceivedLineCommand { receivingRecordId, acceptedDeltaBase, rejectedDeltaBase, reason, expectedVersion, idempotencyKey, actorId, requestId }`
- Produces: `ReceivingResult { receivingRecordId, status, acceptedBase, rejectedBase, remainingBase, version, inventoryVersion }`
- Legal states: procurement requirement `ORDERED | PARTIALLY_RECEIVED`; receiving record `IN_PROGRESS | DISCREPANCY`

- [ ] **Step 1: Write failing state/quantity/replay tests**

Cover illegal procurement state, stale version, zero delta, negative delta, total beyond expected, duplicate same-key replay, same-key/different-payload conflict, and two concurrent commands for the last remaining quantity. Exactly one concurrent command may succeed.

Assert one successful accepted delta creates exactly one `receiving_event`, one inventory ledger entry, one inventory version increment, and one receiving version increment. Rejected quantity creates an event but never increments usable inventory.

- [ ] **Step 2: Run focused tests and prove failure**

Run: `pnpm --filter @freshmarkets/core exec vitest run --config vitest.config.ts src/procurement/application/receiving.integration.test.ts`

Expected: FAIL because current receiving accepts unbounded cumulative quantities and replay with new keys can inflate stock.

- [ ] **Step 3: Implement guarded start and record commands**

`StartReceiving` conditionally transitions the receipt to `IN_PROGRESS`. `RecordReceivedLine` computes remaining quantity from the authoritative row, then uses one D1 batch to claim idempotency, conditionally update receipt totals/version, insert the immutable receiving event, conditionally update inventory for accepted delta, insert the inventory ledger row, update requirement state to `PARTIALLY_RECEIVED` or `RECEIVED`, and complete idempotency. If any dependent insert/update cannot prove the expected version, the batch must not report success.

- [ ] **Step 4: Delegate compatibility receiving RPC**

Map the existing compatibility request to `RecordReceivedLineCommand` only after authorization, requirement/receipt lookup, and required version validation. Do not accept a client-selected actor.

- [ ] **Step 5: Run focused and concurrency tests**

Run: `pnpm --filter @freshmarkets/core exec vitest run --config vitest.config.ts src/procurement/application/receiving.integration.test.ts src/commerce/concurrency.integration.test.ts`

Expected: all tests pass; final stock equals the sum of unique accepted receiving events.

- [ ] **Step 6: Commit guarded receiving**

Run: `git add apps/core/src/procurement apps/core/src/index.ts apps/core/src/validation.ts packages/contracts/src/index.ts && git commit -m "fix(receiving): enforce replay safe quantities"`

## Task 4: Reservation and committed-demand concurrency evidence

**Files:**
- Create: `apps/core/src/inventory/reservation-demand.integration.test.ts`
- Modify: `apps/core/src/commerce/inventory-plan.ts` only if a failing test proves a planning defect
- Modify: `apps/core/src/commerce/inventory-plan.test.ts` only for added canonical cases

**Interfaces:**
- Consumes: `buildInventoryCommitPlan`
- Verifies: STOCKED creates reservation only; PLANNED_PROCUREMENT creates demand only; HYBRID may create both with disjoint exact quantities summing to requested base units
- Verifies: concurrent commitment never reserves beyond usable stock

- [ ] **Step 1: Add failing end-to-end invariant tests**

For each sourcing mode, commit two concurrent commands against constrained stock and assert:

```ts
expect(reservedBase + plannedBase).toBe(requestedBase);
expect(finalBalance.reserved).toBeLessThanOrEqual(finalBalance.onHand);
expect(sumLedgerReservationDeltas).toBe(finalBalance.reserved - initialBalance.reserved);
```

For a STOCKED line, assert no committed-demand row. For PLANNED_PROCUREMENT, assert no reservation. For HYBRID, assert the two records reference the same order item but contain nonoverlapping quantities.

- [ ] **Step 2: Run tests and prove any defect**

Run: `pnpm --filter @freshmarkets/core exec vitest run --config vitest.config.ts src/inventory/reservation-demand.integration.test.ts src/commerce/inventory-plan.test.ts`

Expected before fixes: at least the command-level concurrency or evidence assertion fails. Do not change the pure planner if only orchestration is defective.

- [ ] **Step 3: Apply the minimal orchestration/planner correction**

Change only the smallest function proven defective. Preserve separate reservation and demand rows and base-unit totals.

- [ ] **Step 4: Run focused tests and commit**

Run: `pnpm --filter @freshmarkets/core exec vitest run --config vitest.config.ts src/inventory/reservation-demand.integration.test.ts src/commerce/inventory-plan.test.ts src/commerce/concurrency.integration.test.ts`

Expected: all tests pass.

Run: `git add apps/core/src/inventory/reservation-demand.integration.test.ts apps/core/src/commerce/inventory-plan.ts apps/core/src/commerce/inventory-plan.test.ts && git commit -m "test(inventory): prove reservation demand separation"`

## Final Acceptance Gate

- [ ] Run: `pnpm --filter @freshmarkets/core test`
- [ ] Run: `pnpm typecheck && pnpm lint && pnpm format:check`
- [ ] Run: `pnpm naming:check && pnpm -r build`
- [ ] Run: `rg -n "UPDATE inventory_balance" apps/core/src/index.ts`
- [ ] Confirm the old standalone adjustment/receiving updates are absent from `index.ts`; only focused repositories own these writes.
- [ ] Apply migrations to a fresh local D1 database and rerun the duplicate/concurrency tests at least three times.
- [ ] Confirm `git status --short` lists only files declared above and the only `0015` file is `0015_inventory_receiving_integrity.sql`.

**Acceptance criteria:** balance, ledger, receipt evidence, and idempotency outcome are atomic; retries are deterministic; quantity/state/version guards reject invalid receiving; stock cannot inflate from replay; reservation and planned demand remain separate and exactly reconcile requested base units.
