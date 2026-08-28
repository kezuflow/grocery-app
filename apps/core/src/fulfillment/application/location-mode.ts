import type { AppErrorCode } from "@freshmarkets/contracts";
import { requestHash } from "../../idempotency";

export type LocationModeView = {
  locationId: string;
  activeMode: "INSTANT" | "SCHEDULED";
  cadence: "WEEKLY" | null;
  promiseMinutes: number | null;
  maxConcurrentInstantOrders: number | null;
  version: number;
};

function failure(code: AppErrorCode, message: string, requestId: string) {
  return { ok: false as const, error: { code, message, requestId } };
}

/** Read the effective fulfillment mode configuration for a location. */
export async function getLocationMode(
  database: D1Database,
  query: { locationId: string; requestId: string },
): Promise<{ ok: true; value: LocationModeView; requestId: string } | ReturnType<typeof failure>> {
  const location = await database
    .prepare("SELECT id FROM fulfillment_location WHERE id=? AND status='active'")
    .bind(query.locationId)
    .first<{ id: string }>();
  if (!location)
    return failure("NOT_FOUND", "Active fulfillment location not found", query.requestId);
  const row = await database
    .prepare(
      "SELECT location_id, active_mode, cadence, promise_minutes, max_concurrent_instant_orders, version FROM fulfillment_location_mode WHERE location_id=?",
    )
    .bind(query.locationId)
    .first<{
      location_id: string;
      active_mode: "INSTANT" | "SCHEDULED";
      cadence: "WEEKLY" | null;
      promise_minutes: number | null;
      max_concurrent_instant_orders: number | null;
      version: number;
    }>();
  return {
    ok: true as const,
    value: row
      ? {
          locationId: row.location_id,
          activeMode: row.active_mode,
          cadence: row.cadence,
          promiseMinutes: row.promise_minutes,
          maxConcurrentInstantOrders: row.max_concurrent_instant_orders,
          version: row.version,
        }
      : // A location without an explicit configuration runs Scheduled.
        {
          locationId: query.locationId,
          activeMode: "SCHEDULED",
          cadence: "WEEKLY",
          promiseMinutes: null,
          maxConcurrentInstantOrders: null,
          version: 0,
        },
    requestId: query.requestId,
  };
}

/**
 * Resolve the checkout-effective mode for a routed location. Absent or
 * incomplete configuration means Scheduled: an INSTANT configuration without
 * a promise or capacity bound fails closed instead of guessing.
 */
export async function resolveCheckoutMode(
  database: D1Database,
  locationId: string,
): Promise<
  | { ok: true; mode: "SCHEDULED" }
  | { ok: true; mode: "INSTANT"; promiseMinutes: number; maxConcurrentInstantOrders: number }
> {
  const row = await database
    .prepare(
      "SELECT active_mode, promise_minutes, max_concurrent_instant_orders FROM fulfillment_location_mode WHERE location_id=?",
    )
    .bind(locationId)
    .first<{
      active_mode: "INSTANT" | "SCHEDULED";
      promise_minutes: number | null;
      max_concurrent_instant_orders: number | null;
    }>();
  if (
    row &&
    row.active_mode === "INSTANT" &&
    row.promise_minutes !== null &&
    row.max_concurrent_instant_orders !== null
  ) {
    return {
      ok: true,
      mode: "INSTANT",
      promiseMinutes: row.promise_minutes,
      maxConcurrentInstantOrders: row.max_concurrent_instant_orders,
    };
  }
  return { ok: true, mode: "SCHEDULED" };
}

export type SetLocationModeCommand = {
  locationId: string;
  activeMode: "INSTANT" | "SCHEDULED";
  cadence?: "WEEKLY" | null;
  promiseMinutes: number | null;
  maxConcurrentInstantOrders: number | null;
  expectedVersion: number | null;
  idempotencyKey: string;
  requestId: string;
};

const SCOPE = "fulfillment.setLocationMode";

/**
 * Activate the location's single fulfillment-mode configuration. The write
 * atomically retires the prior effective configuration (single-row CAS on
 * version for updates); committed orders keep their snapshots untouched.
 */
