import type { DeliveryBatchView, FulfillmentMode } from "@freshmarkets/contracts";
import { auditEventStatement } from "../../audit/application/append-audit-event";
import { ASSIGNABLE_DELIVERY_CYCLE_STATES } from "../domain/delivery-assignment-policy";

export type DeliveryAssignmentCandidate = {
  jobId: string;
  jobVersion: number;
  jobStatus: string;
  jobBatchId: string | null;
  jobSequence: number | null;
  fulfillmentMode: FulfillmentMode;
  cycleId: string | null;
  locationId: string | null;
  zoneId: string | null;
  contextResolutionStatus: string;
  stopId: string | null;
  stopVersion: number | null;
  stopStatus: string | null;
  stopBatchId: string | null;
  stopSequence: number | null;
  latitude: number | null;
  longitude: number | null;
  batchStatus: string | null;
  batchVersion: number | null;
  batchMode: FulfillmentMode | null;
  batchCycleId: string | null;
  batchLocationId: string | null;
  batchZoneId: string | null;
  batchResolutionStatus: string | null;
};

type CandidateRow = {
  job_id: string;
  job_version: number;
  job_status: string;
  job_batch_id: string | null;
  job_sequence: number | null;
  fulfillment_mode: FulfillmentMode;
  cycle_id: string | null;
  location_id: string | null;
  zone_id: string | null;
  context_resolution_status: string;
  stop_id: string | null;
  stop_version: number | null;
  stop_status: string | null;
  stop_batch_id: string | null;
  stop_sequence: number | null;
  latitude: number | null;
  longitude: number | null;
  batch_status: string | null;
  batch_version: number | null;
  batch_mode: FulfillmentMode | null;
  batch_cycle_id: string | null;
  batch_location_id: string | null;
  batch_zone_id: string | null;
  batch_resolution_status: string | null;
};

export async function loadDeliveryAssignmentCandidates(
  database: D1Database,
  jobIds: readonly string[],
): Promise<Map<string, DeliveryAssignmentCandidate>> {
  const rows = await database
    .prepare(
      `SELECT job.id AS job_id, job.version AS job_version, job.status AS job_status,
              job.batch_id AS job_batch_id, job.sequence AS job_sequence,
              job.fulfillment_mode, job.cycle_id, job.location_id, job.zone_id,
              job.context_resolution_status,
              stop.id AS stop_id, stop.version AS stop_version, stop.status AS stop_status,
              stop.batch_id AS stop_batch_id, stop.sequence AS stop_sequence,
              stop.latitude, stop.longitude,
              batch.status AS batch_status, batch.version AS batch_version,
              batch.fulfillment_mode AS batch_mode,
              batch.cycle_id AS batch_cycle_id, batch.location_id AS batch_location_id,
              batch.zone_id AS batch_zone_id,
              batch.context_resolution_status AS batch_resolution_status
       FROM delivery_job job
       LEFT JOIN delivery_stop stop ON stop.delivery_job_id=job.id
       LEFT JOIN delivery_batch batch ON batch.id=job.batch_id
       WHERE job.id IN (${jobIds.map(() => "?").join(",")})`,
    )
    .bind(...jobIds)
    .all<CandidateRow>();
  return new Map(
    rows.results.map((row) => [
      row.job_id,
      {
        jobId: row.job_id,
        jobVersion: row.job_version,
        jobStatus: row.job_status,
        jobBatchId: row.job_batch_id,
        jobSequence: row.job_sequence,
        fulfillmentMode: row.fulfillment_mode,
        cycleId: row.cycle_id,
        locationId: row.location_id,
        zoneId: row.zone_id,
        contextResolutionStatus: row.context_resolution_status,
        stopId: row.stop_id,
        stopVersion: row.stop_version,
        stopStatus: row.stop_status,
        stopBatchId: row.stop_batch_id,
        stopSequence: row.stop_sequence,
        latitude: row.latitude,
        longitude: row.longitude,
        batchStatus: row.batch_status,
        batchVersion: row.batch_version,
        batchMode: row.batch_mode,
        batchCycleId: row.batch_cycle_id,
        batchLocationId: row.batch_location_id,
        batchZoneId: row.batch_zone_id,
        batchResolutionStatus: row.batch_resolution_status,
      },
    ]),
  );
}

