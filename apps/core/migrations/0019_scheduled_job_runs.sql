-- Program 2 Slice 1: scheduled job run records.
-- Append-only observation rows written by the scheduling orchestrator; no
-- aggregate state transitions occur on this table, so records are never
-- claimed, replayed, or versioned.

CREATE TABLE IF NOT EXISTS scheduled_job_run (
    id TEXT PRIMARY KEY,
    job_name TEXT NOT NULL,
    cron_expression TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('SUCCEEDED', 'FAILED', 'SKIPPED')),
    affected_count INTEGER,
    error_code TEXT,
    detail TEXT,
    started_at INTEGER NOT NULL,
    finished_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS scheduled_job_run_recent_idx
    ON scheduled_job_run(started_at DESC);
