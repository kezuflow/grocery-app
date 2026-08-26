import { log } from "../observability";
import { ProviderRegistry } from "../payments/infrastructure/providers/provider-registry";
import { getJobsForCron } from "./job-registry";
import type { ScheduledJob, ScheduledJobOutcome } from "./types";

const MAX_DETAIL_LENGTH = 200;

function errorDetail(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, MAX_DETAIL_LENGTH);
}

async function recordJobRun(
  database: D1Database,
  jobName: string,
  cronExpression: string,
  startedAt: number,
  outcome: ScheduledJobOutcome,
): Promise<void> {
  try {
    await database
      .prepare(
        "INSERT INTO scheduled_job_run (id, job_name, cron_expression, status, affected_count, error_code, detail, started_at, finished_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        crypto.randomUUID(),
        jobName,
        cronExpression,
        outcome.status,
        outcome.affected ?? null,
        outcome.errorCode ?? null,
        outcome.detail ?? null,
        startedAt,
        startedAt,
      )
      .run();
  } catch (error) {
    // Observability must never mask the job's own outcome.
    log("error", "scheduling.job_run.record_failed", {
      job: jobName,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Executes the given jobs sequentially, isolating failures per job and
 * persisting one observation row per finished attempt. Safe to run repeatedly
 * and concurrently: every registered job bottoms out in idempotent commands.
 */
export async function runRegisteredJobs(
  database: D1Database,
  cronExpression: string,
  now: number,
  jobs: readonly ScheduledJob[] = getJobsForCron(cronExpression),
  registry?: ProviderRegistry,
): Promise<ScheduledJobOutcome[]> {
  const providerRegistry = registry ?? new ProviderRegistry("development");
  const outcomes: ScheduledJobOutcome[] = [];
  for (const job of jobs) {
    let outcome: ScheduledJobOutcome;
    try {
      outcome = await job.run({ database, now, registry: providerRegistry });
    } catch (error) {
      outcome = { status: "FAILED", errorCode: "SCHEDULED_JOB_ERROR", detail: errorDetail(error) };
    }
    await recordJobRun(database, job.name, cronExpression, now, outcome);
    outcomes.push(outcome);
  }
  return outcomes;
}

/** Entrypoint-facing wrapper resolving the registry for a fired cron expression. */
export async function runScheduledJobs(
  env: { DB: D1Database; ENVIRONMENT?: string },
  cronExpression: string,
  now: number,
): Promise<ScheduledJobOutcome[]> {
  return runRegisteredJobs(
    env.DB,
    cronExpression,
    now,
    undefined,
    new ProviderRegistry(env.ENVIRONMENT ?? "development"),
  );
}