export type CommitDeliveryBatchInput = {
  batchId: string;
  locationId: string;
  marketId: string;
  locationVersion: number;
  fulfillmentMode: FulfillmentMode;
  cycleId: string | null;
  cycleStatus: string | null;
  cycleVersion: number | null;
  zoneId: string;
  riderId: string;
  riderVersion: number;
  actorStaffId: string;
  actorAuthUserId: string;
  requestId: string;
  idempotencyKey: string;
  requestHash: string;
  now: number;
  candidates: readonly DeliveryAssignmentCandidate[];
};

const abortWhenNoChange = (database: D1Database) =>
  database.prepare("INSERT INTO admin_command_abort(id) SELECT 1 WHERE changes()=0");

export async function commitDeliveryBatch(
  database: D1Database,
  input: CommitDeliveryBatchInput,
): Promise<void> {
  const statements: D1PreparedStatement[] = [
    database
      .prepare(
        `INSERT INTO admin_command_abort(id)
         SELECT 1 WHERE NOT EXISTS (
           SELECT 1 FROM fulfillment_location
           WHERE id=? AND market_id=? AND status='active' AND version=?
         )`,
      )
      .bind(input.locationId, input.marketId, input.locationVersion),
    database
      .prepare(
        `INSERT INTO admin_command_abort(id)
         SELECT 1 WHERE NOT EXISTS (
           SELECT 1 FROM staff_identity staff
           WHERE staff.id=? AND staff.auth_user_id=? AND staff.status='active'
             AND EXISTS (
               SELECT 1 FROM staff_role staff_role
               JOIN role_permission role_permission ON role_permission.role_id=staff_role.role_id
               JOIN permission permission ON permission.id=role_permission.permission_id
               WHERE staff_role.staff_id=staff.id AND permission.code='delivery.manage'
             )
             AND EXISTS (
               SELECT 1 FROM staff_scope scope
               WHERE scope.staff_id=staff.id AND (
                 scope.scope_kind='global'
                 OR (scope.scope_kind='location' AND scope.location_id=?)
                 OR (scope.scope_kind='market' AND scope.market_id=?)
               )
             )
         )`,
      )
      .bind(input.actorStaffId, input.actorAuthUserId, input.locationId, input.marketId),
    database
      .prepare(
        `INSERT INTO admin_command_abort(id)
         SELECT 1 WHERE NOT EXISTS (
           SELECT 1 FROM rider_identity
           WHERE id=? AND status='ACTIVE' AND version=?
             AND (preferred_location_id IS NULL OR preferred_location_id=?)
         )`,
      )
      .bind(input.riderId, input.riderVersion, input.locationId),
    ...(input.fulfillmentMode === "SCHEDULED"
      ? [
          database
            .prepare(
              `INSERT INTO admin_command_abort(id)
               SELECT 1 WHERE NOT EXISTS (
                 SELECT 1 FROM delivery_cycle cycle
                 WHERE cycle.id=? AND cycle.market_id=? AND cycle.status=? AND cycle.version=?
                   AND cycle.status IN (${ASSIGNABLE_DELIVERY_CYCLE_STATES.map(() => "?").join(",")})
                   AND EXISTS (
                     SELECT 1 FROM cycle_zone_capacity capacity
                     WHERE capacity.cycle_id=cycle.id AND capacity.location_id=?
                   )
               )`,
            )
            .bind(
              input.cycleId,
              input.marketId,
              input.cycleStatus,
              input.cycleVersion,
              ...ASSIGNABLE_DELIVERY_CYCLE_STATES,
              input.locationId,
            ),
        ]
      : []),
    database
      .prepare(
        "INSERT INTO idempotency_records (scope, idempotency_key, request_hash, result_type, result_reference, status, created_at, updated_at) VALUES ('delivery.createAndAssignBatch', ?, ?, 'delivery_batch', NULL, 'PROCESSING', ?, ?)",
      )
      .bind(input.idempotencyKey, input.requestHash, input.now, input.now),
    database
      .prepare(
        "INSERT INTO delivery_batch (id, fulfillment_mode, cycle_id, location_id, zone_id, rider_id, status, context_resolution_status, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, 'DRAFT', 'RESOLVED', 1, ?, ?)",
      )
      .bind(
        input.batchId,
        input.fulfillmentMode,
        input.cycleId,
        input.locationId,
        input.zoneId,
        input.now,
        input.now,
      ),
    database
      .prepare(
        "UPDATE delivery_batch SET status='READY', version=2, updated_at=? WHERE id=? AND status='DRAFT' AND version=1",
      )
      .bind(input.now, input.batchId),
    abortWhenNoChange(database),
    database
      .prepare(
        "UPDATE delivery_batch SET status='ASSIGNED', rider_id=?, version=3, updated_at=? WHERE id=? AND status='READY' AND version=2",
      )
      .bind(input.riderId, input.now, input.batchId),
    abortWhenNoChange(database),
  ];

  input.candidates.forEach((candidate, index) => {
    const sequence = index + 1;
    if (candidate.jobBatchId !== null) {
      statements.push(
        database
          .prepare(
            `INSERT INTO admin_command_abort(id)
             SELECT 1 WHERE NOT EXISTS (
               SELECT 1 FROM delivery_batch
               WHERE id=? AND version=? AND status=?
                 AND context_resolution_status='RESOLVED'
                 AND location_id=? AND fulfillment_mode=? AND cycle_id IS ? AND zone_id=?
             )`,
          )
          .bind(
            candidate.jobBatchId,
            candidate.batchVersion,
            candidate.batchStatus,
            input.locationId,
            input.fulfillmentMode,
            input.cycleId,
            input.zoneId,
          ),
      );
    }
    statements.push(
      database
        .prepare(
          `UPDATE delivery_job
           SET batch_id=?, sequence=?, rider_id=?, rider_user_id=NULL,
               status='ASSIGNED', version=version+1, updated_at=?
           WHERE id=? AND version=? AND status=?
             AND batch_id IS ? AND sequence IS ?
             AND context_resolution_status='RESOLVED'
             AND location_id=? AND fulfillment_mode=? AND cycle_id IS ? AND zone_id=?`,
        )
        .bind(
          input.batchId,
          sequence,
          input.riderId,
          input.now,
          candidate.jobId,
          candidate.jobVersion,
          candidate.jobStatus,
          candidate.jobBatchId,
          candidate.jobSequence,
          input.locationId,
          input.fulfillmentMode,
          input.cycleId,
          input.zoneId,
        ),
      abortWhenNoChange(database),
      database
        .prepare(
          `UPDATE delivery_stop
           SET batch_id=?, sequence=?, status='ASSIGNED', version=version+1, updated_at=?
           WHERE id=? AND delivery_job_id=? AND version=? AND status=?
             AND batch_id IS ? AND sequence IS ?
             AND latitude IS ? AND longitude IS ?`,
        )
        .bind(
          input.batchId,
          sequence,
          input.now,
          candidate.stopId,
          candidate.jobId,
          candidate.stopVersion,
          candidate.stopStatus,
          candidate.stopBatchId,
          candidate.stopSequence,
          candidate.latitude,
          candidate.longitude,
        ),
      abortWhenNoChange(database),
      database
        .prepare(
          "INSERT INTO delivery_event (id, delivery_job_id, delivery_stop_id, rider_id, event_type, occurred_at, recorded_at, metadata_json, idempotency_key) VALUES (?, ?, ?, ?, 'ASSIGNED', ?, ?, ?, ?)",
        )
        .bind(
          crypto.randomUUID(),
          candidate.jobId,
          candidate.stopId,
          input.riderId,
          input.now,
          input.now,
          JSON.stringify({
            batchId: input.batchId,
            locationId: input.locationId,
            fulfillmentMode: input.fulfillmentMode,
            cycleId: input.cycleId,
            sequence,
            fromStatus: candidate.jobStatus,
            toStatus: "ASSIGNED",
          }),
          `${input.idempotencyKey}:job:${candidate.jobId}`,
        ),
    );
  });

  statements.push(
    auditEventStatement(database, {
      actorUserId: input.actorAuthUserId,
      action: "DELIVERY.BATCH_CREATED_AND_ASSIGNED",
      resourceType: "delivery_batch",
      resourceId: input.batchId,
      details: {
        actorStaffId: input.actorStaffId,
        riderId: input.riderId,
        locationId: input.locationId,
        fulfillmentMode: input.fulfillmentMode,
        cycleId: input.cycleId,
        deliveryCount: input.candidates.length,
        transitions: ["DRAFT", "READY", "ASSIGNED"],
      },
      before: { status: null },
      after: { status: "ASSIGNED", version: 3 },
      correlationId: input.requestId,
      idempotencyKey: input.idempotencyKey,
      occurredAt: input.now,
      marketId: input.marketId,
      locationId: input.locationId,
    }),
    database
      .prepare(
        "UPDATE idempotency_records SET status='SUCCEEDED', result_reference=?, updated_at=? WHERE scope='delivery.createAndAssignBatch' AND idempotency_key=? AND request_hash=? AND status='PROCESSING'",
      )
      .bind(input.batchId, input.now, input.idempotencyKey, input.requestHash),
    abortWhenNoChange(database),
  );
  await database.batch(statements);
}

