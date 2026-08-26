# Membership and Introductory Promotion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the PHP 299/calendar-month Membership aggregate and a one-calendar-month Promotions-owned introductory trial with canonical terminal/cancellation semantics and Payments-driven paid activation.

**Architecture:** Reuse the existing subscription tables additively where safe, but make legacy `trial_days` inert and Promotions grant/redemption authoritative. Membership commands live in focused Core modules, use closed states and optimistic versions, and consume durable canonical Payments reactions. Client commands provide stable idempotency/expected version; payment reactions and time-driven commands load current version and use internal CAS.

**Tech Stack:** Cloudflare D1, TypeScript calendar/timezone APIs, Zod, Vitest Workers pool, shared domain contracts.

**Spec:** `docs/architecture/DOMAIN_MODEL.md` Membership and Promotion; `docs/architecture/STATE_MACHINES.md` Subscription; `docs/architecture/DATA_MODEL.md` Subscriptions and Promotions; `docs/architecture/API_CONTRACTS.md` Subscription and Membership Payments; `docs/product/MVP_SCOPE.md` criterion 3.

## Global Constraints

- Priority: P1 lifecycle/domain correctness; paid activation is financial P0 and must remain provider-confirmed.
- Depends on Plans 04 and 05 and migration `0016`.
- Creates additive migration `0017_membership_promotions.sql`; never repair the rejected draft 0015.
- Current offer is PHP `29900`, currency `PHP`, interval `CALENDAR_MONTH`.
- `trial_days` is legacy storage only and must never authorize or calculate a new trial.
- Trial entitlement requires an atomically consumed Promotions grant/redemption and lasts one calendar month in the Market business timezone.
- Enforce the one trial per customer invariant independently of offer metadata.
- `CANCELED` and `EXPIRED` are terminal with no outgoing transitions.
- Period-end cancellation records intent and preserves `TRIALING`/`ACTIVE` until an explicit effective-time command transitions to `CANCELED`.
- Provider references and methods remain in Payments.

---

## Dependencies and Decision Blockers

- Production provider selection does not block reacting to canonical Payments `SUCCEEDED`.
- Renewal grace/dunning blocks automatic retry schedules and the exact timed path through `PAST_DUE`; implement states/commands and manual/provider reaction seams, but stop before policy automation.
- Immediate versus period-end cancellation default blocks only which option the UI preselects. Implement both explicit commands without choosing a default.
- Paid-success/downstream failure policy does not block Membership's idempotent activation reaction; Payments records reaction failure for reconciliation.
- Post-clamp billing anchor blocks recurring period generation after the first paid period. It does not block exact trial start/end or initial paid activation. Do not calculate later renewal periods in this plan.
- Technical gate: native `Temporal` support must pass in the Core Workers test runtime. If unavailable, stop for explicit approval of a polyfill dependency rather than implementing ad hoc date arithmetic.

## Migration and Compatibility Impact

- Create: `apps/core/migrations/0017_membership_promotions.sql`.
- Existing `subscription_offer.TRIAL` remains historical/legacy with no default authority.
- Existing historical 14-day subscriptions retain their recorded timestamps; they are not rewritten to one month.
- New paid offer uses the existing table with `trial_days=0` solely to satisfy the legacy non-null column. New application code never reads it.
- Add lifecycle metadata, subscription events, promotion grants/redemptions, one-open-subscription enforcement, and one-introductory-trial enforcement.
- Existing `startTrial` compatibility RPC is removed/replaced only when the canonical command is implemented and Web consumer is migrated.

## Task Impact Matrix

| Task | Depends on | Migration impact | Compatibility impact | Unresolved product-decision blocker |
|---|---|---|---|---|
| 1. Calendar arithmetic | Plan 04 runtime baseline | None | Replaces fixed-day calculation; historical timestamps stay untouched | Billing-anchor policy does not block trial end; runtime Temporal absence is a technical approval gate |
| 2. Persistence | Task 1 and Plan 05 migration `0016` | Creates `0017_membership_promotions.sql` | Additive backfill marks historical trials without changing duration; legacy `trial_days` becomes inert | None |
| 3. Promotional trial | Tasks 1–2 | Uses `0017`; no additional migration | Existing `startTrial` consumer migrates to Promotions-authorized command | None |
| 4. Lifecycle/cancellation | Tasks 2–3 | Uses `0017`; no additional migration | Canonical `CANCELED`; scheduled intent replaces immediate period-end state mutation | Default cancellation timing blocks only preselection, so both explicit commands proceed |
| 5. Paid activation/Web | Tasks 2–4 and Plan 05 | Uses `0017`; no additional migration | Provider-shaped start flow is replaced by Payments reaction and canonical account DTO | Dunning and billing anchor block later automation; provider selection does not block canonical reaction; cancellation default blocks UI preselection only |

