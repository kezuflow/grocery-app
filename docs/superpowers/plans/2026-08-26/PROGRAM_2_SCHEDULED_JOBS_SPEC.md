# Program 2 — Scheduled Jobs & Reconciliation: Design Specification

Status: SELF-REVIEWED SPEC (2026-08-26). Implements the D4 ruling and the `ARCHITECTURE.md`
"Cron Triggers" section. It introduces no new product decision: every invoked behavior either
already exists as an idempotent command or is a minimal canonical `STATE_MACHINES.md` transition
that had no writer yet. Open items that WOULD be new decisions are explicitly excluded below.

## Goal

One Cloudflare Worker `scheduled()` entrypoint that dispatches through an explicit job registry to
idempotent Core commands so that time-driven work (hold expiry, cycle cutoff/advancement,
scheduled membership cancellation, payment-reaction redrive, provider reconciliation) executes
without any interactive request triggering it. Cron owns no domain state and contains no business
policy.

## Design

### Entrypoint and registry

- `CoreEntrypoint` gains `async scheduled(controller, env, ctx)`. It contains zero branching
  beyond delegating: `await runScheduledJobs(env, controller.cron)`.
- New module `apps/core/src/scheduling/`:
  - `types.ts` — `ScheduledJobContext { db: D1Database; env: Env; now: number }`,
    `ScheduledJobOutcome { status: "SUCCEEDED" | "FAILED" | "SKIPPED"; affected?: number;
    errorCode?: string; detail?: string }`, `ScheduledJob { name; run(ctx): Promise<ScheduledJobOutcome> }`.
  - `job-registry.ts` — static map from cron expression to ordered job list. Adding Programs 3/6
    jobs later means adding entries plus their modules; nothing else changes.
  - `run-scheduled-jobs.ts` — for each job registered for the fired cron expression: execute,
    isolate failures (one failing job never prevents the others), and persist one
    `scheduled_job_run` row per finished attempt. The orchestrator itself never throws after
    recording.
- `apps/core/wrangler.jsonc` adds `"triggers": { "crons": ["* * * * *", "*/15 * * * *"] }`.
  - Every minute: time-critical fairness jobs.
  - Every 15 minutes: provider-facing sweeps (reaction redrive, reconciliation) to bound
    provider call rate.

### Jobs (initial set)

| Job name | Cadence | Invokes |
|---|---|---|
| `checkout.hold-expiry` | `* * * * *` | existing `expireCheckoutAttempts(db, now)` |
| `membership.scheduled-cancellations` | `* * * * *` | existing `applyScheduledCancellations(db, now, limit)` |
| `commerce.cycle-cutoff` | `* * * * *` | NEW guarded cycle transition (below) |
| `commerce.cycle-closeout` | `*/15 * * * *` | NEW guarded closeout transition (below) |
| `payments.reaction-redrive` | `*/15 * * * *` | NEW redrive over due `PENDING` reactions |
| `payments.reconciliation-redrive` | `*/15 * * * *` | existing `reconcilePayment` over stuck items |

### New canonical cycle transitions (minimal writers)

`STATE_MACHINES.md` defines the DeliveryCycle machine; today nothing writes its status. Two
guarded, idempotent command functions are added under `apps/core/src/commerce/application/`:

- `reachDueCycleCutoff(db, now)`: conditional update `OPEN -> CUTOFF_REACHED` where
  `cutoff_at <= now`. Exactly-once by construction (conditional update claims the row).
- `closeCompletedDeliveryCycles(db, now)`: advances a cycle toward `CLOSED` ONLY when its
  delivery window has passed AND no non-terminal fulfillment/delivery work remains for it
  (query-guarded legal transition chain applied stepwise). Any unmet guard yields `SKIPPED`
  with a reason; cycles are never force-closed through operational states.

Ruling recorded (autonomy policy item 4): automatic closeout is guarded-by-completion rather
than purely time-based because advancing through procurement/receiving/packing without received
supply would fabricate operational progress. Cost if wrong: closeout waits for an operator
instead of self-closing; recoverable by running the job again once guards pass.

### Payment redrive

- `payments.reaction-redrive`: selects `PENDING` `payment_reaction` rows with
  `available_at <= now` and `attempts < MAX` (constant 5), routes by `reaction_type` to the
  existing reaction appliers (membership activation/recovery, order/amendment commitment),
  bounded per run. Rows exceeding `MAX` attempts are moved `PENDING -> ESCALATED` (legal per the
  `0016` check constraint) so finance exceptions stay visible instead of retrying forever.
- `payments.reconciliation-redrive`: finds payments/inbox entries stuck in retryable states past
  a threshold and invokes the existing `reconcilePayment` with actor
  `system:scheduler` and deterministic idempotency keys
  (`reconcile:<paymentIntentId>:<attempt>`), preserving its normal CAS/retry semantics.

Exact selector predicates follow existing repository columns discovered at implementation time;
selectors are read-only filters, not business policy changes.

### Persistence (migration `0019_scheduled_job_runs.sql`)

```sql
CREATE TABLE IF NOT EXISTS scheduled_job_run (
  id TEXT PRIMARY KEY,
  job_name TEXT NOT NULL,
  cron_expression TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('SUCCEEDED','FAILED','SKIPPED')),
  affected_count INTEGER,
  error_code TEXT,
  started_at INTEGER NOT NULL,
  finished_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS scheduled_job_run_recent_idx ON scheduled_job_run(started_at DESC);
```

Append-only observation records (insert-one/update-none per row by a single writer); no CAS
transitions occur on them, so the aggregate `version` invariant for mutable aggregates does not
apply. Timestamps are UTC epoch milliseconds per repository convention.

### Safety properties

- Repeat fire safe: every job bottoms out in idempotent/conditional writes; a second run observes
  no eligible work and records `SUCCEEDED` with `affected: 0`.
- Overlap safe: concurrent invocations interleave only at idempotent command boundaries
  (conditional updates, CAS, unique idempotency keys); worst case is duplicate `SKIPPED` runs.
- Failure isolation: per-job try/catch; `FAILED` rows carry `error_code`; the scheduler never
  throws outward.
- Time semantics: all comparisons use stored UTC instants against the injected clock; calendar/
  timezone arithmetic remains owned by domain modules (none needed by these selectors).
- No secrets, no provider payloads in logs or run rows; `detail` carries counts/reasons only.

### Observability surface

Contracts gain a small purpose-built read DTO (`operations.ts`):
`admin.jobs.listRecentRuns({ limit? }) -> RpcResult<ScheduledJobRunPage>` exposed through
`ImplementedCoreService`, a scoped Core method, and a Web BFF route `/api/admin/jobs` gated by
the existing operational-read capability, following the `/api/admin/delivery` pattern. Raw rows
are never exposed publicly.

## Excluded from this program (recorded boundaries)

- Renewal/dunning tick jobs (Program 3) and notification send jobs (Program 6): registry
  extension points only; their bodies arrive with those programs.
- Live cycle administration UI (Plan 08R scope where applicable).
- Queue-based dispatch (inline execution only; `ARCHITECTURE.md` Queues remain optional).

## Verification boundary

Worker-local cron harness tests prove: registry-to-cron mapping; repeat-fire safety; overlapping
invocations; failure isolation with `FAILED` rows; cutoff claim exactly-once; guarded closeout
skips incomplete cycles; reaction redrive honors `available_at`/attempt bounds/escalation;
reconciliation redrive keys are stable; fresh-migration-from-zero applies `0019`. Full gates:
`pnpm check`, `pnpm -r build`, `check:vinext` unchanged-green.
