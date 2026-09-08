import type { AppErrorCode } from "@freshmarkets/contracts";
import { requestHash } from "../../idempotency";
import { auditEventStatement } from "../../audit/application/append-audit-event";

export type CommerceSellingState = "OPEN" | "PAUSED";
export type CommerceFulfillmentMode = "INSTANT" | "SCHEDULED";

export type CommerceReadinessBlocker = {
  code: string;
  message: string;
};

export type GlobalCommerceConfiguration = {
  sellingState: CommerceSellingState;
  fulfillmentMode: CommerceFulfillmentMode;
  cadence: "WEEKLY" | null;
  version: number;
  readinessBlockers: readonly CommerceReadinessBlocker[];
};

type Failure = {
  ok: false;
  error: { code: AppErrorCode; message: string; requestId: string };
};

type Result = { ok: true; value: GlobalCommerceConfiguration; requestId: string } | Failure;

type CommerceCommand = {
  expectedVersion: number;
  idempotencyKey: string;
  requestId: string;
  /** Trusted application identity; never taken from the client DTO. */
  actor?: { staffId: string; authUserId: string };
  reason?: string;
};

type StoredConfiguration = {
  selling_state: CommerceSellingState;
  fulfillment_mode: CommerceFulfillmentMode;
  cadence: "WEEKLY" | null;
  version: number;
};

function failure(code: AppErrorCode, message: string, requestId: string): Failure {
  return { ok: false, error: { code, message, requestId } };
}

async function readinessBlockers(
  database: D1Database,
  mode: CommerceFulfillmentMode,
): Promise<CommerceReadinessBlocker[]> {
  const blockers: CommerceReadinessBlocker[] = [];
  const activeLocations = await database
    .prepare(
      "SELECT COUNT(*) count FROM fulfillment_location WHERE status='active' AND purpose='CUSTOMER_FULFILLMENT'",
    )
    .first<{ count: number }>();
  if ((activeLocations?.count ?? 0) === 0) {
    blockers.push({
      code: "NO_ACTIVE_LOCATION",
      message: "At least one active location is required",
    });
    return blockers;
  }

  const missingCapabilities = await database
    .prepare(
      `SELECT location.name
         FROM fulfillment_location location
        WHERE location.status='active' AND location.purpose='CUSTOMER_FULFILLMENT'
          AND NOT EXISTS (
            SELECT 1 FROM location_capability capability
             WHERE capability.location_id=location.id AND capability.enabled=1
               AND capability.capability IN ('PICKING','PACKING','DISPATCH')
             GROUP BY capability.location_id HAVING COUNT(DISTINCT capability.capability)=3
          )
        ORDER BY location.id LIMIT 1`,
    )
    .first<{ name: string }>();
  if (missingCapabilities)
    blockers.push({
      code: "LOCATION_CAPABILITIES_INCOMPLETE",
      message: `${missingCapabilities.name} requires picking, packing, and dispatch capabilities`,
    });

  const missingHours = await database
    .prepare(`SELECT l.name FROM fulfillment_location l JOIN market m ON m.id=l.market_id
    LEFT JOIN location_operating_schedule hours ON hours.location_id=l.id AND hours.timezone=m.timezone
    WHERE l.status='active' AND l.purpose='CUSTOMER_FULFILLMENT' AND (hours.location_id IS NULL OR json_array_length(hours.definition_json,'$.weekly')=0) ORDER BY l.id LIMIT 1`)
    .first<{ name: string }>();
  if (missingHours)
    blockers.push({
      code: "LOCATION_HOURS_NOT_CONFIGURED",
      message: `${missingHours.name} requires configured operating hours`,
    });
  const dispatchNotReady = await database
    .prepare(`SELECT l.name FROM fulfillment_location l
    LEFT JOIN fulfillment_location_readiness r ON r.location_id=l.id
    WHERE l.status='active' AND l.purpose='CUSTOMER_FULFILLMENT' AND COALESCE(r.dispatch_ready,0)!=1 ORDER BY l.id LIMIT 1`)
    .first<{ name: string }>();
  if (dispatchNotReady)
    blockers.push({
      code: "LOCATION_DISPATCH_NOT_READY",
      message: `${dispatchNotReady.name} is not ready to dispatch customer orders`,
    });
  if (mode === "INSTANT") {
    const unready = await database
      .prepare(
        `SELECT location.name
           FROM fulfillment_location location
           LEFT JOIN fulfillment_location_readiness readiness ON readiness.location_id=location.id
          WHERE location.status='active' AND location.purpose='CUSTOMER_FULFILLMENT'
            AND (readiness.location_id IS NULL OR readiness.dispatch_ready!=1 OR
                 readiness.instant_promise_minutes IS NULL)
          ORDER BY location.id LIMIT 1`,
      )
      .first<{ name: string }>();
    if (unready)
      blockers.push({
        code: "INSTANT_LOCATION_NOT_READY",
        message: `${unready.name} is not ready for Instant fulfillment`,
      });
  } else {
    const cycle = await database
      .prepare(
        `SELECT 1 ready
           FROM delivery_cycle cycle
           JOIN delivery_cycle_zone zone ON zone.cycle_id=cycle.id AND zone.status='ACTIVE'
          WHERE cycle.status='OPEN' AND cycle.cutoff_at>? AND cycle.order_opens_at<=?
            AND EXISTS (SELECT 1 FROM delivery_cycle_window w JOIN delivery_cycle_schedule s ON s.cycle_id=w.cycle_id
              WHERE w.cycle_id=cycle.id AND s.pickup_at<=w.starts_at AND w.starts_at<w.ends_at)
          LIMIT 1`,
      )
      .bind(Date.now(), Date.now())
      .first<{ ready: number }>();
    if (!cycle)
      blockers.push({
        code: "SCHEDULED_WINDOW_NOT_READY",
        message: "An open pre-cutoff Scheduled delivery window is required",
      });
  }
  return blockers;
}

