/** Outcome of one scheduled job attempt. */
export interface ScheduledJobOutcome {
  status: "SUCCEEDED" | "FAILED" | "SKIPPED";
  affected?: number;
  errorCode?: string;
  detail?: string;
}

/** Dependencies handed to every scheduled job; no business policy lives here. */
export interface ScheduledJobContext {
  readonly database: D1Database;
  readonly now: number;
}

/** A registered unit of time-driven work delegating to idempotent commands. */
export interface ScheduledJob {
  readonly name: string;
  run(context: ScheduledJobContext): Promise<ScheduledJobOutcome>;
}
