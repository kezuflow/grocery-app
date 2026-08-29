import type { ProviderRegistry } from "../payments/infrastructure/providers/provider-registry";

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
  /** Configured provider adapters for jobs that must observe provider truth. */
  readonly registry: ProviderRegistry;
  /** Explicit ownership gate; false still permits confirmed-outcome/grace reconciliation. */
  readonly renewalInitiationEnabled: boolean;
  readonly now: number;
}

/** A registered unit of time-driven work delegating to idempotent commands. */
export interface ScheduledJob {
  readonly name: string;
  run(context: ScheduledJobContext): Promise<ScheduledJobOutcome>;
}