async function loadStored(database: D1Database): Promise<StoredConfiguration | null> {
  const row = await database
    .prepare(
      `SELECT selling_state, fulfillment_mode, cadence, version
         FROM global_commerce_configuration WHERE id='global'`,
    )
    .first<Omit<StoredConfiguration, "cadence"> & { cadence: unknown }>();
  // Stored cadence is flexible; only implemented mode/cadence combinations may
  // become runtime authority. Unsupported retained configuration fails closed.
  if (
    !row ||
    (row.fulfillment_mode === "SCHEDULED" ? row.cadence !== "WEEKLY" : row.cadence !== null)
  )
    return null;
  if (row.cadence !== null && row.cadence !== "WEEKLY") return null;
  return { ...row, cadence: row.cadence };
}

export async function getGlobalCommerceConfiguration(
  database: D1Database,
  query: { requestId: string },
): Promise<Result> {
  const row = await loadStored(database);
  if (!row)
    return failure("CONFIGURATION_ERROR", "Global commerce is not configured", query.requestId);
  return {
    ok: true,
    value: {
      sellingState: row.selling_state,
      fulfillmentMode: row.fulfillment_mode,
      cadence: row.cadence,
      version: row.version,
      readinessBlockers: await readinessBlockers(database, row.fulfillment_mode),
    },
    requestId: query.requestId,
  };
}

export async function requireSellingOpen(
  database: D1Database,
  requestId: string,
): Promise<{ ok: true; configuration: StoredConfiguration } | Failure> {
  const configuration = await loadStored(database);
  if (!configuration)
    return failure("CONFIGURATION_ERROR", "Global commerce is not configured", requestId);
  if (configuration.selling_state !== "OPEN")
    return failure(
      "CONFIGURATION_ERROR",
      "FreshMarkets is temporarily not accepting orders",
      requestId,
    );
  return { ok: true, configuration };
}

function parseStoredResult(value: string | null, requestId: string): Result | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as GlobalCommerceConfiguration;
    if (
      (parsed.sellingState === "OPEN" || parsed.sellingState === "PAUSED") &&
      (parsed.fulfillmentMode === "INSTANT" || parsed.fulfillmentMode === "SCHEDULED") &&
      Number.isInteger(parsed.version)
    )
      return { ok: true, value: parsed, requestId };
  } catch {
    // A malformed result is treated as a failed command, never as permission to rerun it.
  }
  return failure("CONFLICT", "The original commerce command result is unavailable", requestId);
}

