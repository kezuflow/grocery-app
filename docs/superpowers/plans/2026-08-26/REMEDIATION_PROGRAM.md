# FreshMarkets Architecture Remediation Program

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the implementation into conformance with the approved canonical architecture through dependency-ordered, independently reviewable P0/P1 slices without continuing the unaccepted Phase 4C work.

**Architecture:** Preserve the two-Worker deployment and the single Core modular monolith. Fix independently containable security, fabricated-financial-outcome, and stock-integrity P0s first; then establish checked contracts and explicit Core bounded-context modules before implementing provider-neutral Payments, Membership/Promotions, Checkout/Orders, and scoped operations.

**Tech Stack:** pnpm 11, TypeScript 7, Cloudflare Workers and Service Bindings, D1, vinext, Better Auth 1.7.1, Drizzle ORM, Zod, Vitest, Playwright where browser/auth behavior requires it.

**Spec:** `AGENTS.md` and the canonical documents listed there, in the precedence order declared by the user.

## Global Constraints

- Execute no remediation from the current dirty worktree. First create an isolated worktree from a commit containing the approved canonical documents and these plans.
- Preserve the existing dirty Phase 4C diff as evidence only. Do not copy it into the execution worktree wholesale.
- `apps/web` remains presentation/BFF; `apps/core` remains the authoritative single-Worker modular monolith.
- Do not introduce microservices, public general-purpose Core APIs, Durable Objects, Workflows, KV, or Queues without a separately approved need.
- Applied migrations `0001` through `0014` are immutable.
- The untracked `0015_phase4c_subscriptions.sql` is not accepted. Remove it only in the isolated execution worktree when the first approved replacement `0015` migration is added.
- Prefer additive tables, columns, indexes, and compatibility adapters. Never edit an applied migration.
- Do not invent the production payment provider, dunning/grace policy, default cancellation timing, paid-but-uncommitted recovery policy, or post-clamp recurring billing anchor.
- Every client/application/admin lifecycle command uses a stable idempotency key and an expected aggregate version where concurrent mutation is possible.
- Provider events use signed ingress, unique `(provider, providerEventId)` inbox identity, handler-side state/version CAS, and retry/reconciliation; they never receive an application `expectedVersion`.
- Each slice starts with failing tests, ends with the stated verification gate, and is reviewed before its dependents begin.

---

## Recommended Sequence

| Order | Plan | Priority | May run concurrently | Hard dependencies |
|---:|---|---|---|---|
| 1 | `AUTHENTICATION_SECURITY.md` | P0 | Plans 02 and 03 | Approved docs/plans committed |
| 2 | `FINANCIAL_SAFETY_CONTAINMENT.md` | P0 | Plans 01 and 03 | Approved docs/plans committed |
| 3 | `INVENTORY_RECEIVING_INTEGRITY.md` | P0 | Plans 01 and 02 | Approved docs/plans committed; owns replacement migration `0015` |
| 4 | `CONTRACTS_WEB_BOUNDARY.md` | P1 | No | P0 gates 01–03 |
| 5 | `PAYMENTS_CONTEXT.md` | P0/P1 | No | Plans 02 and 04; owns migration `0016` |
| 6 | `MEMBERSHIP_PROMOTIONS.md` | P1 | No | Plans 04 and 05; owns migration `0017` |
| 7 | `CHECKOUT_ORDERS.md` | P0/P1 | No | Plans 03–06; owns migration `0018` |
| 8 | `OPERATIONS_CORE_STRUCTURE.md` | P1/P2 | No | Plans 03, 04, and 07; owns migration `0019` if required |

The three first slices are intentionally independent. A P1 directory or contract refactor must not delay a safe origin allowlist, fail-closed payment behavior, or atomic stock mutation.

## Recommended First Execution Slice

Execute `AUTHENTICATION_SECURITY.md` first. It removes an externally reachable trust-boundary defect and secret-logging risk without requiring a schema change or any unresolved product decision. Plans 02 and 03 may begin in separate isolated worktrees after their own baseline checks, but no P1 contract or structural work should precede review of these independently fixable P0s.

## P0/P1/P2 Dependency Graph

