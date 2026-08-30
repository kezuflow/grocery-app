import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { startPromotionalTrial } from "../membership/application/start-promotional-trial";
import { SCHEDULED_CRON_EXPRESSIONS, getJobsForCron } from "./job-registry";
import { runRegisteredJobs, runScheduledJobs } from "./run-scheduled-jobs";
import { providerActionExpiryJob } from "./jobs/provider-action-expiry";
import type { ScheduledJob, ScheduledJobOutcome } from "./types";

const NOW = 1_700_000_000_000;

let customerCounter = 0;

async function seedDueScheduledCancellation(now: number): Promise<string> {
  const customerId = `cust-sched-${++customerCounter}-${crypto.randomUUID().slice(0, 8)}`;
  await env.DB.prepare(
    "INSERT INTO customer (id, auth_user_id, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
  )
    .bind(customerId, `auth-${customerId}`, now, now)
    .run();
  await env.DB.prepare(
    "INSERT INTO payment_authorization (id, customer_id, provider, provider_authorization_ref, provider_method_ref, recurring_capable, status, established_at, created_at, updated_at) VALUES (?, ?, 'mock', ?, ?, 1, 'ACTIVE', ?, ?, ?)",
  )
    .bind(
      `authz-${customerId}`,
      customerId,
      `mock_auth_${customerId}`,
      `mock_method_${customerId}`,
      now,
      now,
      now,
    )
    .run();
  const trial = await startPromotionalTrial(env.DB, {
    customerId,
    idempotencyKey: `trial-${crypto.randomUUID()}`,
    requestId: crypto.randomUUID(),
  });
  if (!trial.ok) throw new Error(`fixture failed: ${trial.error.message}`);
  await env.DB.prepare(
    "UPDATE subscription SET cancel_at_period_end=1, scheduled_cancellation_at=? WHERE id=?",
  )
    .bind(now - 1_000, trial.value.subscriptionId)
    .run();
  return trial.value.subscriptionId;
}

function stubJob(name: string, outcome: ScheduledJobOutcome | Error): ScheduledJob {
  return {
    name,
    async run() {
      if (outcome instanceof Error) throw outcome;
      return outcome;
    },
  };
}

async function runRows(jobNamePrefix?: string): Promise<
  Array<{
    job_name: string;
    status: string;
    affected_count: number | null;
    error_code: string | null;
  }>
> {
  const result = jobNamePrefix
    ? await env.DB.prepare(
        "SELECT job_name, status, affected_count, error_code FROM scheduled_job_run WHERE job_name LIKE ? ORDER BY rowid ASC",
      )
        .bind(`${jobNamePrefix}%`)
        .all<{
          job_name: string;
          status: string;
          affected_count: number | null;
          error_code: string | null;
        }>()
    : await env.DB.prepare(
        "SELECT job_name, status, affected_count, error_code FROM scheduled_job_run ORDER BY rowid ASC",
      ).all<{
        job_name: string;
        status: string;
        affected_count: number | null;
        error_code: string | null;
      }>();
  return result.results;
}

describe("scheduled job registry", () => {
  it("registers fairness jobs every minute and matches wrangler cron triggers", () => {
    expect([...SCHEDULED_CRON_EXPRESSIONS].sort()).toEqual(["* * * * *", "*/15 * * * *"].sort());
    const everyMinute = getJobsForCron("* * * * *").map((job) => job.name);
    expect(everyMinute).toContain("checkout.hold-expiry");
    expect(everyMinute).toContain("notifications.delivery");
    expect(everyMinute).toContain("membership.scheduled-cancellations");
    expect(everyMinute).toContain("payments.provider-action-expiry");
    expect(everyMinute).toContain("commerce.cycle-cutoff");
    const quarterHour = getJobsForCron("*/15 * * * *").map((job) => job.name);
    expect(quarterHour).toContain("commerce.cycle-closeout");
    expect(quarterHour).toContain("payments.provider-inbox-redrive");
  });

  it("returns no jobs and records nothing for an unregistered cron expression", async () => {
    const outcomes = await runScheduledJobs(env, "0 0 30 2 *", NOW);
    expect(outcomes).toEqual([]);
    expect(await runRows()).toEqual([]);
  });
});

