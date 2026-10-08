import type { ProviderEvent } from "../ports/provider-event";
import { providerCoordinatesMatch } from "../domain/provider-stop-identity";
import type { ObservedDeliveryStop } from "../ports/delivery-provider";
import { providerEvidenceStatements } from "./provider-evidence-statements";
import { deliveryNotificationStatements } from "../../notifications/application/delivery-notifications";
import {
  loadSharedBooking,
  sharedBookingView,
  sharedConflict,
  type SharedBookingSnapshot,
} from "./shared-delivery-booking";

type Member = {
  job_id: string;
  dispatch_id: string;
  provider_position: number;
  outcome: string;
  observed_at: number | null;
  dispatch_version: number;
  dispatch_status: string;
  handed_over_at: number | null;
  job_status: string;
  job_version: number;
  order_id: string;
  current_attempt: number;
};
function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function proofAt(evidence: ProviderEvent["evidence"], position: number): string | null {
  const proof = evidence?.find((item) => item.kind === "DELIVERY_PROOF");
  const values: unknown[] = Array.isArray(proof?.value) ? proof.value : [];
  const value = values.map(object).find((item) => item?.stopIndex === position);
  const status = typeof value?.status === "string" ? value.status.toUpperCase() : null;
  if (status === "DELIVERED" || status === "SIGNED") return "DELIVERED";
  return status === "FAILED" ? "FAILED" : null;
}
function perMemberEvidence(
  evidence: ProviderEvent["evidence"],
  position: number,
): NonNullable<ProviderEvent["evidence"]> {
  return (evidence ?? []).flatMap((item) => {
    if (item.kind === "COST" || item.kind === "EDIT") return [];
    if (item.kind === "DRIVER") return [item];
    if (!Array.isArray(item.value)) return [];
    const values = item.value
      .map(object)
      .filter(
        (value) =>
          value &&
          (item.kind === "PICKUP_PROOF" ? value.stopIndex === 0 : value.stopIndex === position),
      );
    return values.length
      ? [
          {
            kind: item.kind,
            value: values.map((value) => ({
              ...value,
              stopIndex: item.kind === "PICKUP_PROOF" ? 0 : 1,
            })),
          },
        ]
      : [];
  });
}
function routeMatches(
  saved: SharedBookingSnapshot,
  mapping: readonly Member[],
  observed: readonly ObservedDeliveryStop[],
) {
  if (observed.length !== mapping.length + 1) return false;
  const normalizePhone = (phone: string | null) =>
    phone?.replace(/\D/g, "").replace(/^(63|0)/, "") ?? "";
  return observed.every((stop) => {
    const member = mapping.find((candidate) => candidate.provider_position === stop.position);
    const destination = member
      ? saved.route.destinations.find((candidate) => candidate.reference === member.job_id)
      : undefined;
    const address = destination?.address ?? saved.route.origin;
    const contact = destination?.recipient ?? saved.route.sender;
    const pickupInstructions = saved.route.origin.instructions.deliveryInstructions?.trim();
    const expectedAddress =
      stop.position === 0 && pickupInstructions
        ? `${address.formattedAddress}\r\nPickup instructions: ${pickupInstructions}`
        : address.formattedAddress;
    return (
      (stop.position === 0 || !!destination) &&
      stop.formattedAddress === expectedAddress &&
      providerCoordinatesMatch(stop.coordinate, address.coordinate) &&
      (stop.name === null || stop.name === contact.name) &&
      (stop.phone === null || normalizePhone(stop.phone) === normalizePhone(contact.phoneE164))
    );
  });
}

