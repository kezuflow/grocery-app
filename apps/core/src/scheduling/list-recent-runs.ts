import type {
  AdminScheduledJobRunsRequest,
  AdminScheduledJobRunsValue,
  RpcResult,
  ScheduledJobRunView,
} from "@freshmarkets/contracts";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * Purpose-built read model over recent scheduled-job run records for
 * operational visibility. Capability and scope enforcement happen in the
 * entrypoint before this function is reached.
 */
export async function listRecentScheduledJobRuns(
  database: D1Database,
  request: AdminScheduledJobRunsRequest,
): Promise<RpcResult<AdminScheduledJobRunsValue>> {
  const requested = request.limit ?? DEFAULT_LIMIT;
  const limit = Math.min(Math.max(Math.trunc(requested) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const rows = await database
    .prepare(
      "SELECT id, job_name, cron_expression, status, affected_count, error_code, detail, started_at, finished_at FROM scheduled_job_run ORDER BY started_at DESC, rowid DESC LIMIT ?",
    )
    .bind(limit)
    .all<{
      id: string;
      job_name: string;
      cron_expression: string;
      status: string;
      affected_count: number | null;
      error_code: string | null;
      detail: string | null;
      started_at: number;
      finished_at: number;
    }>();
  const runs: ScheduledJobRunView[] = rows.results.map((row) => ({
    id: row.id,
    jobName: row.job_name,
    cronExpression: row.cron_expression,
    status: row.status as ScheduledJobRunView["status"],
    affectedCount: row.affected_count,
    errorCode: row.error_code,
    detail: row.detail,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  }));
  return { ok: true as const, value: { runs }, requestId: request.requestId };
}
