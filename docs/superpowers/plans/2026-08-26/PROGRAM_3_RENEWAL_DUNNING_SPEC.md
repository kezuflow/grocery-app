# Program 3 — Membership Renewal / Trial Conversion / Dunning: Spec & Plan

Status: SELF-REVIEWED (2026-08-26). Implements the D2/D3 rulings already canonical in
`STATE_MACHINES.md` (Subscription section) and `DOMAIN_MODEL.md` (Membership/Promotions), plus the
recorded provider constraint in `PROVIDER_DECISIONS.md` (PayMongo owns failed-recurring retries;
Core owns grace, recovery, expiry, cancellation effects through the scheduler). No new product
decision is introduced; rulings below only resolve implementation shape inside the approved
policy.

## Design

### Payments-owned recurring authorization (migration `0020`)

New `payment_authorization` aggregate (Payments context; Better Auth owns nothing here):

- `id`, `customer_id`, `provider`, `provider_authorization_ref` (UNIQUE with provider),
  `provider_method_ref` (vaulted instrument identity, set at confirmation; UNIQUE per
  `(provider, provider_method_ref)` among non-revoked rows), `recurring_capable` (0/1),
  `status` `PENDING | ACTIVE | REVOKED`, `established_at`, `revoked_at`, timestamps.
- `subscription` gains `payment_authorization_id` (the authorization backing the membership),
  `grace_ends_at` (set when entering `PAST_DUE`), `nominal_billing_day` (1–31 anchor set at
  trial start), and `renewal_initiated_through` (last period-start instant whose renewal intent
  exists; scan bookkeeping, not a safety claim — charge safety rests on the intent idempotency
  key `renewal:{subscriptionId}:{periodStartMs}` and the provider `Idempotency-Key`).
- `payment_provider_method` is left untouched (lower-level inventory; YAGNI for MVP).

Port additions (`ports/payment-provider.ts`, canonical vocabulary only):

- `createAuthorization` — establish a recurring-capable mandate session; returns a client
  action (redirect); never canonical payment success.
- `getAuthorization` — provider lookup returning `recurringCapable`, `providerMethodRef`,
  `status`.

Fake provider implements both with WeakMap test controls (pin authorization outcomes). The
PayMongo adapter returns a typed `PROVIDER_RECURRING_UNAVAILABLE` for both — the documented
external blocker (Card Vaulting/Subscriptions enablement + written setup-without-payment
semantics). Fail-closed, never a fabricated mandate.

Application commands: `beginRecurringAuthorization` (persist `PENDING`, provider call, return
action) and `completeRecurringAuthorization` (provider lookup; only `recurringCapable` +
`ACTIVE` confirms — sets method ref and `established_at`; not-capable confirms as `REVOKED`).

### Trial gate and abuse (D2/D3)

`startPromotionalTrial` additionally requires an existing `ACTIVE`, `recurring-capable`
authorization for the customer (`RECURRING_AUTHORIZATION_REQUIRED` otherwise), links
`subscription.payment_authorization_id`, and sets `nominal_billing_day` from the trial start's
local day-of-month. D3 identity-reuse: refuse the trial when the chosen authorization's
`(provider, provider_method_ref)` already backs another subscription that consumed an
introductory trial. No zero-value payment is ever synthesized; the first paid charge becomes due
at `trialEndsAt`.

### Renewal outcomes (canonical Payments observations only)

`applyMembershipPaymentReaction` routes on the intent `purpose`:

- `MEMBERSHIP_ENROLLMENT`/`MEMBERSHIP_RENEWAL` success from `PENDING`/`TRIALING` converts to
  `ACTIVE` and installs the first paid period `[trialEndsAt, nextAnchorOccurrence)` with
  `billing_starts_at` at conversion.
- `MEMBERSHIP_RENEWAL` success while `ACTIVE` advances the period
  (`current_period_starts_at` = old end; `current_period_ends_at` =
  `nextBillingPeriodEnd(anchorDay, oldEnd, tz)` — the nominal anchor survives short-month
  clamping and re-expands).
- Success while `PAST_DUE` recovers to `ACTIVE`, clears `grace_ends_at`, advances the period.
- Success against a terminal (`CANCELED`/`EXPIRED`) or `PAUSED` subscription escalates the
  reaction (`SUBSCRIPTION_TERMINATED_WITH_PAYMENT` / reconciliation case) — money received must
  never be silently dropped or revive a terminal aggregate.

Failure application is scheduler-driven (no new reaction type; SQLite CHECK stays intact): the
scan applies `RecordMembershipPaymentFailure` only for `MEMBERSHIP_RENEWAL` intents that are
canonically `FAILED` **with at least one `payment_attempt` row** (creation-time operational
failures mark intents `FAILED` without attempts and must never read as payment failures):

