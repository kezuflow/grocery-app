# Failed Scheduled Job Runbook

## Identify

1. Open Admin Overview → Scheduled jobs and inspect the run read model for the
   job name, status, error code, affected count, and timestamps.
2. Check Cloudflare Cron Trigger Past Events for failed invocations and the
   structured Worker logs for the job name and error code. A failed observation
   row write also fails the invocation, so the Admin table may be incomplete.
3. Capture the request reference and structured error; do not treat an empty
   queue as evidence that a failed run did not occur.
4. Check whether the job is one of the configured cron lanes in
   `apps/core/wrangler.jsonc` and whether a duplicate execution is safe.

## Recover

1. Correct the external prerequisite or provider condition identified by the
   error without editing business state directly.
2. Allow the next configured cron invocation to retry bounded work. Payment
   redrive and reconciliation remain idempotent and can escalate exhausted
   reactions for operator review.
3. If an approved operator rerun mechanism is available, use that mechanism
   with a new request reference and record the reason. There is no generic
   public job-trigger API.
4. Verify the subsequent run and affected read model in Admin Scheduled jobs.
5. Escalate repeated failures with the job name, error code, UTC timestamps,
   deployment version, and request references; exclude credentials and raw
   provider payloads.