```text
                         ┌──────────────────────────┐
                         │ Approved canonical docs │
                         └────────────┬─────────────┘
              ┌──────────────────────┼──────────────────────┐
              v                      v                      v
      P0 Auth security      P0 Financial containment   P0 Stock/receiving
              └──────────────────────┼──────────────────────┘
                                     v
                         P1 Contracts/Web boundary
                                     v
                         P0/P1 Payments context
                                     v
                        P1 Membership/Promotions
                                     v
                         P0/P1 Checkout/Orders
                                     v
                 P1 Operations + required Core extraction
                                     v
                      P2 operational UI/pagination/polish
```

## Evaluated P2 Work

- Canonical documentation and minimal README authority/staleness notices are already part of the approved documentation baseline; no remediation slice rewrites them.
- `docs/product/IMPLEMENTATION_STATUS.md` remains descriptive and is updated only in the final evidence task.
- Pagination and operational UI refinement stay in Plan 08 after command, authorization, and read-model correctness.
- Formatting or aesthetic folder cleanup receives no standalone slice and cannot delay a P0/P1 gate.

## Dirty Phase 4C Disposition

| Existing dirty item | Disposition | Reason |
|---|---|---|
| Required idempotency keys on trial/start/resume/cancel DTO concepts | Retain concept, rewrite implementation | Canonical commands require stable idempotency, but the current route and methods are incomplete. |
| Expected-version fields on pause/resume/cancel | Retain concept, rewrite validation | Canonical for client lifecycle commands; the shared schema is currently optional. |
| Period start/end, paused/resume, cancellation-request/effective timestamps | Retain concept, rename/rewrite | Useful lifecycle metadata, but canonical names include `cancelAtPeriodEnd` and `scheduledCancellationAt`; provider refs do not belong here. |
| One-open-subscription index concept | Retain after preflight, rewrite migration | Canonical invariant, but the draft lacks duplicate cleanup/preflight and uses the wrong vocabulary. |
| Subscription event history concept | Retain, rewrite ownership/columns | Events should reference application payment and promotion-redemption IDs, not provider vocabulary. |
| PHP 299 monthly paid membership seed | Retain business value, rewrite migration | Canonical value; the draft incorrectly embeds `trial_days=14`. |
| `SubscriptionSummary` helper and DTO | Rewrite | Must use closed states, exact trial timestamps, scheduled-cancellation metadata, and no `trialDays` offer authority. |
| `startSubscription(paymentMethodRef)` | Discard | Payment methods and provider interaction belong to Payments. |
| `CANCELLED` spelling and `CANCELLED -> EXPIRED` | Discard | Canonical spelling is `CANCELED`; both terminal states have no outgoing transition. |
| Fixed-day `trial_days` calculation | Discard | Trial is one calendar month in business timezone and Promotions-owned. |
| `provider_customer_ref` / `provider_subscription_ref` on Subscription | Discard | Provider mappings belong to Payments. |
| Unimplemented methods added to `CoreServiceBinding` | Discard as-is, replace through Plan 04/06 | Contracts must not advertise absent behavior. |
| `0015_phase4c_subscriptions.sql` | Discard as a file | It is unapplied and architecturally invalid. Plan 03 creates the replacement migration number `0015`. |

### Exact Dirty-File Disposition

| Dirty Phase 4C file | Retain | Rewrite | Discard |
|---|---|---|---|
| `apps/core/src/commerce/state-machines.ts` | Unrelated accepted state machines | Subscription lifecycle as a Membership-owned closed machine with scheduled intent metadata | `CANCELLED`, `CANCELED -> EXPIRED`, and every terminal-state exit |
| `apps/core/src/index.ts` | Pre-existing accepted handlers outside the dirty hunk until their owning plans replace them | Stable-idempotency/version command concepts into bounded-context application modules | Fixed-day trial behavior, provider-shaped Membership start, fabricated financial outcomes, and unimplemented Phase 4C entrypoint methods |
| `apps/core/src/validation.ts` | Existing shared validators that still match closed contracts | Version validator so concurrent client/admin lifecycle commands require it at the command boundary | Optional/broad version semantics used to bypass concurrency protection |
| `packages/contracts/src/index.ts` | Accepted pre-Phase 4C DTOs pending Plan 04 extraction | Useful subscription timestamps/idempotency/version fields into domain-grouped closed contracts | `trialDays` authority, `paymentMethodRef`, provider references/states, noncanonical spelling, and advertised-but-absent methods |
| `apps/core/migrations/0015_phase4c_subscriptions.sql` | Nothing as executable migration; retain only the recorded hash as evidence | Canonical concepts are reintroduced in migrations owned by Plans 05–07 | Entire untracked file after hash verification in the isolated worktree |

