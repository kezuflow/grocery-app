import { providerEvidenceStatements } from "./provider-evidence-statements";
import type { ProviderDeliveryStatus } from "../ports/delivery-provider";
import { completeProviderCommandStatements } from "../infrastructure/provider-command-repository";
import { deliveryNotificationStatements } from "../../notifications/application/delivery-notifications";

export type ProviderObservation = Readonly<{
  dispatchId: string;
  status: ProviderDeliveryStatus;
  observedAt: number;
  trackingUrl: string | null;
  driverId?: string | null;
  pickupPin?: string | null;
  /** Explicit provider driver reset; absent fields never erase a rider. */
  resetDriver?: boolean;
  replacementCheck?: boolean;
  evidence?: import("../ports/provider-event").ProviderEvent["evidence"];
}>;

type ApplyOptions = Readonly<{
  expectedVersion?: number;
  inboxId?: string;
  /** Persist the caller's command result/audit in the same guarded transaction. */
  completionStatements?: readonly D1PreparedStatement[];
}>;

type ApplyResult = Readonly<{
  outcome: "APPLIED" | "DUPLICATE" | "OLDER" | "RECONCILIATION_REQUIRED";
  reason?: string;
}>;

function dispatchStatus(status: ProviderDeliveryStatus): string {
  switch (status) {
    case "COMPLETED":
      return "COMPLETED";
    case "CANCELED":
      return "CANCELED";
    case "RETURNED":
      return "RETURNED";
    case "FAILED":
      return "FAILED";
    default:
      return "ACTIVE";
  }
}

function statusRank(status: ProviderDeliveryStatus): number {
  switch (status) {
    case "ALLOCATING":
      return 10;
    case "PENDING_PICKUP":
      return 20;
    case "PICKING_UP":
      return 30;
    case "PENDING_DROP_OFF":
      return 40;
    case "IN_DELIVERY":
      return 50;
    case "IN_RETURN":
      return 60;
    case "COMPLETED":
    case "CANCELED":
    case "FAILED":
    case "RETURNED":
      return 100;
    default:
      return 0;
  }
}

function jobStatus(status: ProviderDeliveryStatus): string | null {
  switch (status) {
    case "ALLOCATING":
      return null;
    case "PENDING_PICKUP":
    case "PICKING_UP":
    case "PENDING_DROP_OFF":
      return "ASSIGNED";
    case "IN_DELIVERY":
      return "EN_ROUTE";
    case "COMPLETED":
      return "DELIVERED";
    case "CANCELED":
    case "FAILED":
    case "IN_RETURN":
    case "RETURNED":
      return "FAILED";
    default:
      return null;
  }
}