## Task Acceptance Matrix

| Task | Acceptance criteria |
|---|---|
| 1. Calendar arithmetic | Trial end is one constrained local calendar month later with wall-clock preservation, persisted as UTC, including leap/month-end and DST evidence |
| 2. Persistence | `0017` seeds PHP 299/calendar month, preserves historical trial timestamps, enforces one grant/redemption and one open subscription, and adds no provider references |
| 3. Promotional trial | Only an atomically consumed Promotions grant can enter `TRIALING`; replay returns the same result and no offer `trial_days` read exists |
| 4. Lifecycle/cancellation | Only canonical transitions occur; `CANCELED` and `EXPIRED` have no exits; period-end intent preserves entitlement until the effective-time command |
| 5. Paid activation/Web | Only canonical Payments `SUCCEEDED` activates paid Membership; reactions are replay/CAS safe and Web shows PHP 299 plus exact trial/cancellation timestamps without vendor vocabulary |

## Task 1: Prove calendar-month arithmetic in the Workers runtime

**Files:**
- Create: `apps/core/src/membership/domain/billing-calendar.ts`
- Test: `apps/core/src/membership/domain/billing-calendar.test.ts`

**Interfaces:**
- Consumes: `calculateCalendarMonthEnd(trialStartsAt: string, timeZone: string): string`
- Produces: UTC ISO instant exactly one constrained calendar month after the local zoned start
- Throws: `INVALID_TIMEZONE`, `INVALID_INSTANT`

- [ ] **Step 1: Write failing compatibility and boundary tests**

Use native `Temporal` in the Workers test runtime and assert:

```ts
expect(calculateCalendarMonthEnd("2026-01-31T02:30:00.000Z", "Asia/Manila")).toBe(
  "2026-02-28T02:30:00.000Z",
);
expect(calculateCalendarMonthEnd("2028-01-31T02:30:00.000Z", "Asia/Manila")).toBe(
  "2028-02-29T02:30:00.000Z",
);
expect(calculateCalendarMonthEnd("2026-03-30T16:30:00.000Z", "Asia/Manila")).toBe(
  "2026-04-29T16:30:00.000Z",
);
```

The third case starts at March 31 00:30 Manila and clamps to April 30 00:30 Manila. Add a timezone with DST to prove wall-clock preservation independent of the initial Cebu configuration.

- [ ] **Step 2: Run the test and inspect runtime support**

Run: `pnpm --filter @freshmarkets/core exec vitest run --config vitest.config.ts src/membership/domain/billing-calendar.test.ts`

Expected initial result: FAIL because the utility does not exist. If TypeScript/runtime also reports `Temporal` unavailable after the utility is added, stop and request approval for a named polyfill; do not substitute milliseconds or fixed days.

- [ ] **Step 3: Implement constrained calendar arithmetic**

Convert the UTC instant to `Temporal.ZonedDateTime` in the configured timezone, call `.add({ months: 1 }, { overflow: "constrain" })`, and convert the result back to `Temporal.Instant`. Do not use `86400000`, 14 days, or 30 days.

- [ ] **Step 4: Run focused tests and commit**

Run: `pnpm --filter @freshmarkets/core exec vitest run --config vitest.config.ts src/membership/domain/billing-calendar.test.ts`

Expected: all cases pass.

Run: `git add apps/core/src/membership/domain/billing-calendar.ts apps/core/src/membership/domain/billing-calendar.test.ts && git commit -m "feat(membership): calculate calendar month trial"`

## Task 2: Additive Membership and Promotion persistence

**Files:**
- Create: `apps/core/migrations/0017_membership_promotions.sql`
- Create: `apps/core/src/membership/infrastructure/membership-schema.integration.test.ts`