async function replay(
  database: D1Database,
  scope: string,
  key: string,
  hash: string,
  requestId: string,
): Promise<Result | null> {
  const record = await database
    .prepare(
      "SELECT request_hash, result_reference, status FROM idempotency_records WHERE scope=? AND idempotency_key=?",
    )
    .bind(scope, key)
    .first<{ request_hash: string; result_reference: string | null; status: string }>();
  if (!record) return null;
  if (record.request_hash !== hash)
    return failure(
      "IDEMPOTENCY_CONFLICT",
      "Idempotency key was used with a different request",
      requestId,
    );
  if (record.status === "SUCCEEDED") return parseStoredResult(record.result_reference, requestId);
  return failure("CONFLICT", "The original commerce command is still processing", requestId);
}

async function execute(
  database: D1Database,
  input: CommerceCommand & {
    scope: string;
    action: "PAUSE" | "SWITCH_MODE" | "OPEN";
    fulfillmentMode?: CommerceFulfillmentMode;
    cadence?: "WEEKLY" | null;
  },
): Promise<Result> {
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1)
    return failure(
      "VALIDATION_FAILED",
      "expectedVersion must be a positive integer",
      input.requestId,
    );
  const targetMode = input.fulfillmentMode;
  const targetCadence = input.cadence ?? null;
  if (input.action === "SWITCH_MODE") {
    if (targetMode !== "INSTANT" && targetMode !== "SCHEDULED")
      return failure(
        "VALIDATION_FAILED",
        "A supported fulfillment mode is required",
        input.requestId,
      );
    if (targetMode === "INSTANT" && targetCadence !== null)
      return failure("VALIDATION_FAILED", "INSTANT cannot have a cadence", input.requestId);
    if (targetMode === "SCHEDULED" && targetCadence !== "WEEKLY")
      return failure("VALIDATION_FAILED", "SCHEDULED requires WEEKLY cadence", input.requestId);
  }
  const hash = await requestHash({
    action: input.action,
    expectedVersion: input.expectedVersion,
    fulfillmentMode: targetMode ?? null,
    cadence: targetCadence,
    actorUserId: input.actor?.authUserId ?? null,
    reason: input.reason?.trim() ?? null,
  });
  const prior = await replay(database, input.scope, input.idempotencyKey, hash, input.requestId);
  if (prior) return prior;

  const current = await loadStored(database);
  if (!current)
    return failure("CONFIGURATION_ERROR", "Global commerce is not configured", input.requestId);
  if (current.version !== input.expectedVersion)
    return failure(
      "STALE_VERSION",
      "Global commerce changed; refresh before retrying",
      input.requestId,
    );
  if (input.action === "PAUSE" && current.selling_state !== "OPEN")
    return failure("ILLEGAL_TRANSITION", "Selling is already paused", input.requestId);
  if (input.action === "SWITCH_MODE" && current.selling_state !== "PAUSED")
    return failure(
      "ILLEGAL_TRANSITION",
      "Pause selling before switching fulfillment mode",
      input.requestId,
    );
  if (input.action === "OPEN" && current.selling_state !== "PAUSED")
    return failure("ILLEGAL_TRANSITION", "Selling is already open", input.requestId);

  if (input.action === "SWITCH_MODE" && targetMode !== current.fulfillment_mode) {
    const unresolved = await database
      .prepare(
        `SELECT COUNT(*) count FROM grocery_order
          WHERE fulfillment_mode<>? AND status NOT IN ('DELIVERED','CANCELED','REFUNDED','EXPIRED')`,
      )
      .bind(targetMode)
      .first<{ count: number }>();
    if ((unresolved?.count ?? 0) > 0)
      return failure(
        "CONFIGURATION_ERROR",
        "Resolve or explicitly protect committed work in the current mode before switching",
        input.requestId,
      );
  }

  const nextMode =
    input.action === "SWITCH_MODE" && targetMode ? targetMode : current.fulfillment_mode;
  const nextCadence = input.action === "SWITCH_MODE" ? targetCadence : current.cadence;
  if (input.action === "OPEN") {
    const blockers = await readinessBlockers(database, nextMode);
    if (blockers.length > 0)
      return failure(
        "CONFIGURATION_ERROR",
        blockers.map((item) => item.message).join("; "),
        input.requestId,
      );
  }

  const next: GlobalCommerceConfiguration = {
    sellingState: input.action === "PAUSE" ? "PAUSED" : input.action === "OPEN" ? "OPEN" : "PAUSED",
    fulfillmentMode: nextMode,
    cadence: nextCadence,
    version: current.version + 1,
    readinessBlockers: await readinessBlockers(database, nextMode),
  };
  const now = Date.now();
  const statements: D1PreparedStatement[] = [
    database
      .prepare(
        "INSERT OR IGNORE INTO idempotency_records (scope,idempotency_key,request_hash,result_type,result_reference,status,created_at,updated_at) VALUES (?,?,?,'global_commerce_configuration',NULL,'PROCESSING',?,?)",
      )
      .bind(input.scope, input.idempotencyKey, hash, now, now),
    database.prepare("INSERT INTO commitment_abort(id) SELECT -20 WHERE changes()=0"),
    database
      .prepare(
        `UPDATE global_commerce_configuration
            SET selling_state=?, fulfillment_mode=?, cadence=?, version=version+1, updated_at=?
          WHERE id='global' AND selling_state=? AND fulfillment_mode=? AND version=?`,
      )
      .bind(
        next.sellingState,
        next.fulfillmentMode,
        next.cadence,
        now,
        current.selling_state,
        current.fulfillment_mode,
        input.expectedVersion,
      ),
    database.prepare("INSERT INTO commitment_abort(id) SELECT -21 WHERE changes()=0"),
  ];
  if (input.actor) {
    // A cached access decision cannot authorize a write after role/scope revocation.
    statements.unshift(
      database
        .prepare(`INSERT INTO commitment_abort(id) SELECT -22 WHERE NOT EXISTS (
        SELECT 1 FROM staff_identity staff
        JOIN staff_scope scope ON scope.staff_id=staff.id AND scope.scope_kind='global'
        JOIN staff_role assignment ON assignment.staff_id=staff.id
        JOIN role_permission grant_entry ON grant_entry.role_id=assignment.role_id
        JOIN permission ON permission.id=grant_entry.permission_id
        WHERE staff.id=? AND staff.auth_user_id=? AND staff.status='active'
          AND permission.code='fulfillment.manage'
      )`)
        .bind(input.actor.staffId, input.actor.authUserId),
    );
  }
  if (input.action === "OPEN") {
    // These predicates guard every effect, including the version, audit and replay result.
    statements.push(
      database.prepare(`INSERT INTO commitment_abort(id) SELECT -23 WHERE EXISTS (
        SELECT 1 FROM fulfillment_location l LEFT JOIN fulfillment_location_readiness r ON r.location_id=l.id
        WHERE l.status='active' AND l.purpose='CUSTOMER_FULFILLMENT' AND COALESCE(r.dispatch_ready,0)!=1)`),
      database.prepare(`INSERT INTO commitment_abort(id) SELECT -23 WHERE EXISTS (
        SELECT 1 FROM fulfillment_location l JOIN market m ON m.id=l.market_id LEFT JOIN location_operating_schedule hours ON hours.location_id=l.id AND hours.timezone=m.timezone
        WHERE l.status='active' AND l.purpose='CUSTOMER_FULFILLMENT' AND (hours.location_id IS NULL OR json_array_length(hours.definition_json,'$.weekly')=0))`),
      database.prepare(`INSERT INTO commitment_abort(id) SELECT -23 WHERE
        NOT EXISTS (SELECT 1 FROM fulfillment_location WHERE status='active' AND purpose='CUSTOMER_FULFILLMENT')
        OR EXISTS (SELECT 1 FROM fulfillment_location location WHERE location.status='active' AND location.purpose='CUSTOMER_FULFILLMENT'
          AND (SELECT COUNT(DISTINCT capability) FROM location_capability
            WHERE location_id=location.id AND enabled=1
              AND capability IN ('PICKING','PACKING','DISPATCH'))<>3)`),
      nextMode === "INSTANT"
        ? database.prepare(`INSERT INTO commitment_abort(id) SELECT -24 WHERE EXISTS (
            SELECT 1 FROM fulfillment_location location
            LEFT JOIN fulfillment_location_readiness readiness ON readiness.location_id=location.id
            WHERE location.status='active' AND location.purpose='CUSTOMER_FULFILLMENT' AND (readiness.location_id IS NULL
              OR readiness.dispatch_ready!=1 OR readiness.instant_promise_minutes IS NULL))`)
        : database
            .prepare(`INSERT INTO commitment_abort(id) SELECT -24 WHERE NOT EXISTS (
            SELECT 1 FROM delivery_cycle cycle
            JOIN delivery_cycle_zone zone ON zone.cycle_id=cycle.id AND zone.status='ACTIVE'
            WHERE cycle.status='OPEN' AND cycle.cutoff_at>? AND cycle.order_opens_at<=?
              AND EXISTS (SELECT 1 FROM delivery_cycle_window w JOIN delivery_cycle_schedule s ON s.cycle_id=w.cycle_id
                WHERE w.cycle_id=cycle.id AND s.pickup_at<=w.starts_at AND w.starts_at<w.ends_at))`)
            .bind(now, now),
    );
  }
  if (input.action === "SWITCH_MODE" && targetMode !== current.fulfillment_mode) {
    statements.push(
      database
        .prepare(`INSERT INTO commitment_abort(id) SELECT -25 WHERE EXISTS (
        SELECT 1 FROM grocery_order WHERE fulfillment_mode<>?
          AND status NOT IN ('DELIVERED','CANCELED','REFUNDED','EXPIRED'))`)
        .bind(targetMode),
      database
        .prepare(
          `UPDATE checkout_quote SET status='SUPERSEDED',version=version+1,updated_at=?
            WHERE status='ACTIVE' AND NOT EXISTS (
              SELECT 1 FROM payment_intent payment
               WHERE payment.purpose='GROCERY_CHECKOUT'
                 AND payment.subject_type='checkout_quote' AND payment.subject_id=checkout_quote.id
            )`,
        )
        .bind(now),
    );
  }
  if (input.actor) {
    statements.push(
      auditEventStatement(database, {
        actorUserId: input.actor.authUserId,
        action:
          input.action === "PAUSE"
            ? "COMMERCE.SELLING_PAUSED"
            : input.action === "OPEN"
              ? "COMMERCE.SELLING_OPENED"
              : "COMMERCE.FULFILLMENT_MODE_ACTIVATED",
        resourceType: "global_commerce_configuration",
        resourceId: "global",
        reason: input.reason?.trim() ?? null,
        idempotencyKey: input.idempotencyKey,
        before: {
          sellingState: current.selling_state,
          fulfillmentMode: current.fulfillment_mode,
          version: current.version,
        },
        after: {
          sellingState: next.sellingState,
          fulfillmentMode: next.fulfillmentMode,
          version: next.version,
        },
        correlationId: input.requestId,
        occurredAt: now,
      }),
    );
  }
  statements.push(
    database
      .prepare(
        "UPDATE idempotency_records SET result_reference=?,status='SUCCEEDED',updated_at=? WHERE scope=? AND idempotency_key=? AND status='PROCESSING'",
      )
      .bind(JSON.stringify(next), now, input.scope, input.idempotencyKey),
  );

  try {
    await database.batch(statements);
  } catch {
    const raced = await replay(database, input.scope, input.idempotencyKey, hash, input.requestId);
    if (raced) return raced;
    return failure(
      "STALE_VERSION",
      "Global commerce changed; refresh before retrying",
      input.requestId,
    );
  }
  return { ok: true, value: next, requestId: input.requestId };
}

export function pauseSelling(database: D1Database, command: CommerceCommand): Promise<Result> {
  return execute(database, { ...command, scope: "commerce.pauseSelling", action: "PAUSE" });
}

export function activateGlobalFulfillmentMode(
  database: D1Database,
  command: CommerceCommand & {
    fulfillmentMode: CommerceFulfillmentMode;
    cadence?: "WEEKLY" | null;
  },
): Promise<Result> {
  return execute(database, {
    ...command,
    scope: "commerce.activateGlobalFulfillmentMode",
    action: "SWITCH_MODE",
  });
}

export function openSelling(database: D1Database, command: CommerceCommand): Promise<Result> {
  return execute(database, { ...command, scope: "commerce.openSelling", action: "OPEN" });
}