/** Apply verified provider facts; callers own ingress authentication and command authorization. */
export async function applyProviderObservation(
  database: D1Database,
  observation: ProviderObservation,
  options: ApplyOptions = {},
): Promise<ApplyResult> {
  const dispatch = await database
    .prepare(`SELECT id,merchant_order_id,version,provider_delivery_id,provider_observed_at,provider_status_rank,provider_status,provider,handed_over_at,custody_review_required,driver_observed_at
    FROM delivery_provider_dispatch WHERE id=? AND method='EXTERNAL'`)
    .bind(observation.dispatchId)
    .first<{
      id: string;
      merchant_order_id: string;
      version: number;
      provider_observed_at: number | null;
      provider_status_rank: number | null;
      provider_status: string | null;
      provider_delivery_id: string | null;
      provider: string;
      handed_over_at: number | null;
      custody_review_required: number;
      driver_observed_at: number | null;
    }>();
  const now = Date.now();
  const completion = [
    ...providerEvidenceStatements(
      database,
      observation.dispatchId,
      observation.observedAt,
      observation.evidence,
    ),
    ...(options.completionStatements ?? []),
    ...(options.inboxId
      ? completeProviderCommandStatements(database, options.inboxId, observation.observedAt, now)
      : []),
  ];
  const inboxApplied = () =>
    database
      .prepare(`UPDATE delivery_provider_event_inbox
    SET processing_status='APPLIED',processed_at=?,last_error_code=NULL,dispatch_id=?,merchant_order_id=? WHERE id=?`)
      .bind(
        now,
        observation.dispatchId,
        dispatch?.merchant_order_id ?? "UNKNOWN",
        options.inboxId ?? "",
      );
  const defer = async (reason: string): Promise<ApplyResult> => {
    if (options.inboxId)
      await database
        .prepare(`UPDATE delivery_provider_event_inbox
      SET processing_status='RECONCILIATION_REQUIRED',last_error_code=? WHERE id=? AND processing_status!='APPLIED'`)
        .bind(reason, options.inboxId)
        .run();
    return { outcome: "RECONCILIATION_REQUIRED", reason };
  };
  if (!dispatch) return defer("DELIVERY_DISPATCH_NOT_FOUND");
  const currentAttemptSql = `SELECT 1 FROM delivery_provider_dispatch current
    WHERE current.id=? AND NOT EXISTS (
      SELECT 1 FROM delivery_provider_dispatch newer
      WHERE newer.delivery_job_id=current.delivery_job_id AND newer.attempt_sequence>current.attempt_sequence
    )`;
  if (!(await database.prepare(currentAttemptSql).bind(dispatch.id).first()))
    return defer("DELIVERY_ATTEMPT_SUPERSEDED");
  if (options.inboxId) {
    const identity = await database
      .prepare("SELECT provider_delivery_id FROM delivery_provider_event_inbox WHERE id=?")
      .bind(options.inboxId)
      .first<{ provider_delivery_id: string }>();
    if (
      identity &&
      dispatch.provider_delivery_id !== null &&
      identity.provider_delivery_id !== dispatch.provider_delivery_id
    )
      return defer("DELIVERY_IDENTITY_CHANGED");
    const applied = await database
      .prepare(
        "SELECT id FROM delivery_provider_event_inbox WHERE id=? AND processing_status='APPLIED'",
      )
      .bind(options.inboxId)
      .first();
    if (applied) {
      return { outcome: "DUPLICATE" };
    }
  }
  if (options.expectedVersion !== undefined && dispatch.version !== options.expectedVersion)
    return defer("DELIVERY_DISPATCH_STALE");
  if (
    observation.replacementCheck &&
    (dispatch.provider_observed_at === null ||
      dispatch.provider_observed_at <= observation.observedAt)
  ) {
    // A support cancellation can create a replacement. Keep the commercial
    // delivery and physical custody while waiting for its verified identity.
    if (["COMPLETED", "RETURNED"].includes(dispatch.provider_status ?? ""))
      return defer("DELIVERY_TERMINAL_CONFLICT");
    try {
      await database.batch([
        database
          .prepare(
            `INSERT INTO commitment_abort(id) SELECT -32 WHERE NOT EXISTS (${currentAttemptSql})`,
          )
          .bind(dispatch.id),
        ...(options.inboxId
          ? [
              database
                .prepare(
                  "INSERT INTO commitment_abort(id) SELECT -32 WHERE NOT EXISTS (SELECT 1 FROM delivery_provider_event_inbox WHERE id=? AND processing_status!='APPLIED')",
                )
                .bind(options.inboxId),
            ]
          : []),
        database
          .prepare(
            `UPDATE delivery_provider_dispatch SET replacement_pending=1,status='RECONCILIATION_REQUIRED',custody_review_required=CASE WHEN handed_over_at IS NOT NULL THEN 1 ELSE custody_review_required END,version=version+1,updated_at=? WHERE id=? AND version=?`,
          )
          .bind(now, dispatch.id, dispatch.version),
        database.prepare("INSERT INTO commitment_abort(id) SELECT -32 WHERE changes()!=1"),
        ...completion,
        ...(options.inboxId
          ? [
              inboxApplied(),
              database.prepare("INSERT INTO commitment_abort(id) SELECT -32 WHERE changes()!=1"),
            ]
          : []),
      ]);
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("CHECK constraint failed: id = 0"))
        throw error;
      return defer("DELIVERY_DISPATCH_STALE");
    }
    return { outcome: "APPLIED" };
  }
  if (observation.status === "UNKNOWN") return defer("DELIVERY_STATUS_UNKNOWN");
  const rank = statusRank(observation.status);
  if (
    dispatch.provider_observed_at === observation.observedAt &&
    dispatch.provider_status !== observation.status &&
    rank === 100 &&
    dispatch.provider_status_rank === 100
  )
    return defer("DELIVERY_TERMINAL_CONFLICT");
  const older =
    dispatch.provider_observed_at !== null &&
    (dispatch.provider_observed_at > observation.observedAt ||
      (dispatch.provider_observed_at === observation.observedAt &&
        (dispatch.provider_status_rank ?? 0) >= rank));
  if (older) {
    const statements = [
      database
        .prepare(
          `INSERT INTO commitment_abort(id) SELECT -32 WHERE NOT EXISTS (SELECT 1 FROM delivery_provider_dispatch WHERE id=? AND version=?)`,
        )
        .bind(dispatch.id, dispatch.version),
      database
        .prepare(
          `INSERT INTO commitment_abort(id) SELECT -32 WHERE NOT EXISTS (${currentAttemptSql})`,
        )
        .bind(dispatch.id),
      ...completion,
    ];
    if (options.inboxId)
      statements.push(
        inboxApplied(),
        database.prepare("INSERT INTO commitment_abort(id) SELECT -32 WHERE changes()!=1"),
      );
    try {
      await database.batch(statements);
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("CHECK constraint failed: id = 0"))
        throw error;
      return defer("DELIVERY_DISPATCH_STALE");
    }
    return { outcome: "OLDER" };
  }
  if (dispatch.provider_status !== observation.status) {
    if (["COMPLETED", "CANCELED", "FAILED", "RETURNED"].includes(dispatch.provider_status ?? ""))
      return defer("DELIVERY_TERMINAL_CONFLICT");
    if (
      ["IN_DELIVERY", "IN_RETURN"].includes(dispatch.provider_status ?? "") &&
      rank < 50 &&
      !(
        dispatch.provider === "lalamove" &&
        dispatch.provider_status === "IN_DELIVERY" &&
        observation.status === "ALLOCATING"
      )
    )
      return defer("DELIVERY_STATUS_REGRESSION");
  }
  const rematching =
    dispatch.provider === "lalamove" &&
    observation.status === "ALLOCATING" &&
    dispatch.provider_status !== "ALLOCATING" &&
    dispatch.provider_status !== null;
  const custodyHeld = dispatch.handed_over_at !== null && rank < 50;
  const normalized = custodyHeld ? null : rematching ? "UNASSIGNED" : jobStatus(observation.status);
  const orderStatus =
    normalized === "EN_ROUTE"
      ? "OUT_FOR_DELIVERY"
      : normalized === "DELIVERED"
        ? "DELIVERED"
        : null;
  const packedOrderSql = `SELECT 1 FROM delivery_provider_dispatch dispatch
    JOIN delivery_job job ON job.id=dispatch.delivery_job_id
    JOIN fulfillment_record fulfillment ON fulfillment.order_id=job.order_id
    JOIN grocery_order grocery ON grocery.id=job.order_id
    WHERE dispatch.id=? AND fulfillment.status IN ('PACKED','HANDED_OFF','COMPLETED')
      AND grocery.status IN ('FULFILLMENT_READY','OUT_FOR_DELIVERY','DELIVERED')`;
  if (orderStatus && !(await database.prepare(packedOrderSql).bind(dispatch.id).first()))
    return defer("DELIVERY_PACKING_NOT_COMPLETE");
  const statements: D1PreparedStatement[] = [];
  statements.push(
    database
      .prepare(
        `INSERT INTO commitment_abort(id) SELECT -32 WHERE NOT EXISTS (${currentAttemptSql})`,
      )
      .bind(dispatch.id),
  );
  if (options.inboxId)
    statements.push(
      database
        .prepare(
          "INSERT INTO commitment_abort(id) SELECT -32 WHERE NOT EXISTS (SELECT 1 FROM delivery_provider_event_inbox WHERE id=? AND processing_status!='APPLIED')",
        )
        .bind(options.inboxId),
    );
  statements.push(
    database
      .prepare(`UPDATE delivery_provider_dispatch SET status=?,provider_status=?,provider_observed_at=?,provider_status_rank=?,
      tracking_url=COALESCE(?,tracking_url),
      driver_id=CASE WHEN ?=1 AND COALESCE(driver_observed_at,0)<=? THEN ? ELSE driver_id END,
      driver_observed_at=CASE WHEN ?=1 AND COALESCE(driver_observed_at,0)<=? THEN ? ELSE driver_observed_at END,
      custody_review_required=CASE WHEN ?=1 THEN 0 WHEN ?=1 AND handed_over_at IS NOT NULL THEN 1 ELSE custody_review_required END,
      replacement_pending=CASE WHEN ?=1 THEN 0 ELSE replacement_pending END,
      pickup_pin=COALESCE(?,pickup_pin),
      handed_over_at=CASE WHEN ?=1 THEN COALESCE(handed_over_at,?) ELSE handed_over_at END,
      completed_at=CASE WHEN ?=1 THEN COALESCE(completed_at,?) ELSE completed_at END,
      last_error_code=?,version=version+1,updated_at=?
      WHERE id=? AND version=?`)
      .bind(
        dispatchStatus(observation.status),
        observation.status,
        observation.observedAt,
        rank,
        observation.trackingUrl,
        observation.driverId != null || observation.resetDriver || rematching ? 1 : 0,
        observation.observedAt,
        rematching || observation.resetDriver ? null : (observation.driverId ?? null),
        observation.driverId != null || observation.resetDriver || rematching ? 1 : 0,
        observation.observedAt,
        observation.observedAt,
        observation.status === "COMPLETED" ? 1 : 0,
        rematching ? 1 : 0,
        ["COMPLETED", "RETURNED"].includes(observation.status) ? 1 : 0,
        observation.pickupPin ?? null,
        ["IN_DELIVERY", "COMPLETED"].includes(observation.status) ? 1 : 0,
        observation.observedAt,
        observation.status === "COMPLETED" ? 1 : 0,
        observation.observedAt,
        observation.status === "FAILED" ? "DELIVERY_PROVIDER_FAILED" : null,
        now,
        dispatch.id,
        dispatch.version,
      ),
    database.prepare("INSERT INTO commitment_abort(id) SELECT -32 WHERE changes()!=1"),
  );
  if (dispatchStatus(observation.status) === "ACTIVE")
    statements.push(
      database
        .prepare(`UPDATE delivery_provider_dispatch
    SET status='OUTCOME_UNKNOWN',last_error_code='CANCEL_OUTCOME_UNKNOWN'
    WHERE id=? AND EXISTS (SELECT 1 FROM delivery_provider_command command
      WHERE command.dispatch_id=delivery_provider_dispatch.id AND command.operation='CANCEL'
        AND command.status IN ('SUBMITTING','OUTCOME_UNKNOWN','OBSERVED'))`)
        .bind(dispatch.id),
    );
  if (orderStatus)
    statements.push(
      database
        .prepare(`INSERT INTO commitment_abort(id) SELECT -32 WHERE NOT EXISTS (${packedOrderSql})`)
        .bind(dispatch.id),
    );
  if (normalized)
    statements.push(
      database
        .prepare(`UPDATE delivery_job SET status=?,delivered_at=?,version=version+1,updated_at=?
      WHERE id=(SELECT delivery_job_id FROM delivery_provider_dispatch WHERE id=?) AND status NOT IN ('DELIVERED','CANCELED','ESCALATED') AND status!=?`)
        .bind(normalized, normalized === "DELIVERED" ? now : null, now, dispatch.id, normalized),
      database
        .prepare(`UPDATE delivery_stop SET status=?,delivered_at=?,version=version+1,updated_at=?
      WHERE delivery_job_id=(SELECT delivery_job_id FROM delivery_provider_dispatch WHERE id=?) AND status NOT IN ('DELIVERED','CANCELED','ESCALATED') AND status!=?`)
        .bind(normalized, normalized === "DELIVERED" ? now : null, now, dispatch.id, normalized),
    );
  if (orderStatus)
    statements.push(
      database
        .prepare(`UPDATE fulfillment_record SET status=?,version=version+1,updated_at=?
    WHERE order_id=(SELECT job.order_id FROM delivery_provider_dispatch dispatch JOIN delivery_job job ON job.id=dispatch.delivery_job_id WHERE dispatch.id=?)
      AND location_id=(SELECT job.location_id FROM delivery_provider_dispatch dispatch JOIN delivery_job job ON job.id=dispatch.delivery_job_id WHERE dispatch.id=?)
      AND status IN ('PACKED','HANDED_OFF') AND status!=?`)
        .bind(
          normalized === "DELIVERED" ? "COMPLETED" : "HANDED_OFF",
          now,
          dispatch.id,
          dispatch.id,
          normalized === "DELIVERED" ? "COMPLETED" : "HANDED_OFF",
        ),
      database
        .prepare(`UPDATE grocery_order SET status=?,version=version+1
    WHERE id=(SELECT job.order_id FROM delivery_provider_dispatch dispatch JOIN delivery_job job ON job.id=dispatch.delivery_job_id WHERE dispatch.id=?)
      AND status IN ('FULFILLMENT_READY','OUT_FOR_DELIVERY') AND status!=?`)
        .bind(orderStatus, dispatch.id, orderStatus),
    );
  if (normalized === "EN_ROUTE" || normalized === "DELIVERED" || normalized === "FAILED")
    statements.push(
      ...deliveryNotificationStatements(
        database,
        dispatch.id,
        normalized === "EN_ROUTE"
          ? "OUT_FOR_DELIVERY"
          : normalized === "DELIVERED"
            ? "DELIVERED"
            : "DELIVERY_FAILED",
        observation.observedAt,
      ),
    );
  statements.push(...completion);
  if (options.inboxId)
    statements.push(
      inboxApplied(),
      database.prepare("INSERT INTO commitment_abort(id) SELECT -32 WHERE changes()!=1"),
    );
  try {
    await database.batch(statements);
    return { outcome: "APPLIED" };
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("CHECK constraint failed: id = 0"))
      throw error;
    if (
      options.inboxId &&
      (await database
        .prepare(
          "SELECT id FROM delivery_provider_event_inbox WHERE id=? AND processing_status='APPLIED'",
        )
        .bind(options.inboxId)
        .first())
    )
      return { outcome: "DUPLICATE" };
    return defer("DELIVERY_DISPATCH_STALE");
  }
}