describe("runRegisteredJobs", () => {
  it("records SUCCEEDED and SKIPPED observation rows with outcomes", async () => {
    const outcomes = await runRegisteredJobs(env.DB, "* * * * *", NOW, [
      stubJob("rec.ok", { status: "SUCCEEDED", affected: 2, detail: "two effects" }),
      stubJob("rec.skipped", { status: "SKIPPED", detail: "guards unmet" }),
    ]);
    expect(outcomes.map((outcome) => outcome.status)).toEqual(["SUCCEEDED", "SKIPPED"]);
    const rows = await runRows("rec.");
    expect(rows[0]).toMatchObject({
      job_name: "rec.ok",
      status: "SUCCEEDED",
      affected_count: 2,
      error_code: null,
    });
    expect(rows[1]).toMatchObject({ job_name: "rec.skipped", status: "SKIPPED" });
  });

  it("isolates job failures while later jobs still execute", async () => {
    const outcomes = await runRegisteredJobs(env.DB, "* * * * *", NOW, [
      stubJob("iso.boom", new Error("simulated command failure")),
      stubJob("iso.after", { status: "SUCCEEDED", affected: 1 }),
    ]);
    expect(outcomes.map((outcome) => outcome.status)).toEqual(["FAILED", "SUCCEEDED"]);
    const rows = await runRows("iso.");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      job_name: "iso.boom",
      status: "FAILED",
      error_code: "SCHEDULED_JOB_ERROR",
    });
    expect(rows[0].affected_count).toBeNull();
    expect(rows[1]).toMatchObject({ job_name: "iso.after", status: "SUCCEEDED" });
  });

  it("applies due scheduled cancellations exactly once across repeated fires", async () => {
    const subscriptionId = await seedDueScheduledCancellation(NOW);
    const first = await runScheduledJobs(env, "* * * * *", NOW);
    const second = await runScheduledJobs(env, "* * * * *", NOW);
    const cancellationOutcomes = (runs: ScheduledJobOutcome[]) =>
      runs.filter(
        (_, index) =>
          getJobsForCron("* * * * *")[index]?.name === "membership.scheduled-cancellations",
      );
    const firstAffected = cancellationOutcomes(first).reduce(
      (total, outcome) => total + (outcome.affected ?? 0),
      0,
    );
    const secondAffected = cancellationOutcomes(second).reduce(
      (total, outcome) => total + (outcome.affected ?? 0),
      0,
    );
    expect(firstAffected).toBe(1);
    expect(secondAffected).toBe(0);
    const subscription = await env.DB.prepare("SELECT status FROM subscription WHERE id=?")
      .bind(subscriptionId)
      .first<{ status: string }>();
    expect(subscription?.status).toBe("CANCELED");
  });

  it("keeps overlapping invocations consistent without double-applying", async () => {
    await seedDueScheduledCancellation(NOW);
    const [first, second] = await Promise.all([
      runScheduledJobs(env, "* * * * *", NOW),
      runScheduledJobs(env, "* * * * *", NOW),
    ]);
    const appliedByMembershipJob = (runs: ScheduledJobOutcome[], offset: number) =>
      runs.reduce(
        (total, outcome, index) =>
          getJobsForCron("* * * * *")[index]?.name === "membership.scheduled-cancellations"
            ? total + (outcome.affected ?? 0)
            : total,
        offset,
      );
    expect(appliedByMembershipJob(first, 0) + appliedByMembershipJob(second, 0)).toBe(1);
  });

  it("expires due provider actions through the scheduler and leaves future actions active", async () => {
    const customerId = `cust-action-expiry-${crypto.randomUUID()}`;
    const authorizationId = `authz-action-expiry-${crypto.randomUUID()}`;
    const futureAuthorizationId = `authz-future-action-${crypto.randomUUID()}`;
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO customer (id, auth_user_id, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
      ).bind(customerId, `auth-${customerId}`, NOW, NOW),
      env.DB.prepare(
        "INSERT INTO payment_authorization (id, customer_id, provider, provider_authorization_ref, provider_method_ref, recurring_capable, status, established_at, created_at, updated_at) VALUES (?, ?, 'mock', ?, ?, 1, 'ACTIVE', ?, ?, ?)",
      ).bind(
        authorizationId,
        customerId,
        `mock-auth-${customerId}`,
        `mock-method-${customerId}`,
        NOW,
        NOW,
        NOW,
      ),
      env.DB.prepare(
        "INSERT INTO payment_authorization (id, customer_id, provider, provider_authorization_ref, provider_method_ref, recurring_capable, status, established_at, created_at, updated_at) VALUES (?, ?, 'mock', ?, ?, 1, 'ACTIVE', ?, ?, ?)",
      ).bind(
        futureAuthorizationId,
        customerId,
        `mock-auth-${futureAuthorizationId}`,
        `mock-method-${futureAuthorizationId}`,
        NOW,
        NOW,
        NOW,
      ),
      env.DB.prepare(
        "INSERT INTO payment_provider_action (id, payment_intent_id, authorization_id, provider, provider_reference, action_type, redirect_url, client_token, expires_at, status, created_at, updated_at) VALUES (?, NULL, ?, 'mock', ?, 'REDIRECT', ?, NULL, ?, 'ACTIVE', ?, ?)",
      ).bind(
        `expired-action-${customerId}`,
        authorizationId,
        `expired-reference-${customerId}`,
        "https://pay.example/expired",
        NOW - 1,
        NOW - 10_000,
        NOW - 10_000,
      ),
      env.DB.prepare(
        "INSERT INTO payment_provider_action (id, payment_intent_id, authorization_id, provider, provider_reference, action_type, redirect_url, client_token, expires_at, status, created_at, updated_at) VALUES (?, NULL, ?, 'mock', ?, 'REDIRECT', ?, NULL, ?, 'ACTIVE', ?, ?)",
      ).bind(
        `future-action-${customerId}`,
        futureAuthorizationId,
        `future-reference-${customerId}`,
        "https://pay.example/future",
        NOW + 60_000,
        NOW,
        NOW,
      ),
    ]);

    const [outcome] = await runRegisteredJobs(env.DB, "* * * * *", NOW, [providerActionExpiryJob]);
    expect(outcome).toMatchObject({ status: "SUCCEEDED", affected: 1 });
    const actions = await env.DB.prepare(
      "SELECT provider_reference, status FROM payment_provider_action WHERE authorization_id IN (?, ?) ORDER BY provider_reference",
    )
      .bind(authorizationId, futureAuthorizationId)
      .all<{ provider_reference: string; status: string }>();
    expect(actions.results).toEqual([
      { provider_reference: `expired-reference-${customerId}`, status: "EXPIRED" },
      { provider_reference: `future-reference-${customerId}`, status: "ACTIVE" },
    ]);
  });
});