export async function loadDeliveryBatchView(
  database: D1Database,
  batchId: string,
): Promise<DeliveryBatchView | null> {
  const batch = await database
    .prepare(
      `SELECT batch.id, batch.location_id, batch.fulfillment_mode, batch.cycle_id,
              batch.status, batch.version, batch.created_at, batch.dispatched_at,
              batch.completed_at, rider.id AS rider_id, rider.display_name
       FROM delivery_batch batch
       JOIN rider_identity rider ON rider.id=batch.rider_id
       WHERE batch.id=? AND batch.context_resolution_status='RESOLVED'`,
    )
    .bind(batchId)
    .first<{
      id: string;
      location_id: string;
      fulfillment_mode: FulfillmentMode;
      cycle_id: string | null;
      status: DeliveryBatchView["status"];
      version: number;
      created_at: number;
      dispatched_at: number | null;
      completed_at: number | null;
      rider_id: string;
      display_name: string;
    }>();
  if (!batch) return null;
  const deliveries = await database
    .prepare(
      `SELECT job.id AS job_id, stop.id AS stop_id, job.sequence,
              job.status, job.version
       FROM delivery_job job
       JOIN delivery_stop stop ON stop.delivery_job_id=job.id AND stop.batch_id=job.batch_id
       WHERE job.batch_id=?
       ORDER BY job.sequence ASC, job.id ASC`,
    )
    .bind(batchId)
    .all<{
      job_id: string;
      stop_id: string;
      sequence: number;
      status: DeliveryBatchView["orderedDeliveries"][number]["status"];
      version: number;
    }>();
  return {
    batchId: batch.id,
    locationId: batch.location_id,
    fulfillmentMode: batch.fulfillment_mode,
    cycleId: batch.cycle_id,
    status: batch.status,
    rider: { riderId: batch.rider_id, displayName: batch.display_name },
    orderedDeliveries: deliveries.results.map((row) => ({
      jobId: row.job_id,
      stopId: row.stop_id,
      sequence: row.sequence,
      status: row.status,
      version: row.version,
    })),
    version: batch.version,
    createdAt: new Date(batch.created_at).toISOString(),
    dispatchedAt: batch.dispatched_at === null ? null : new Date(batch.dispatched_at).toISOString(),
    completedAt: batch.completed_at === null ? null : new Date(batch.completed_at).toISOString(),
  };
}