**Interfaces:**
- Adds `billing_interval` to `subscription_offer`
- Adds to `subscription`: `billing_starts_at`, `current_period_starts_at`, `current_period_ends_at`, `paused_at`, `resume_at`, `cancel_at_period_end`, `cancellation_requested_at`, `scheduled_cancellation_at`, `ended_at`
- Produces: `subscription_event` with application `payment_intent_id` and `promotion_redemption_id`
- Produces: `promotion_grant` and `promotion_redemption`
- Produces: one-open-subscription and one-introductory-trial uniqueness

- [ ] **Step 1: Write preflight duplicate queries**

Run and save results in the test output:

```sql
SELECT customer_id, COUNT(*) count
FROM subscription
WHERE status IN ('PENDING','TRIALING','ACTIVE','PAST_DUE','PAUSED')
GROUP BY customer_id HAVING COUNT(*) > 1;
```

The migration test must fail with a clear fixture report if duplicates exist. Do not silently choose a winner.

- [ ] **Step 2: Write failing schema/seed tests**

Assert the paid default offer has fee `29900`, currency `PHP`, interval `CALENDAR_MONTH`, and legacy `trial_days=0`. Assert `TRIAL` is nondefault/legacy. Assert duplicate open subscriptions and duplicate introductory grants/redemptions fail. Assert provider-reference columns are not added.

- [ ] **Step 3: Run tests and prove failure**

Run: `pnpm --filter @freshmarkets/core exec vitest run --config vitest.config.ts src/membership/infrastructure/membership-schema.integration.test.ts`

Expected: FAIL because migration `0017` and canonical promotion records do not exist.

- [ ] **Step 4: Create the additive migration and historical backfill**

Normalize any historical application state spelling to `CANCELED`, never the reverse. Seed `MEMBERSHIP_MONTHLY` using `INSERT ... ON CONFLICT DO UPDATE` with guarded canonical values rather than `INSERT OR IGNORE`. Create a historical promotion/grant/redemption marker for existing trial subscriptions using their actual stored start/end timestamps; label it `LEGACY_TRIAL_HISTORY` and do not change duration. Future introductory promotion benefit is one `CALENDAR_MONTH`.

- [ ] **Step 5: Run fresh migration tests**

Run: `pnpm --filter @freshmarkets/core exec vitest run --config vitest.config.ts src/membership/infrastructure/membership-schema.integration.test.ts`

Expected: migrations `0001`–`0017` apply and all seed/invariant assertions pass.

- [ ] **Step 6: Commit persistence**

Run: `git add apps/core/migrations/0017_membership_promotions.sql apps/core/src/membership/infrastructure/membership-schema.integration.test.ts && git commit -m "feat(membership): add canonical lifecycle persistence"`

## Task 3: Promotions-owned introductory-trial command

**Files:**
- Create: `apps/core/src/promotions/domain/introductory-trial.ts`
- Create: `apps/core/src/promotions/application/grant-introductory-trial.ts`
- Create: `apps/core/src/membership/application/start-promotional-trial.ts`
- Create: `apps/core/src/membership/infrastructure/d1/membership-repository.ts`
- Test: `apps/core/src/membership/application/start-promotional-trial.integration.test.ts`
- Modify: `packages/contracts/src/membership.ts`
- Modify: `packages/contracts/src/core-service.ts`
- Modify: `apps/core/src/validation.ts`
- Modify: `apps/core/src/index.ts` to delegate

**Interfaces:**
- Consumes: `StartPromotionalTrialCommand { customerId, idempotencyKey, requestId }`
- Produces: `SubscriptionSummary` with state `TRIALING`, exact UTC `trialStartsAt`/`trialEndsAt`, paid offer, promotion redemption ID, version 1
- Guarantees: grant/redemption and subscription/event/idempotency completion occur in one D1 batch
- Errors: `PROMOTION_INELIGIBLE`, `OPEN_SUBSCRIPTION_EXISTS`, `IDEMPOTENCY_CONFLICT`

- [ ] **Step 1: Write failing eligibility/calendar/replay tests**

Cover first eligible trial, second trial for the same customer, existing open subscription, month-end calculation, same-key replay, same-key/different-payload conflict, and concurrent two-key trial attempts. Exactly one attempt may create a redemption/subscription.

Assert merchandise/delivery pricing is unchanged and no payment intent/attempt is fabricated.

- [ ] **Step 2: Run focused tests and prove failure**

Run: `pnpm --filter @freshmarkets/core exec vitest run --config vitest.config.ts src/membership/application/start-promotional-trial.integration.test.ts`

