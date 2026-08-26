import type { AssignRiderRequest, AssignRiderValue } from "@freshmarkets/contracts";
import { claimCommandIdempotency } from "../../idempotency";

function failure(code: string, message: string, requestId: string) {
  return { ok: false as const, error: { code, message, requestId } };
}

export type AssignRiderPorts = {
  /** Capability + location-scope authorization resolved by the caller. */
  authorize: (locationId: string) => Promise<boolean>;
};

const SCOPE = "delivery.assignRider";

/**
 * Assign an open delivery job to an active staff rider. Assignment requires
 * delivery capability over the job's location; the target must hold an
 * active staff identity. The update is a guarded CAS wrapped in an
 * idempotency claim so replays and stale versions are explicit.
 */
export async function assignRider(
  database: D1Database,
  command: Omit<AssignRiderRequest, "headers">,
  ports: AssignRiderPorts,
): Promise<
  | { ok: true; value: AssignRiderValue; requestId: string }
  | { ok: false; error: { code: string; message: string; requestId: string } }
> {
  const row = await database
    .prepare(
      "SELECT d.id AS job_id, d.status, d.version, f.location_id FROM delivery_job d LEFT JOIN fulfillment_record f ON f.order_id=d.order_id WHERE d.order_id=?",
    )
    .bind(command.orderId)
    .first<{ job_id: string; status: string; version: number; location_id: string | null }>();
  if (!row) return failure("NOT_FOUND", "Delivery job not found", command.requestId);
  if (!(await ports.authorize(row.location_id ?? "")))
    return failure(
      "FORBIDDEN",
      "Delivery capability and location scope are required",
      command.requestId,
    );
  if (!["PENDING", "FAILED"].includes(row.status))
    return failure("CONFLICT", "Job is not assignable in its current state", command.requestId);
  const rider = await database
    .prepare("SELECT id FROM staff_identity WHERE auth_user_id=? AND status='active'")
    .bind(command.riderAuthUserId)
    .first<{ id: string }>();
  if (!rider) return failure("NOT_FOUND", "Rider staff identity not found", command.requestId);

  const idempotency = await claimCommandIdempotency(
    database,
    Date.now,
    SCOPE,
    command.idempotencyKey,
    {
      orderId: command.orderId,
      riderAuthUserId: command.riderAuthUserId,
      expectedVersion: command.expectedVersion,
    },
  );
  if (idempotency.existing) {
    if (idempotency.existing.requestHash !== idempotency.hash)
      return failure(
        "IDEMPOTENCY_CONFLICT",
        "Idempotency key was used with a different request",
        command.requestId,
      );
    if (idempotency.existing.status === "SUCCEEDED")
      return {
        ok: true as const,
        value: {
          orderId: command.orderId,
          riderAuthUserId: command.riderAuthUserId,
          status: row.status,
        },
        requestId: command.requestId,
      };
    return failure("CONFLICT", "The original assignment is still processing", command.requestId);
  }
  const result = await database
    .prepare("UPDATE delivery_job SET rider_user_id=?, version=version+1 WHERE id=? AND version=?")
    .bind(command.riderAuthUserId, row.job_id, command.expectedVersion)
    .run();
  if ((result.meta?.changes ?? 0) !== 1) {
    await database
      .prepare(
        "UPDATE idempotency_records SET status='FAILED', updated_at=? WHERE scope=? AND idempotency_key=? AND status='PROCESSING'",
      )
      .bind(Date.now(), SCOPE, command.idempotencyKey)
      .run();
    return failure("STALE_VERSION", "Job changed; refresh before retrying", command.requestId);
  }
  await database
    .prepare(
      "UPDATE idempotency_records SET status='SUCCEEDED', result_reference=?, updated_at=? WHERE scope=? AND idempotency_key=? AND request_hash=? AND status='PROCESSING'",
    )
    .bind(row.job_id, Date.now(), SCOPE, command.idempotencyKey, idempotency.hash)
    .run();
  return {
    ok: true as const,
    value: {
      orderId: command.orderId,
      riderAuthUserId: command.riderAuthUserId,
      status: row.status,
    },
    requestId: command.requestId,
  };
}