export async function setFulfillmentLocationMode(
  database: D1Database,
  command: SetLocationModeCommand,
): Promise<{ ok: true; value: LocationModeView; requestId: string } | ReturnType<typeof failure>> {
  const cadence = command.cadence ?? null;
  if (command.activeMode === "INSTANT") {
    if (
      command.promiseMinutes === null ||
      !Number.isInteger(command.promiseMinutes) ||
      command.promiseMinutes <= 0 ||
      command.maxConcurrentInstantOrders === null ||
      !Number.isInteger(command.maxConcurrentInstantOrders) ||
      command.maxConcurrentInstantOrders <= 0
    )
      return failure(
        "VALIDATION_FAILED",
        "INSTANT requires promiseMinutes and maxConcurrentInstantOrders",
        command.requestId,
      );
    if (cadence !== null)
      return failure("VALIDATION_FAILED", "INSTANT cannot have a cadence", command.requestId);
  } else if (cadence !== "WEEKLY") {
    return failure("VALIDATION_FAILED", "SCHEDULED requires WEEKLY cadence", command.requestId);
  }

  const hash = await requestHash({
    locationId: command.locationId,
    activeMode: command.activeMode,
    cadence,
    promiseMinutes: command.promiseMinutes,
    maxConcurrentInstantOrders: command.maxConcurrentInstantOrders,
  });
  const existingRecord = await database
    .prepare(
      "SELECT request_hash, status FROM idempotency_records WHERE scope=? AND idempotency_key=?",
    )
    .bind(SCOPE, command.idempotencyKey)
    .first<{ request_hash: string; status: string }>();
  if (existingRecord) {
    if (existingRecord.request_hash !== hash)
      return failure(
        "IDEMPOTENCY_CONFLICT",
        "Idempotency key was used with a different request",
        command.requestId,
      );
    if (existingRecord.status === "SUCCEEDED")
      return getLocationMode(database, {
        locationId: command.locationId,
        requestId: command.requestId,
      });
    return failure("CONFLICT", "The original command is still processing", command.requestId);
  }

  const location = await database
    .prepare("SELECT id FROM fulfillment_location WHERE id=? AND status='active'")
    .bind(command.locationId)
    .first<{ id: string }>();
  if (!location)
    return failure("NOT_FOUND", "Active fulfillment location not found", command.requestId);

  const now = Date.now();
  await database
    .prepare(
      "INSERT OR IGNORE INTO idempotency_records (scope, idempotency_key, request_hash, result_type, status, created_at, updated_at) VALUES (?, ?, ?, 'location_mode', 'PROCESSING', ?, ?)",
    )
    .bind(SCOPE, command.idempotencyKey, hash, now, now)
    .run();

  let applied: boolean;
  if (command.expectedVersion === null) {
    if (command.activeMode === "INSTANT") {
      // First activation must be an insert; an existing configuration is a
      // concurrent-command conflict, resolved by retrying with its version.
      applied = await database
        .prepare(
          "INSERT INTO fulfillment_location_mode (location_id, active_mode, cadence, promise_minutes, max_concurrent_instant_orders, version, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, 1, ?, ?)",
        )
        .bind(
          command.locationId,
          command.activeMode,
          command.promiseMinutes,
          command.maxConcurrentInstantOrders,
          now,
          now,
        )
        .run()
        .then((result) => (result.meta?.changes ?? 0) === 1)
        .catch(() => false);
    } else {
      applied = await database
        .prepare(
          "INSERT INTO fulfillment_location_mode (location_id, active_mode, cadence, promise_minutes, max_concurrent_instant_orders, version, created_at, updated_at) VALUES (?, 'SCHEDULED', ?, NULL, NULL, 1, ?, ?)",
        )
        .bind(command.locationId, cadence, now, now)
        .run()
        .then((result) => (result.meta?.changes ?? 0) === 1)
        .catch(() => false);
    }
  } else {
    applied = await database
      .prepare(
        "UPDATE fulfillment_location_mode SET active_mode=?, cadence=?, promise_minutes=?, max_concurrent_instant_orders=?, version=version+1, updated_at=? WHERE location_id=? AND version=?",
      )
      .bind(
        command.activeMode,
        cadence,
        command.promiseMinutes,
        command.maxConcurrentInstantOrders,
        now,
        command.locationId,
        command.expectedVersion,
      )
      .run()
      .then((result) => (result.meta?.changes ?? 0) === 1);
  }

  if (!applied) {
    await database
      .prepare(
        "UPDATE idempotency_records SET status='FAILED', updated_at=? WHERE scope=? AND idempotency_key=? AND status='PROCESSING'",
      )
      .bind(now, SCOPE, command.idempotencyKey)
      .run();
    return failure(
      command.expectedVersion === null ? "CONFLICT" : "STALE_VERSION",
      command.expectedVersion === null
        ? "A mode configuration already exists; update it with its version"
        : "Configuration changed; refresh before retrying",
      command.requestId,
    );
  }

  await database
    .prepare(
      "UPDATE idempotency_records SET status='SUCCEEDED', updated_at=? WHERE scope=? AND idempotency_key=? AND status='PROCESSING'",
    )
    .bind(now, SCOPE, command.idempotencyKey)
    .run();

  return getLocationMode(database, {
    locationId: command.locationId,
    requestId: command.requestId,
  });
}