- `ACTIVE` at a due boundary → `PAST_DUE`, `grace_ends_at` = failure instant + 7 calendar days
  (market timezone arithmetic).
- `TRIALING` (failed first conversion) → `EXPIRED` per the canonical "uncontinued trial" rule —
  grace protects the paid `ACTIVE` relationship only.

### Renewal initiation (`InitiateMembershipRenewal`, application-owned mode)

One attempt per period, no retries layered on provider-managed retries (D2 +
`PROVIDER_DECISIONS.md`): the scheduler initiates for `TRIALING` with `trial_ends_at <= now`
and `ACTIVE` with `current_period_ends_at <= now` where `renewal_initiated_through` lags the
boundary, charging the persisted offer fee (`subscription_offer.fee_minor`, never a hardcoded
constant) against the subscription's linked authorization. Operational failure (provider
unavailable/unimplemented) records a `RENEWAL_INITIATION_FAILED` subscription event and job
failure without touching lifecycle state. When PayMongo's native subscription mode is confirmed,
initiation moves provider-side additively; this seam exists so the canonical lifecycle is
complete and testable now.

### Grace expiry

`PAST_DUE` with `grace_ends_at <= now` and no open
(`INITIATED`/`REQUIRES_ACTION`/`PROCESSING`) renewal intent applies `ExpireSubscription`
(`PAST_DUE -> EXPIRED`). Cancellation during grace stays the existing immediate-terminal path.

### Eligibility

`getSubscriptionEligibility` admits `PAST_DUE` while `grace_ends_at > now` (exact-instant
check), keeping `TRIALING`/`ACTIVE` semantics unchanged.

### Scheduler

One `membershipRenewalsJob` on the every-minute cron: (1) initiate due renewals, (2) apply
confirmed failures, (3) expire exhausted grace — each step guarded, bounded (limit 25), and
recorded through the existing `scheduled_job_run` telemetry.

### Ingestion routing fix (in-scope correctness)

`ingestProviderEvent`'s inline reaction dispatch currently calls the membership applier for any
pending reaction (including `COMMIT_ORDER`/`COMMIT_AMENDMENT`). It will route by
`reaction_type` and inline-dispatch only membership reactions; order/amendment reactions remain
the redrive job's responsibility.

## Plan

- Slice 1: migration `0020` + billing-calendar helpers (`nextBillingPeriodEnd`,
  `calendarDayOfMonth`, `addCalendarDays`) with unit tests.
- Slice 2: port additions + fake authorization support + PayMongo fail-closed stubs +
  `beginRecurringAuthorization`/`completeRecurringAuthorization` + tests.
- Slice 3: trial gate + D3 identity-reuse + anchor/link persistence + `PAST_DUE`-grace
  eligibility + tests.
- Slice 4: reaction applier purpose-routing (conversion/renewal/recovery/escalation) + ingest
  reaction-type routing fix + tests.
- Slice 5: `initiateMembershipRenewal` + failure application + grace expiry + scheduler job +
  registry wiring + integration tests.
- Slice 6: contracts + entrypoint RPC + Web enrollment flow (begin → redirect → complete →
  trial) + canonical doc updates (`DATA_MODEL.md`, `API_CONTRACTS.md`) + full verification +
  ledger/status closeout.

## External blockers (not code defects)

PayMongo Subscriptions + Card Vaulting enablement, written Maya/setup-without-payment semantics,
live keys, webhook registration (recorded in `PROVIDER_DECISIONS.md`). Until confirmed, the real
adapter fails closed with `PROVIDER_RECURRING_UNAVAILABLE`; the fake provider proves the full
canonical lifecycle in tests.

## Recorded rulings

1. Failed first conversion at `trialEndsAt` follows the canonical "uncontinued trial" rule
   (`TRIALING -> EXPIRED`); the 7-day grace exists only from `ACTIVE` (state machine is
   authoritative).
2. Renewal failures are applied by a scheduler scan over canonical `FAILED` intents with
   attempt evidence, not by a new reaction type (avoids a CHECK-constraint table rebuild;
   provider events remain the only failure source).
3. `renewal_initiated_through` is scan bookkeeping; charge dedupe rests on payment-intent
   idempotency + provider `Idempotency-Key` (overlap-safe by construction).
4. Application-owned initiation is single-attempt-per-period; no `+1/+3/+6` retries are built
   (PayMongo owns retries per `PROVIDER_DECISIONS.md`; the D2 fallback activates only if that
   proves false).
5. Money received against a terminal/paused subscription escalates visibly instead of being
   applied or dropped.
