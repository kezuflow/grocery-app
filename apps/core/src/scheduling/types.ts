import type { PaymentProviderRegistry } from "../payments/ports/provider-registry";
import type { EmailDeliveryPort } from "../notifications/infrastructure/email-delivery-port";

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
  readonly registry: PaymentProviderRegistry;
  readonly emailDelivery: EmailDeliveryPort;
  readonly now: number;
}

/** A registered unit of time-driven work delegating to idempotent commands. */
export interface ScheduledJob {
  readonly name: string;
  run(context: ScheduledJobContext): Promise<ScheduledJobOutcome>;
}