Expected: FAIL because Promotions authority and canonical command do not exist.

- [ ] **Step 3: Implement one atomic grant/redemption/Subscription command**

Resolve customer and Market timezone in Core. Promotions decides eligibility and creates/consumes the grant. Membership calculates the trial end through `calculateCalendarMonthEnd` and creates `TRIALING`. No request accepts offer/trial duration/provider ID from the browser.

- [ ] **Step 4: Implement the canonical RPC and remove compatibility calculation**

Add `subscriptions.startTrial({ idempotencyKey })`. Remove fixed-day arithmetic and reads of `subscription_offer.trial_days` from production source. Add the service to `ImplementedCoreService` only now that the method exists.

- [ ] **Step 5: Run tests, typecheck, and terminology scan**

Run: `pnpm --filter @freshmarkets/core exec vitest run --config vitest.config.ts src/membership/application/start-promotional-trial.integration.test.ts && pnpm typecheck && rg -n "trial_days|86400000|CANCELLED" apps/core/src packages/contracts/src`

Expected: tests/typecheck pass; no production membership match.

- [ ] **Step 6: Commit promotional trial**

Run: `git add apps/core/src/promotions apps/core/src/membership apps/core/src/validation.ts apps/core/src/index.ts packages/contracts/src/membership.ts packages/contracts/src/core-service.ts && git commit -m "feat(membership): start promotion authorized trial"`

## Task 4: Versioned lifecycle and scheduled cancellation

**Files:**
- Create: `apps/core/src/membership/domain/subscription.ts`
- Test: `apps/core/src/membership/domain/subscription.test.ts`
- Create: `apps/core/src/membership/application/change-subscription.ts`
- Create: `apps/core/src/membership/application/apply-scheduled-cancellations.ts`
- Test: `apps/core/src/membership/application/subscription-lifecycle.integration.test.ts`
- Modify: `apps/core/src/membership/infrastructure/d1/membership-repository.ts`
- Modify: `apps/core/src/validation.ts`
- Modify: `packages/contracts/src/membership.ts`
- Modify: `apps/core/src/index.ts`

**Interfaces:**
- Client commands: `PauseSubscription`, `ResumeSubscription`, `CancelSubscription` with expected version and stable idempotency
- Time command: `ApplyScheduledSubscriptionCancellation { subscriptionId, effectiveAt, idempotencyKey }`, version loaded internally and CAS-protected
- Summary fields: `cancelAtPeriodEnd`, `scheduledCancellationAt`, `endedAt`, `version`

- [ ] **Step 1: Write exhaustive failing state tests**

Test every allowed edge in canonical `STATE_MACHINES.md`, representative illegal edges, and zero outgoing transitions from `CANCELED`/`EXPIRED`. Test period-end request leaves state unchanged and eligibility intact until the effective instant; applying one millisecond early fails, at the instant succeeds to `CANCELED`, and replay returns the same result.

- [ ] **Step 2: Run state tests and prove failure**

Run: `pnpm --filter @freshmarkets/core exec vitest run --config vitest.config.ts src/membership/domain/subscription.test.ts src/membership/application/subscription-lifecycle.integration.test.ts`

Expected: FAIL because the canonical state machine/commands do not exist.

- [ ] **Step 3: Implement closed lifecycle commands**

Use conditional `(id, current_state, version)` updates. Immediate cancel transitions to terminal `CANCELED`; period-end cancel sets intent/timestamp only. `ExpireSubscription` is legal only for natural entitlement end with no cancellation intent. Clear scheduled intent only through an explicit resume/reversal policy already represented by a legal command; do not choose a UI default.

- [ ] **Step 4: Add batched time-driven application command**

`applyScheduledCancellations(now, limit)` selects due records and invokes one idempotent command per aggregate. It is callable by reconciliation/manual operations; this plan does not add a new scheduler resource.

- [ ] **Step 5: Run lifecycle tests and commit**

Run: `pnpm --filter @freshmarkets/core exec vitest run --config vitest.config.ts src/membership/domain/subscription.test.ts src/membership/application/subscription-lifecycle.integration.test.ts`

Expected: all tests pass.

Run: `git add apps/core/src/membership apps/core/src/validation.ts apps/core/src/index.ts packages/contracts/src/membership.ts && git commit -m "feat(membership): enforce canonical lifecycle"`

## Task 5: Payments-driven paid activation and account Web surface

