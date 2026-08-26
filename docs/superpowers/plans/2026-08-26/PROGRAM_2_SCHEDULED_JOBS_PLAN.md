# Program 2 — Scheduled Jobs & Reconciliation: Implementation Plan

Status: SELF-REVIEWED PLAN (2026-08-26). Spec: `PROGRAM_2_SCHEDULED_JOBS_SPEC.md`. Trunk-based
execution per `TRUNK.md`: every slice is RED-tested where applicable, verified fresh,
self-reviewed, committed coherently to `main`, pushed immediately, and recorded in
`PROGRESS_LEDGER.md`.

## Global slice rules

- Tests first (RED) for every new behavior; vitest-pool-workers D1 harness applies migrations
  fresh per test (`apps/core/src/test-setup.ts`); integration tests are colocated as
  `*.integration.test.ts`.
- Injected clock everywhere; no `Date.now()` in module code paths under test.
- Migration `0019` is owned by this program and must apply from zero.
- Per-slice gates: targeted tests, `pnpm naming:check`, `pnpm typecheck`, `pnpm lint`,
  `pnpm format:check` on changed files, `git diff --check`; `pnpm -r build` when contracts change;
  final full `pnpm check` at program completion.

## Slice 1 — Scheduler foundation + fairness jobs

Files: migration `0019_scheduled_job_runs.sql`; new `apps/core/src/scheduling/{types.ts,
job-registry.ts,run-scheduled-jobs.ts,jobs/checkout-hold-expiry.ts,jobs/membership-scheduled-cancellations.ts}`
plus integration tests; `CoreEntrypoint.scheduled()` wiring; `apps/core/wrangler.jsonc` triggers.

1. RED: scheduling integration test proves registry dispatch by cron expression, run-row
   persistence (SUCCEEDED/FAILED/SKIPPED), failure isolation, repeat-fire zero-effect, overlapping
   invocations consistency.
2. GREEN: implement types/registry/orchestrator; wire the two existing commands as the first
   registered jobs; add `scheduled()` delegation and wrangler crons.
3. Verify: targeted tests + per-slice gates; commit `feat(scheduling): add cron job registry...`;
   push; ledger row.

## Slice 2 — Cycle cutoff and guarded closeout

Files: `apps/core/src/commerce/application/reach-due-cycle-cutoff.ts`,
`close-completed-delivery-cycles.ts`, integration tests; register both jobs.

1. RED: seed cycles via SQL fixtures (OPEN past cutoff; OPEN future cutoff; CUTOFF_REACHED past
   window with terminal delivery work; same with open work). Prove claim exactly-once, guarded
   skip reasons, legal transition chain only.
2. GREEN: implement both guarded conditional-update commands against actual `delivery_cycle`
   columns discovered from `0005`/`0009` migrations; register jobs.
3. Verify/gates/commit/push/ledger as Slice 1.

## Slice 3 — Payments redrive

Files: `apps/core/src/payments/application/redrive-payment-reactions.ts`,
`payments-reconciliation-redrive` job module, integration tests; register both jobs.

1. RED: seed PENDING reactions due/not-due/exhausted; prove routing by reaction_type to existing
   appliers, attempt bound, ESCALATED visibility, stable reconciliation idempotency keys,
   not-due rows untouched.
2. GREEN: implement selectors + escalation update + reconciliation sweep invoking
   `reconcilePayment` with `system:scheduler` actor.
3. Verify/gates/commit/push/ledger as Slice 1.

## Slice 4 — Observability surface + completion

Files: contracts `operations.ts` (+ `core-service.ts` composition), Core read method, Web BFF
`/api/admin/jobs`, docs (`IMPLEMENTATION_STATUS.md` remediation-neutral note), ledger final row.

1. RED: contract-level test for DTO shape; Core authorization test (capability required);
   BFF smoke via existing route-test pattern.
2. GREEN: implement minimal purpose-built read model (recent runs, limit-bounded).
3. Full program verification: `pnpm check`, `pnpm -r build`, `check:vinext`, migration-from-zero
   re-run, high-risk reruns (checkout/inventory/capacity suites untouched-green). Whole-feature
   self-review against spec acceptance boundary; fix findings; final commit/push; ledger closure.

## Acceptance checklist (from spec)

- [ ] `scheduled()` contains zero business policy
- [ ] Every job invokes an existing-or-minimal idempotent command with normal semantics
- [ ] Duplicate/overlapping cron fires safe (tests)
- [ ] Failure isolation observable via run rows (tests)
- [ ] Hold expiry, cutoff, closeout guards, scheduled cancellation execute from harness
- [ ] Reaction/redrive bounds + escalation visible
- [ ] Admin recent-runs read model capability-gated
- [ ] `0019` applies from zero; all gates green; ledger closed out