/** Authenticated provider facts update the shared booking and all affected Order effects atomically. */
export async function applySharedDeliveryEvent(
  db: D1Database,
  bookingId: string,
  event: ProviderEvent,
  inboxId?: string,
) {
  const now = Date.now();
  const defer = async (reason: string) => {
    if (inboxId)
      await db
        .prepare(
          "UPDATE delivery_provider_event_inbox SET processing_status='RECONCILIATION_REQUIRED',last_error_code=? WHERE id=? AND processing_status!='APPLIED'",
        )
        .bind(reason, inboxId)
        .run();
    return { outcome: "RECONCILIATION_REQUIRED" as const, reason };
  };
  const row = await loadSharedBooking(db, bookingId);
  if (!row || !event.providerDeliveryId) return defer("DELIVERY_SHARED_BOOKING_NOT_FOUND");
  if (event.kind === "UNKNOWN" || event.status === "UNKNOWN")
    return defer("DELIVERY_UNKNOWN_PROVIDER_STATUS");
  if (
    inboxId &&
    (await db
      .prepare(
        "SELECT id FROM delivery_provider_event_inbox WHERE id=? AND processing_status='APPLIED'",
      )
      .bind(inboxId)
      .first())
  )
    return { outcome: "DUPLICATE" as const };
  const lookupId = event.previousProviderDeliveryId ?? event.providerDeliveryId;
  const receipt = () =>
    db
      .prepare(
        `UPDATE delivery_provider_event_inbox SET processing_status='APPLIED',processed_at=?,shared_booking_id=?,merchant_order_id=?,last_error_code=NULL WHERE id=? AND processing_status!='APPLIED'`,
      )
      .bind(now, bookingId, row.merchant_order_id, inboxId ?? "");
  if (row.provider_delivery_id !== null && row.provider_delivery_id !== lookupId) {
    if (inboxId)
      await db.batch([
        receipt(),
        db.prepare("INSERT INTO commitment_abort(id) SELECT -32 WHERE changes()!=1"),
      ]);
    return { outcome: "OLDER" as const };
  }
  if (
    row.provider_delivery_id === null &&
    (event.merchantOrderId !== row.merchant_order_id ||
      !["CREATING", "OUTCOME_UNKNOWN", "RECONCILIATION_REQUIRED"].includes(row.status))
  )
    return defer("DELIVERY_SHARED_IDENTITY_UNVERIFIED");
  const members = (
    await db
      .prepare(`SELECT member.job_id,member.dispatch_id,member.provider_position,member.outcome,member.observed_at,
      dispatch.version AS dispatch_version,dispatch.status AS dispatch_status,dispatch.handed_over_at,
      job.status AS job_status,job.version AS job_version,job.order_id,
      NOT EXISTS (SELECT 1 FROM delivery_provider_dispatch newer WHERE newer.delivery_job_id=job.id AND newer.attempt_sequence>dispatch.attempt_sequence) AS current_attempt
    FROM delivery_shared_booking_member member JOIN delivery_provider_dispatch dispatch ON dispatch.id=member.dispatch_id
    JOIN delivery_job job ON job.id=member.job_id WHERE member.booking_id=? ORDER BY member.provider_position`)
      .bind(bookingId)
      .all<Member>()
  ).results;
  const saved = JSON.parse(row.request_snapshot_json) as SharedBookingSnapshot;
  if (members.length !== saved.rows.length || members.length < 2 || members.length > 5)
    return defer("DELIVERY_SHARED_MEMBERSHIP_INVALID");
  const olderStatus =
    event.status !== undefined &&
    row.provider_observed_at !== null &&
    event.observedAt < row.provider_observed_at;
  const replacement = event.kind === "REPLACEMENT";
  if (replacement && ["COMPLETED", "CANCELED", "FAILED"].includes(row.status))
    return defer("DELIVERY_TERMINAL_CONFLICT");
  if (
    !replacement &&
    event.status &&
    !olderStatus &&
    ["COMPLETED", "CANCELED", "FAILED"].includes(row.provider_status ?? "") &&
    event.status !== row.provider_status
  )
    return defer("DELIVERY_TERMINAL_CONFLICT");
  const edited = event.evidence?.some((item) => item.kind === "EDIT") ?? false;
  const matches =
    event.observedStops &&
    (row.provider_observed_at === null || event.observedAt >= row.provider_observed_at)
      ? routeMatches(saved, members, event.observedStops)
      : null;
  const routeUnverified =
    edited ||
    replacement ||
    matches === false ||
    (row.route_review_required === 1 && matches !== true);
  const status =
    olderStatus || routeUnverified || event.replacementCheck
      ? row.provider_status
      : (event.status ?? row.provider_status);
  const rematching =
    status === "ALLOCATING" && row.provider_status !== null && row.provider_status !== "ALLOCATING";
  const supportReplacement = event.replacementCheck === true;
  const cancelConfirmed = status === "CANCELED" && !supportReplacement;
  const parentStatus =
    routeUnverified || supportReplacement
      ? "RECONCILIATION_REQUIRED"
      : status === "COMPLETED"
        ? "COMPLETED"
        : cancelConfirmed
          ? "CANCELED"
          : status === "FAILED" || status === "RETURNED"
            ? "FAILED"
            : row.cancel_pending
              ? "OUTCOME_UNKNOWN"
              : "ACTIVE";
  const identity =
    replacement || row.provider_delivery_id === null
      ? event.providerDeliveryId
      : row.provider_delivery_id;
  const driverChanged =
    !olderStatus &&
    ((event.driverId !== undefined && event.driverId !== null) || rematching || replacement) &&
    (row.driver_observed_at === null || event.observedAt >= row.driver_observed_at);
  const driver = rematching || replacement ? null : (event.driverId ?? row.driver_id);
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        "UPDATE delivery_shared_booking SET status=?,provider_delivery_id=?,provider_status=?,provider_observed_at=CASE WHEN ?=1 THEN ? ELSE provider_observed_at END,driver_id=CASE WHEN ?=1 AND COALESCE(driver_observed_at,0)<=? THEN ? ELSE driver_id END,driver_observed_at=CASE WHEN ?=1 AND COALESCE(driver_observed_at,0)<=? THEN ? ELSE driver_observed_at END,tracking_url=CASE WHEN ?=1 THEN NULL ELSE COALESCE(?,tracking_url) END,route_review_required=?,custody_review_required=CASE WHEN ?=1 THEN 1 WHEN ?=1 THEN 0 ELSE custody_review_required END,replacement_pending=?,cancel_pending=CASE WHEN ?=1 THEN 0 ELSE cancel_pending END,version=version+1,updated_at=? WHERE id=? AND version=?",
      )
      .bind(
        parentStatus,
        identity,
        replacement ? "ALLOCATING" : status,
        event.status !== undefined && !olderStatus ? 1 : 0,
        event.observedAt,
        driverChanged ? 1 : 0,
        event.observedAt,
        driver,
        driverChanged ? 1 : 0,
        event.observedAt,
        event.observedAt,
        replacement ? 1 : 0,
        event.trackingUrl ?? null,
        routeUnverified ? 1 : 0,
        rematching || supportReplacement ? 1 : 0,
        status === "COMPLETED" ? 1 : 0,
        supportReplacement ? 1 : 0,
        cancelConfirmed || status === "COMPLETED" || status === "FAILED" ? 1 : 0,
        now,
        bookingId,
        row.version,
      ),
    db.prepare("INSERT INTO commitment_abort(id) SELECT -32 WHERE changes()!=1"),
  ];
  if (replacement || row.provider_delivery_id === null)
    statements.push(
      db
        .prepare(
          "INSERT INTO delivery_shared_booking_identity(provider_delivery_id,booking_id,observed_at) VALUES (?,?,?)",
        )
        .bind(identity, bookingId, event.observedAt),
    );
  if (
    row.confirm_key &&
    row.confirm_result_json === null &&
    !routeUnverified &&
    !supportReplacement
  ) {
    const confirmation = {
      ...(await sharedBookingView(db, row)),
      status: parentStatus,
      providerStatus: status,
      version: row.version + 1,
    };
    statements.push(
      db
        .prepare(
          "UPDATE delivery_shared_booking SET confirm_result_json=? WHERE id=? AND confirm_result_json IS NULL",
        )
        .bind(JSON.stringify(confirmation), bookingId),
      db.prepare("INSERT INTO commitment_abort(id) SELECT -32 WHERE changes()!=1"),
    );
  }
  const cost = event.evidence?.find((item) => item.kind === "COST");
  const value = object(cost?.value);
  if (
    value?.currency === "PHP" &&
    Number.isSafeInteger(value.amountMinor) &&
    Number(value.amountMinor) >= 0 &&
    (row.cost_observed_at === null || event.observedAt >= row.cost_observed_at)
  )
    statements.push(
      db
        .prepare(
          "UPDATE delivery_shared_booking SET final_payable_minor=?,cost_observed_at=? WHERE id=?",
        )
        .bind(value.amountMinor, event.observedAt, bookingId),
    );
  for (const member of members) {
    if (!member.current_attempt) continue;
    const observedOutcome =
      routeUnverified ||
      supportReplacement ||
      (member.observed_at !== null && event.observedAt < member.observed_at)
        ? null
        : proofAt(event.evidence, member.provider_position);
    if (member.outcome === "DELIVERED" && observedOutcome === "FAILED")
      return defer("DELIVERY_STOP_TERMINAL_CONFLICT");
    const outcome =
      member.outcome === "DELIVERED" || member.outcome === "FAILED"
        ? member.outcome
        : (observedOutcome ??
          (status === "COMPLETED" && !routeUnverified ? "DELIVERED" : "PENDING"));
    const held = member.handed_over_at !== null;
    const normalized =
      outcome === "DELIVERED"
        ? "DELIVERED"
        : outcome === "FAILED"
          ? "FAILED"
          : routeUnverified || supportReplacement
            ? null
            : status === "IN_DELIVERY"
              ? "EN_ROUTE"
              : status === "CANCELED" ||
                  status === "FAILED" ||
                  status === "RETURNED" ||
                  status === "IN_RETURN"
                ? "FAILED"
                : status === "ALLOCATING"
                  ? held
                    ? null
                    : "UNASSIGNED"
                  : status === "PENDING_PICKUP" ||
                      status === "PICKING_UP" ||
                      status === "PENDING_DROP_OFF"
                    ? held
                      ? null
                      : "ASSIGNED"
                    : null;
    const memberStatus =
      outcome === "DELIVERED"
        ? "COMPLETED"
        : outcome === "FAILED" && !row.cancel_pending
          ? "FAILED"
          : routeUnverified || supportReplacement
            ? "RECONCILIATION_REQUIRED"
            : row.cancel_pending && !cancelConfirmed
              ? "OUTCOME_UNKNOWN"
              : cancelConfirmed
                ? "CANCELED"
                : status === "RETURNED"
                  ? "RETURNED"
                  : status === "FAILED"
                    ? "FAILED"
                    : "ACTIVE";
    const memberProviderStatus =
      outcome === "DELIVERED" ? "COMPLETED" : outcome === "FAILED" ? "FAILED" : status;
    statements.push(
      db
        .prepare(
          `INSERT INTO commitment_abort(id) SELECT -32 WHERE NOT EXISTS (SELECT 1 FROM delivery_provider_dispatch d JOIN delivery_job job ON job.id=d.delivery_job_id WHERE d.id=? AND d.version=? AND job.version=? AND NOT EXISTS (SELECT 1 FROM delivery_provider_dispatch newer WHERE newer.delivery_job_id=job.id AND newer.attempt_sequence>d.attempt_sequence))`,
        )
        .bind(member.dispatch_id, member.dispatch_version, member.job_version),
      db
        .prepare(
          "UPDATE delivery_provider_dispatch SET status=?,provider_status=?,driver_id=CASE WHEN ?=1 THEN ? ELSE driver_id END,driver_observed_at=CASE WHEN ?=1 THEN ? ELSE driver_observed_at END,custody_review_required=CASE WHEN ?=1 AND handed_over_at IS NOT NULL THEN 1 WHEN ?=1 THEN 0 ELSE custody_review_required END,route_review_required=?,replacement_pending=?,provider_observed_at=MAX(COALESCE(provider_observed_at,0),?),provider_status_rank=?,handed_over_at=CASE WHEN ?=1 THEN COALESCE(handed_over_at,?) ELSE handed_over_at END,completed_at=CASE WHEN ?=1 THEN COALESCE(completed_at,?) ELSE completed_at END,version=version+1,updated_at=? WHERE id=? AND version=?",
        )
        .bind(
          memberStatus,
          memberProviderStatus,
          driverChanged ? 1 : 0,
          driver,
          driverChanged ? 1 : 0,
          event.observedAt,
          rematching || supportReplacement ? 1 : 0,
          outcome === "DELIVERED" ? 1 : 0,
          routeUnverified ? 1 : 0,
          supportReplacement ? 1 : 0,
          event.observedAt,
          outcome !== "PENDING" ? 100 : normalized === "EN_ROUTE" ? 50 : 20,
          normalized === "EN_ROUTE" || normalized === "DELIVERED" ? 1 : 0,
          event.observedAt,
          outcome === "DELIVERED" ? 1 : 0,
          event.observedAt,
          now,
          member.dispatch_id,
          member.dispatch_version,
        ),
      db.prepare("INSERT INTO commitment_abort(id) SELECT -32 WHERE changes()!=1"),
      db
        .prepare(
          "UPDATE delivery_shared_booking_member SET outcome=?,observed_at=CASE WHEN ?=1 THEN MAX(COALESCE(observed_at,0),?) ELSE observed_at END WHERE booking_id=? AND job_id=?",
        )
        .bind(
          outcome,
          observedOutcome !== null || (status === "COMPLETED" && !routeUnverified) ? 1 : 0,
          event.observedAt,
          bookingId,
          member.job_id,
        ),
      db.prepare("INSERT INTO commitment_abort(id) SELECT -32 WHERE changes()!=1"),
    );
    if (normalized === "EN_ROUTE" || normalized === "DELIVERED")
      statements.push(
        db
          .prepare(
            `INSERT INTO commitment_abort(id) SELECT -32 WHERE NOT EXISTS (SELECT 1 FROM delivery_job job JOIN fulfillment_record f ON f.order_id=job.order_id AND f.location_id=job.location_id JOIN grocery_order o ON o.id=job.order_id WHERE job.id=? AND f.status IN ('PACKED','HANDED_OFF','COMPLETED') AND o.status IN ('FULFILLMENT_READY','OUT_FOR_DELIVERY','DELIVERED'))`,
          )
          .bind(member.job_id),
        db
          .prepare(
            "UPDATE fulfillment_record SET status=?,version=version+1,updated_at=? WHERE order_id=? AND location_id=? AND status IN ('PACKED','HANDED_OFF') AND status!=?",
          )
          .bind(
            normalized === "DELIVERED" ? "COMPLETED" : "HANDED_OFF",
            now,
            member.order_id,
            row.location_id,
            normalized === "DELIVERED" ? "COMPLETED" : "HANDED_OFF",
          ),
        db
          .prepare(
            "UPDATE grocery_order SET status=?,version=version+1 WHERE id=? AND status IN ('FULFILLMENT_READY','OUT_FOR_DELIVERY') AND status!=?",
          )
          .bind(
            normalized === "DELIVERED" ? "DELIVERED" : "OUT_FOR_DELIVERY",
            member.order_id,
            normalized === "DELIVERED" ? "DELIVERED" : "OUT_FOR_DELIVERY",
          ),
      );
    if (normalized)
      statements.push(
        db
          .prepare(
            "UPDATE delivery_job SET status=?,delivered_at=CASE WHEN ?='DELIVERED' THEN COALESCE(delivered_at,?) ELSE delivered_at END,version=version+1,updated_at=? WHERE id=? AND status NOT IN ('DELIVERED','CANCELED','ESCALATED') AND status!=?",
          )
          .bind(normalized, normalized, event.observedAt, now, member.job_id, normalized),
        db
          .prepare(
            "UPDATE delivery_stop SET status=?,delivered_at=CASE WHEN ?='DELIVERED' THEN COALESCE(delivered_at,?) ELSE delivered_at END,version=version+1,updated_at=? WHERE delivery_job_id=? AND status NOT IN ('DELIVERED','CANCELED','ESCALATED') AND status!=?",
          )
          .bind(normalized, normalized, event.observedAt, now, member.job_id, normalized),
      );
    if (
      normalized &&
      normalized !== member.job_status &&
      ["EN_ROUTE", "DELIVERED", "FAILED"].includes(normalized)
    )
      statements.push(
        ...deliveryNotificationStatements(
          db,
          member.dispatch_id,
          normalized === "EN_ROUTE"
            ? "OUT_FOR_DELIVERY"
            : normalized === "DELIVERED"
              ? "DELIVERED"
              : "DELIVERY_FAILED",
          event.observedAt,
        ),
        db
          .prepare(
            `INSERT INTO audit_event(id,actor_user_id,action,aggregate_type,aggregate_id,details_json,idempotency_key,location_id,correlation_id,occurred_at) VALUES (?,NULL,'DELIVERY.SHARED_PROVIDER_PROGRESS','delivery_provider_dispatch',?,?,?,?,?,?)`,
          )
          .bind(
            `shared-progress:${inboxId ?? event.eventId}:${member.dispatch_id}`,
            member.dispatch_id,
            JSON.stringify({ bookingId, status: normalized }),
            `shared-progress:${inboxId ?? event.eventId}:${member.dispatch_id}`,
            row.location_id,
            event.eventId,
            event.observedAt,
          ),
      );
    statements.push(
      ...providerEvidenceStatements(
        db,
        member.dispatch_id,
        event.observedAt,
        perMemberEvidence(event.evidence, member.provider_position),
      ),
    );
  }
  if (inboxId)
    statements.push(
      receipt(),
      db.prepare("INSERT INTO commitment_abort(id) SELECT -32 WHERE changes()!=1"),
    );
  if (cancelConfirmed)
    statements.push(
      db
        .prepare(
          `UPDATE delivery_shared_booking_command SET status='SUCCEEDED',result_json=(SELECT json_object('dispatchId',d.id,'deliveryJobId',d.delivery_job_id,'provider','lalamove','providerDeliveryId',b.provider_delivery_id,'status',d.status,'providerStatus',d.provider_status,'trackingUrl',b.tracking_url,'pickupPin',NULL,'quoteAmountMinor',NULL,'quoteCurrency',NULL,'attemptCount',1,'lastErrorCode',NULL,'version',b.version) FROM delivery_provider_dispatch d JOIN delivery_shared_booking b ON b.id=d.shared_booking_id WHERE d.id=delivery_shared_booking_command.dispatch_id),updated_at=? WHERE booking_id=? AND operation='CANCEL' AND status IN ('SUBMITTING','OUTCOME_UNKNOWN')`,
        )
        .bind(now, bookingId),
    );
  try {
    await db.batch(statements);
    return { outcome: "APPLIED" as const };
  } catch (error) {
    if (!sharedConflict(error)) throw error;
    return defer("DELIVERY_SHARED_OBSERVATION_STALE");
  }
}