**Files:**
- Create: `apps/core/src/membership/application/apply-payment-reaction.ts`
- Test: `apps/core/src/membership/application/apply-payment-reaction.integration.test.ts`
- Modify: `apps/core/src/membership/infrastructure/d1/membership-repository.ts`
- Modify: `apps/core/src/payments/application/ingest-provider-event.ts` only to call the explicit reaction dispatcher
- Modify: `packages/contracts/src/membership.ts`
- Modify: `packages/contracts/src/payments.ts`
- Modify: `packages/contracts/src/core-service.ts`
- Modify: `apps/web/app/account/page.tsx`
- Modify: `apps/web/app/api/commerce/trial/route.ts`
- Create: `apps/web/app/api/membership/route.ts`
- Test: `apps/web/app/api/membership/route.test.ts`

**Interfaces:**
- Consumes internal: `ApplyMembershipPaymentReaction { reactionId, paymentIntentId, subscriptionId, canonicalPaymentState }`
- Produces: idempotent transition `PENDING -> ACTIVE` or `PAST_DUE -> ACTIVE` only when Payments policy says sufficient
- Web exposes paid offer, trial terms, current state, exact timestamps, explicit cancellation choices, and payment action/recovery without vendor state

- [ ] **Step 1: Write failing payment-reaction tests**

Cover `PROCESSING` rejected, `SUCCEEDED` activates once, duplicate reaction returns same result, concurrent cancellation wins CAS and leaves reaction retry/reconciliation required, and provider reference/status never appears in Membership rows or DTOs.

- [ ] **Step 2: Run tests and prove failure**

Run: `pnpm --filter @freshmarkets/core exec vitest run --config vitest.config.ts src/membership/application/apply-payment-reaction.integration.test.ts`

Expected: FAIL because the Membership reaction handler does not exist.

- [ ] **Step 3: Implement internal reaction handling**

Load current subscription/version, validate canonical Payments `SUCCEEDED`, apply legal transition with CAS, write subscription event referencing application payment intent/reaction, and mark reaction applied. On CAS conflict, leave retry/reconciliation state; never invent an expected version from a webhook.

- [ ] **Step 4: Migrate account routes/UI**

Show PHP 299/calendar month and exact one-calendar-month introductory promotion. Do not present a free plan or 14-day copy. Require stable idempotency for start actions and expected version for lifecycle changes. Do not choose the default cancellation timing; present both explicit choices.

- [ ] **Step 5: Run Core/Web tests and commit**

Run: `pnpm --filter @freshmarkets/core exec vitest run --config vitest.config.ts src/membership/application/apply-payment-reaction.integration.test.ts && pnpm --filter @freshmarkets/web exec vitest run --config vitest.config.ts app/api/membership/route.test.ts && pnpm typecheck`

Expected: all commands exit 0.

Run: `git add apps/core/src/membership apps/core/src/payments/application/ingest-provider-event.ts packages/contracts/src apps/web/app/account/page.tsx apps/web/app/api/commerce/trial/route.ts apps/web/app/api/membership && git commit -m "feat(membership): activate from canonical payment"`

## Final Acceptance Gate

- [ ] Run: `pnpm --filter @freshmarkets/core test && pnpm --filter @freshmarkets/web test && pnpm --filter @freshmarkets/contracts test`
- [ ] Run: `pnpm typecheck && pnpm lint && pnpm format:check`
- [ ] Run: `pnpm naming:check && pnpm -r build && pnpm --filter @freshmarkets/web check:vinext`
- [ ] Apply migrations `0001`–`0017` from a fresh database and run trial/open-subscription concurrency tests three times.
- [ ] Run: `rg -n -i "CANCELLED|trial_days|14[- ]day|30[- ]day|provider_customer_ref|provider_subscription_ref|paymentMethodRef" apps/core/src apps/web packages/contracts/src`
- [ ] Confirm no production-domain match; legacy migration/history may remain unchanged.
- [ ] Confirm `git status --short` lists only files declared above.

**Acceptance criteria:** new trials are exactly one calendar month and Promotions-authorized; one customer cannot receive two introductory trials or have multiple open subscriptions; paid activation requires canonical Payments `SUCCEEDED`; terminal/scheduled-cancellation semantics and versions are enforced; provider vocabulary is absent; unresolved renewal/default/anchor policies remain explicit blockers rather than invented behavior.
