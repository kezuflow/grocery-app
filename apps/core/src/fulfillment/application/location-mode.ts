import {
  activateGlobalFulfillmentMode,
  getGlobalCommerceConfiguration,
} from "../../commerce/application/global-commerce-configuration";
import type { AppErrorCode } from "@freshmarkets/contracts";

export type GlobalModeView = {
  activeMode: "INSTANT" | "SCHEDULED";
  cadence: "WEEKLY" | null;
  version: number;
};

function failure(code: AppErrorCode, message: string, requestId: string) {
  return { ok: false as const, error: { code, message, requestId } };
}

export async function getGlobalMode(
  database: D1Database,
  query: { requestId: string },
): Promise<{ ok: true; value: GlobalModeView; requestId: string } | ReturnType<typeof failure>> {
  const configuration = await getGlobalCommerceConfiguration(database, query);
  if (!configuration.ok) return configuration;
  return {
    ok: true,
    value: {
      activeMode: configuration.value.fulfillmentMode,
      cadence: configuration.value.cadence,
      version: configuration.value.version,
    },
    requestId: query.requestId,
  };
}

/**
 * Resolve the one business-wide mode and the selected location's operational
 * readiness. An inconsistent Instant configuration fails closed; it never
 * silently crosses back to Scheduled for one location.
 */
export async function resolveCheckoutMode(
  database: D1Database,
  locationId: string,
): Promise<
  { ok: true; mode: "SCHEDULED" } | { ok: true; mode: "INSTANT"; promiseMinutes: number }
> {
  const row = await database
    .prepare(
      `SELECT mode.fulfillment_mode, readiness.instant_promise_minutes,
              readiness.dispatch_ready
         FROM global_commerce_configuration mode
         LEFT JOIN fulfillment_location_readiness readiness ON readiness.location_id=?
        WHERE mode.id='global'`,
    )
    .bind(locationId)
    .first<{
      fulfillment_mode: "INSTANT" | "SCHEDULED";
      instant_promise_minutes: number | null;
      dispatch_ready: number | null;
    }>();
  if (!row) throw new Error("GLOBAL_FULFILLMENT_MODE_NOT_CONFIGURED");
  if (row.fulfillment_mode === "SCHEDULED") return { ok: true, mode: "SCHEDULED" };
  if (row.dispatch_ready !== 1 || row.instant_promise_minutes === null)
    throw new Error("INSTANT_LOCATION_NOT_READY");
  return {
    ok: true,
    mode: "INSTANT",
    promiseMinutes: row.instant_promise_minutes,
  };
}

export type SetGlobalModeCommand = {
  activeMode: "INSTANT" | "SCHEDULED";
  cadence?: "WEEKLY" | null;
  expectedVersion: number;
  idempotencyKey: string;
  requestId: string;
};

/** Activate the single global mode under idempotency and optimistic CAS. */
export async function setGlobalFulfillmentMode(
  database: D1Database,
  command: SetGlobalModeCommand,
): Promise<{ ok: true; value: GlobalModeView; requestId: string } | ReturnType<typeof failure>> {
  const changed = await activateGlobalFulfillmentMode(database, {
    fulfillmentMode: command.activeMode,
    cadence: command.cadence,
    expectedVersion: command.expectedVersion,
    idempotencyKey: command.idempotencyKey,
    requestId: command.requestId,
  });
  if (!changed.ok) return changed;
  return {
    ok: true,
    value: {
      activeMode: changed.value.fulfillmentMode,
      cadence: changed.value.cadence,
      version: changed.value.version,
    },
    requestId: command.requestId,
  };
}
