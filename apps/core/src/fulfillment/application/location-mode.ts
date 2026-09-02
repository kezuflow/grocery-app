import type { AppErrorCode } from "@freshmarkets/contracts";
import { requestHash } from "../../idempotency";

export type GlobalModeView = {
  activeMode: "INSTANT" | "SCHEDULED";
  cadence: "WEEKLY" | null;
  version: number;
};

export type LocationModeView = GlobalModeView;

function failure(code: AppErrorCode, message: string, requestId: string) {
  return { ok: false as const, error: { code, message, requestId } };
}

export async function getGlobalMode(
  database: D1Database,
  query: { requestId: string },
): Promise<{ ok: true; value: GlobalModeView; requestId: string } | ReturnType<typeof failure>> {
  const row = await database
    .prepare("SELECT active_mode, cadence, version FROM global_fulfillment_mode WHERE id='global'")
    .first<{
      active_mode: "INSTANT" | "SCHEDULED";
      cadence: "WEEKLY" | null;
      version: number;
    }>();
  if (!row)
    return failure(
      "CONFIGURATION_ERROR",
      "Global fulfillment mode is not configured",
      query.requestId,
    );
  return {
    ok: true,
    value: { activeMode: row.active_mode, cadence: row.cadence, version: row.version },
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
  | { ok: true; mode: "SCHEDULED" }
  | { ok: true; mode: "INSTANT"; promiseMinutes: number; maxConcurrentInstantOrders: number }
> {
  const row = await database
    .prepare(
      `SELECT mode.active_mode, readiness.instant_promise_minutes,
              readiness.max_concurrent_instant_orders, readiness.dispatch_ready
         FROM global_fulfillment_mode mode
         LEFT JOIN fulfillment_location_readiness readiness ON readiness.location_id=?
        WHERE mode.id='global'`,
    )
    .bind(locationId)
    .first<{
      active_mode: "INSTANT" | "SCHEDULED";
      instant_promise_minutes: number | null;
      max_concurrent_instant_orders: number | null;
      dispatch_ready: number | null;
    }>();
  if (!row) throw new Error("GLOBAL_FULFILLMENT_MODE_NOT_CONFIGURED");
  if (row.active_mode === "SCHEDULED") return { ok: true, mode: "SCHEDULED" };
  if (
    row.dispatch_ready !== 1 ||
    row.instant_promise_minutes === null ||
    row.max_concurrent_instant_orders === null
  )
    throw new Error("INSTANT_LOCATION_NOT_READY");
  return {
    ok: true,
    mode: "INSTANT",
    promiseMinutes: row.instant_promise_minutes,
    maxConcurrentInstantOrders: row.max_concurrent_instant_orders,
  };
}

export type SetGlobalModeCommand = {
  activeMode: "INSTANT" | "SCHEDULED";
  cadence?: "WEEKLY" | null;
  expectedVersion: number;
  idempotencyKey: string;
  requestId: string;
};

const SCOPE = "fulfillment.setGlobalMode";

async function instantReadinessBlocker(database: D1Database): Promise<string | null> {
  const unready = await database
    .prepare(
      `SELECT location.name
         FROM fulfillment_location location
         LEFT JOIN fulfillment_location_readiness readiness ON readiness.location_id=location.id
        WHERE location.status='active'
          AND (
            readiness.location_id IS NULL OR readiness.dispatch_ready!=1 OR
            readiness.instant_promise_minutes IS NULL OR
            readiness.max_concurrent_instant_orders IS NULL
          )
        ORDER BY location.id
        LIMIT 1`,
    )
    .first<{ name: string }>();
  if (unready) return `${unready.name} is not ready for Instant fulfillment`;

  const openDemand = await database
    .prepare("SELECT COUNT(*) AS count FROM committed_demand WHERE status='OPEN'")
    .first<{ count: number }>();
  if ((openDemand?.count ?? 0) > 0)
    return "Open Scheduled demand must be received, fulfilled, canceled, or explicitly protected before Instant activation";
  return null;
}

/** Activate the single global mode under idempotency and optimistic CAS. */
export async function setGlobalFulfillmentMode(
  database: D1Database,
  command: SetGlobalModeCommand,
): Promise<{ ok: true; value: GlobalModeView; requestId: string } | ReturnType<typeof failure>> {
  const cadence = command.cadence ?? null;
  if (command.activeMode === "INSTANT" && cadence !== null)
    return failure("VALIDATION_FAILED", "INSTANT cannot have a cadence", command.requestId);
  if (command.activeMode === "SCHEDULED" && cadence !== "WEEKLY")
    return failure("VALIDATION_FAILED", "SCHEDULED requires WEEKLY cadence", command.requestId);
  if (!Number.isInteger(command.expectedVersion) || command.expectedVersion < 1)
    return failure("VALIDATION_FAILED", "expectedVersion must be positive", command.requestId);

  const hash = await requestHash({ activeMode: command.activeMode, cadence });
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
      return getGlobalMode(database, { requestId: command.requestId });
    return failure("CONFLICT", "The original command is still processing", command.requestId);
  }

  const current = await getGlobalMode(database, { requestId: command.requestId });
  if (!current.ok) return current;
  if (current.value.activeMode !== "INSTANT" && command.activeMode === "INSTANT") {
    const blocker = await instantReadinessBlocker(database);
    if (blocker) return failure("CONFIGURATION_ERROR", blocker, command.requestId);
  }

  const now = Date.now();
  await database
    .prepare(
      "INSERT OR IGNORE INTO idempotency_records (scope, idempotency_key, request_hash, result_type, status, created_at, updated_at) VALUES (?, ?, ?, 'global_fulfillment_mode', 'PROCESSING', ?, ?)",
    )
    .bind(SCOPE, command.idempotencyKey, hash, now, now)
    .run();

  const results = await database.batch([
    database
      .prepare(
        "UPDATE global_fulfillment_mode SET active_mode=?, cadence=?, version=version+1, updated_at=? WHERE id='global' AND version=?",
      )
      .bind(command.activeMode, cadence, now, command.expectedVersion),
    database
      .prepare(
        "UPDATE checkout_quote SET status='SUPERSEDED', version=version+1, updated_at=? WHERE status='ACTIVE'",
      )
      .bind(now),
  ]);
  if ((results[0]?.meta?.changes ?? 0) !== 1) {
    await database
      .prepare(
        "UPDATE idempotency_records SET status='FAILED', updated_at=? WHERE scope=? AND idempotency_key=? AND status='PROCESSING'",
      )
      .bind(now, SCOPE, command.idempotencyKey)
      .run();
    return failure(
      "STALE_VERSION",
      "Global fulfillment mode changed; refresh before retrying",
      command.requestId,
    );
  }
  await database
    .prepare(
      "UPDATE idempotency_records SET status='SUCCEEDED', updated_at=? WHERE scope=? AND idempotency_key=? AND status='PROCESSING'",
    )
    .bind(now, SCOPE, command.idempotencyKey)
    .run();
  return getGlobalMode(database, { requestId: command.requestId });
}

// Compatibility exports keep focused callers readable while persistence is
// fully global. New RPC and UI contracts do not carry a location target.
export async function getLocationMode(
  database: D1Database,
  query: { locationId?: string; requestId: string },
) {
  return getGlobalMode(database, query);
}

export type SetLocationModeCommand = Omit<SetGlobalModeCommand, "expectedVersion"> & {
  expectedVersion: number | null;
  locationId?: string;
  promiseMinutes?: number | null;
  maxConcurrentInstantOrders?: number | null;
};

export async function setFulfillmentLocationMode(
  database: D1Database,
  command: SetLocationModeCommand,
) {
  if (
    command.locationId &&
    command.promiseMinutes !== undefined &&
    command.maxConcurrentInstantOrders !== undefined
  ) {
    await database
      .prepare(
        `UPDATE fulfillment_location_readiness
            SET instant_promise_minutes=?, max_concurrent_instant_orders=?,
                dispatch_ready=?, version=version+1, updated_at=?
          WHERE location_id=?`,
      )
      .bind(
        command.promiseMinutes,
        command.maxConcurrentInstantOrders,
        command.promiseMinutes !== null && command.maxConcurrentInstantOrders !== null ? 1 : 0,
        Date.now(),
        command.locationId,
      )
      .run();
  }
  const current = await getGlobalMode(database, { requestId: command.requestId });
  if (!current.ok) return current;
  return setGlobalFulfillmentMode(database, {
    ...command,
    expectedVersion: command.expectedVersion ?? current.value.version,
  });
}
