import { log } from "../../observability";

export type DeliveryProviderOperation =
  | "GRAB_EXPRESS_QUOTE"
  | "GRAB_EXPRESS_CREATE"
  | "GRAB_EXPRESS_GET"
  | "GRAB_EXPRESS_CANCEL";

export type DeliveryProviderTelemetryEvent = Readonly<{
  operation: DeliveryProviderOperation;
  result: "SUCCESS" | "FAILURE";
  durationMilliseconds: number;
  errorCode?: string;
  providerRequestId?: string;
}>;

export type DeliveryProviderTelemetry = Readonly<{
  clock: () => number;
  sink: (event: DeliveryProviderTelemetryEvent) => void;
}>;

export const defaultDeliveryProviderTelemetry: DeliveryProviderTelemetry = {
  clock: () => performance.now(),
  sink: (event) => log(event.result === "SUCCESS" ? "info" : "warn", "delivery_provider", event),
};

export function emitDeliveryProviderTelemetry(
  telemetry: DeliveryProviderTelemetry,
  startedAt: number,
  event: Omit<DeliveryProviderTelemetryEvent, "durationMilliseconds">,
): void {
  let finishedAt = startedAt;
  try {
    finishedAt = telemetry.clock();
  } catch {
    // Observability is deliberately unable to change provider outcomes.
  }
  const elapsed = Number.isFinite(finishedAt - startedAt) ? finishedAt - startedAt : 0;
  const bounded = Math.min(60_000, Math.max(0, Math.round(elapsed)));
  try {
    telemetry.sink({ ...event, durationMilliseconds: bounded });
  } catch {
    // Observability is deliberately unable to change provider outcomes.
  }
}

export function telemetryStart(telemetry: DeliveryProviderTelemetry): number {
  try {
    const value = telemetry.clock();
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}
