import {
  buildDeliveryProviderRegistry,
  type RuntimeDeliveryProviderEnvironment,
} from "../delivery/infrastructure/runtime-delivery-provider";
import { log } from "../observability";
import { buildProviderRegistry } from "../payments/infrastructure/providers/runtime-providers";
import {
  coreRuntimeConfiguration,
  type CoreRuntimeEnvironment,
} from "../runtime/runtime-configuration";
import type { PaymentProviderRegistry } from "../payments/ports/provider-registry";
import { getJobsForCron } from "./job-registry";
import type { ScheduledJob, ScheduledJobOutcome } from "./types";
import {
  createCloudflareEmailDeliveryPort,
  disabledEmailDeliveryPort,
  type EmailDeliveryEnvironment,
  type EmailDeliveryPort,
} from "../notifications/infrastructure/email-delivery-port";
import type { NotificationQueueProducer } from "../notifications/application/notification-queue";

async function recordJobRun(
  database: D1Database,
  jobName: string,
  cronExpression: string,
  startedAt: number,
  finishedAt: number,
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
        outcome.status === "FAILED" ? null : (outcome.detail ?? null),
        startedAt,
        finishedAt,
      )
      .run();
  } catch {
    // Observability must never mask the job's own outcome.
    log("error", "scheduling.job_run.record_failed", {
      job: jobName,
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
  registry: PaymentProviderRegistry = buildProviderRegistry({
    ENVIRONMENT: "development",
    PAYMENT_PROVIDER: "disabled",
  }),
  emailDelivery: EmailDeliveryPort = disabledEmailDeliveryPort,
  notificationQueue?: NotificationQueueProducer,
  applicationOrigin?: string,
  productMedia?: R2Bucket,
  deliveryProviders?: import("./types").ScheduledJobContext["deliveryProviders"],
  clock: () => number = Date.now,
): Promise<ScheduledJobOutcome[]> {
  const outcomes: ScheduledJobOutcome[] = [];
  for (const job of jobs) {
    const startedAt = clock();
    let outcome: ScheduledJobOutcome;
    try {
      outcome = await job.run({
        database,
        now,
        registry,
        emailDelivery,
        notificationQueue,
        applicationOrigin,
        productMedia,
        deliveryProviders,
      });
    } catch {
      outcome = { status: "FAILED", errorCode: "SCHEDULED_JOB_ERROR" };
    }
    const finishedAt = Math.max(startedAt, clock());
    await recordJobRun(database, job.name, cronExpression, startedAt, finishedAt, outcome);
    outcomes.push(outcome);
  }
  return outcomes;
}

/** Entrypoint-facing wrapper resolving the registry for a fired cron expression. */
export async function runScheduledJobs(
  env: CoreRuntimeEnvironment &
    RuntimeDeliveryProviderEnvironment &
    EmailDeliveryEnvironment & {
      DB: D1Database;
      NOTIFICATION_QUEUE?: NotificationQueueProducer;
      PRODUCT_MEDIA?: R2Bucket;
    },
  cronExpression: string,
  now: number,
): Promise<ScheduledJobOutcome[]> {
  const runtime = coreRuntimeConfiguration(env);
  return runRegisteredJobs(
    env.DB,
    cronExpression,
    now,
    undefined,
    buildProviderRegistry(runtime),
    createCloudflareEmailDeliveryPort(env),
    env.NOTIFICATION_QUEUE,
    runtime.auth.baseUrl,
    env.PRODUCT_MEDIA,
    () => buildDeliveryProviderRegistry(env),
  );
}