## Draft 0015 Invalidity

The draft is invalid because it:

- converts `CANCELED` to noncanonical `CANCELLED`;
- gives a terminal state an outgoing transition in the dirty state map;
- retains `trial_days=14` on the paid offer;
- treats offer configuration as trial authority rather than a Promotions grant/redemption;
- stores provider customer/subscription references on the Subscription aggregate;
- lacks the exact `cancel_at_period_end` plus scheduled-cancellation semantics;
- creates an event table that overlaps provider-event handling without `(provider, providerEventId)` inbox identity;
- may fail the open-subscription unique index when duplicate open rows already exist;
- uses `INSERT OR IGNORE` in a way that can preserve an incompatible pre-existing `MEMBERSHIP` row or leave no valid default;
- has no historical-trial grant/redemption backfill strategy;
- lacks closed-state and billing-interval constraints.

## Migration Allocation

| Migration | Owning plan | Purpose |
|---|---|---|
| `0015_inventory_receiving_integrity.sql` | Plan 03 | Replay-safe receiving evidence and integrity indexes/guards needed for atomic stock commands |
| `0016_payments_context.sql` | Plan 05 | Provider-neutral intents/attempts, provider mappings, event inbox, refunds/reconciliation metadata |
| `0017_membership_promotions.sql` | Plan 06 | Paid offer, canonical Subscription lifecycle, introductory Promotion grant/redemption |
| `0018_checkout_orders.sql` | Plan 07 | Versioned quote/commitment and complete immutable order/amendment snapshots |
| `0019_operations_integrity.sql` | Plan 08 | Only test-proven operational constraints/indexes if accepted tables cannot enforce a canonical invariant; otherwise no `0019` is created |

Before creating `0015_inventory_receiving_integrity.sql`, the execution worktree must verify that `0015_phase4c_subscriptions.sql` is absent. If it is present, compare its SHA-256 to the planning baseline `08BBFD508A04873DA2DF3FC87558850003AC1640EE2FB6195DBDF73AF20FED2C`; stop for user review if it differs, otherwise remove only that unapplied draft.

## Unresolved Decision Blockers

| Decision | Blocks | Does not block |
|---|---|---|
| Production payment provider/vendor mappings | Production adapter task in Plan 05 and launch acceptance | Financial containment, canonical Payments tables/state, fake provider contract tests, inbox/CAS/reconciliation |
| Renewal retry/grace/dunning policy | Automated `PAST_DUE` timing, retry scheduling, final renewal expiry in Plan 06 | Trial grant, terminal semantics, paid activation from canonical `SUCCEEDED`, manual reconciliation |
| Immediate vs period-end cancellation default | UI default and automatic policy selection in Plan 06 | Both explicit command modes and scheduled metadata/transitions |
| Paid-success/downstream-commit recovery policy | Automatic refund vs retry choice in Plan 07 | Durable finance exception, idempotent retry, visibility, and manual resolution seam |
| Billing anchor after month-end clamp | Recurring periods after the first post-trial invoice in Plan 06 | Exact one-calendar-month trial start/end calculation |

## Cross-Slice Verification Gates

No dependent plan begins until its prerequisite plan satisfies all of these applicable gates:

1. Focused tests demonstrate the original defect before implementation and pass afterward.
2. `pnpm naming:check` passes.
3. `pnpm typecheck` passes for Plans 04 onward; earlier P0 slices may not claim the unrelated dirty Phase 4C typecheck defect is fixed.
4. `pnpm test` passes.
5. `pnpm lint` and `pnpm format:check` pass for changed application files.
6. `pnpm -r build` passes when contracts, Worker bindings, routing, or runtime configuration changed.
7. Migration-owning slices apply every tracked migration from a fresh local D1 database and run command-level concurrency/replay tests.
8. Web/Core boundary slices run `pnpm --filter @freshmarkets/web check:vinext` and a production-like Service Binding smoke test.
9. Auth/provider ingress slices prove that logs contain no bearer URL, token, credential, or raw provider payload.
10. `git diff --check` passes and `git status --short` contains only files declared by the active plan.

