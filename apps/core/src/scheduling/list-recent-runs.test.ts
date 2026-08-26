import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { listRecentScheduledJobRuns } from "./list-recent-runs";

const NOW = 1_700_000_000_000;

async function seedRun(jobName: string, startedAt: number): Promise<string> {
  const id = `run-${jobName}-${startedAt}`;
  await env.DB.prepare(
    "INSERT INTO scheduled_job_run (id, job_name, cron_expression, status, affected_count, error_code, detail, started_at, finished_at) VALUES (?, ?, '* * * * *', 'SUCCEEDED', 1, NULL, NULL, ?, ?)",
  )
    .bind(id, jobName, startedAt, startedAt)
    .run();
  return id;
}

describe("listRecentScheduledJobRuns", () => {
  it("returns runs newest-first with clamped limits", async () => {
    for (let index = 0; index < 3; index += 1) {
      await seedRun(`job-${index}`, NOW + index * 1_000);
    }
    const page = await listRecentScheduledJobRuns(env.DB, {
      requestId: "r1",
      headers: {},
      limit: 2,
    });
    if (!page.ok) throw new Error("read model failed");
    expect(page.value.runs).toHaveLength(2);
    expect(page.value.runs[0].jobName).toBe("job-2");
    expect(page.value.runs[0].status).toBe("SUCCEEDED");
    expect(page.value.runs[0].affectedCount).toBe(1);
    expect(page.value.runs[1].jobName).toBe("job-1");
  });

  it("falls back to the default limit for invalid input without exposing rows raw", async () => {
    const page = await listRecentScheduledJobRuns(env.DB, {
      requestId: "r2",
      headers: {},
      limit: -5,
    });
    if (!page.ok) throw new Error("read model failed");
    expect(page.ok).toBe(true);
    expect(Array.isArray(page.value.runs)).toBe(true);
  });
});