## Program Task Impact and Acceptance Matrix

| Task | Depends on | Migration/compatibility impact | Decision blocker | Acceptance criteria |
|---|---|---|---|---|
| 1. Isolated baseline | Approved docs and these plans available in a commit | No migration; preserves the current dirty worktree byte-for-byte | None | Clean isolated worktree ends at tracked `0014`; rejected draft hash/evidence is recorded and original worktree is untouched |
| 2. Slice execution | Task 1 | Child plans own additive `0015` onward and compatibility removal | Stop only at the exact seams in the blocker matrix | Every slice is separately reviewed, passes its gates, and only then unlocks dependents |
| 3. Program acceptance | Reviewed Plans 01–08 | Fresh/upgrade migration verification; status doc changes only after evidence | Unresolved launch blockers remain reported, not invented | Repository-wide gates pass and descriptive status cites evidence without changing architecture |

## Program Execution Tasks

### Task 1: Establish an isolated execution baseline

**Files:**
- Modify: none
- Create: isolated Git worktree only; no repository file
- Test: current baseline commands

**Interfaces:**
- Consumes: a commit containing the approved canonical documents and all plan files
- Produces: clean execution worktree with applied migrations `0001`–`0014` and no draft `0015`

- [ ] **Step 1: Record the current dirty evidence without changing it**

Run: `git status --short && git diff -- apps/core/src/commerce/state-machines.ts apps/core/src/index.ts apps/core/src/validation.ts packages/contracts/src/index.ts && Get-FileHash apps/core/migrations/0015_phase4c_subscriptions.sql -Algorithm SHA256`

Expected: the known four-file Phase 4C diff plus draft hash `08BBFD508A04873DA2DF3FC87558850003AC1640EE2FB6195DBDF73AF20FED2C`.

- [ ] **Step 2: Use the required worktree skill**

Invoke `superpowers:using-git-worktrees` and create the isolated worktree from the commit containing these plans. Do not stash, reset, or clean the user's current worktree.

- [ ] **Step 3: Prove the isolated baseline**

Run: `git status --short && rg --files apps/core/migrations | sort`

Expected: clean status; tracked migrations end at `0014_phase4b_address_serviceability_outcome.sql`.

### Task 2: Execute and review slices in dependency order

**Files:**
- Modify: only files declared by the active child plan
- Create: only files declared by the active child plan
- Test: each child plan's focused and full gates

**Interfaces:**
- Consumes: the reviewed result and recorded contract outputs of the prerequisite slice
- Produces: one independently reviewable commit series per plan

- [ ] **Step 1: Execute Plans 01–03 independently**

Use one isolated branch/worktree per plan if they run concurrently. Merge only after each P0 review passes.

- [ ] **Step 2: Execute Plans 04–08 serially**

Start each plan from the reviewed integration point containing all dependencies shown in the sequence table.

- [ ] **Step 3: Stop at every unresolved-decision gate**

Implement the provider-independent seam and visible exception state, then stop before policy-specific automation identified in the blocker matrix.

### Task 3: Final program acceptance

**Files:**
- Modify: `docs/product/IMPLEMENTATION_STATUS.md` only after all code/data gates pass
- Create: none
- Test: repository-wide verification

**Interfaces:**
- Consumes: reviewed results from Plans 01–08
- Produces: an evidence-backed descriptive status update, not a new architecture decision

- [ ] **Step 1: Run full verification**

Run: `pnpm check`

Expected: exit 0.

- [ ] **Step 2: Run production-boundary verification**

Run: `pnpm --filter @freshmarkets/web check:vinext && pnpm -r build`

Expected: both commands exit 0.

- [ ] **Step 3: Audit state and secret terminology**

Run: `rg -n -i "CANCELLED|trial_days|commitMockOrder|paymentStatus:\s*\"SUCCEEDED\"|url:\s*data\.url|x-forwarded-origin" apps packages`

Expected: no production-domain matches; any retained sandbox/test fixture is explicitly development-only and named as such.

- [ ] **Step 4: Update descriptive status and commit**

Run: `git add docs/product/IMPLEMENTATION_STATUS.md && git commit -m "docs: record architecture remediation status"`

Expected: commit contains only the descriptive status update and cites the verification evidence.
