import type {
  AppErrorCode,
  DeliveryInstructions,
  DeliveryJobState,
  FulfillmentMode,
  RiderBatchList,
  RiderBatchView,
  RiderDeliveryView,
  RpcResult,
} from "@freshmarkets/contracts";

type OperationalBatchStatus = RiderBatchView["status"];

type RiderBatchRow = {
  batch_id: string;
  batch_location_id: string;
  batch_fulfillment_mode: FulfillmentMode;
  batch_cycle_id: string | null;
  batch_status: OperationalBatchStatus;
  batch_version: number;
  job_id: string;
  order_id: string;
  job_sequence: number;
  job_status: DeliveryJobState;
  job_version: number;
  stop_id: string;
  stop_sequence: number;
  stop_status: DeliveryJobState;
  stop_version: number;
  latitude: number | null;
  longitude: number | null;
  address_snapshot_json: string;
  contact_snapshot_json: string;
  instructions_snapshot: string | null;
};

function failure(code: AppErrorCode, message: string, requestId: string) {
  return { ok: false as const, error: { code, message, requestId } };
}

function parseObject(value: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function nestedObject(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") return parseObject(value);
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringField(record: Record<string, unknown> | null, key: string): string | null {
  const value = record?.[key];
  return typeof value === "string" ? value : null;
}

function nullableString(value: unknown): string | null | undefined {
  return value === null || value === undefined
    ? null
    : typeof value === "string"
      ? value
      : undefined;
}

function parseInstructions(value: string | null): DeliveryInstructions | null {
  if (value === null) {
    return {
      buildingUnit: null,
      landmark: null,
      gateGuard: null,
      deliveryNote: null,
      recipientInstruction: null,
    };
  }
  const parsed = parseObject(value);
  if (!parsed) return null;
  const instructions = {
    buildingUnit: nullableString(parsed.buildingUnit),
    landmark: nullableString(parsed.landmark),
    gateGuard: nullableString(parsed.gateGuard),
    deliveryNote: nullableString(parsed.deliveryNote),
    recipientInstruction: nullableString(parsed.recipientInstruction),
  };
  if (Object.values(instructions).some((item) => item === undefined)) return null;
  return instructions as DeliveryInstructions;
}

function displayAddress(snapshot: Record<string, unknown>): string | null {
  const structuredCandidate = nestedObject(snapshot.address_components_json);
  const structured =
    typeof structuredCandidate?.addressLine1 === "string" &&
    typeof structuredCandidate.city === "string" &&
    typeof structuredCandidate.countryCode === "string"
      ? structuredCandidate
      : null;
  const legacy = nestedObject(snapshot.address_json);
  const source = structured ?? legacy;
  if (!source) return null;
  const addressLine1 = stringField(source, "addressLine1") ?? stringField(source, "line1") ?? "";
  const city = stringField(source, "city") ?? addressLine1;
  const components = {
    addressLine1,
    addressLine2: stringField(source, "addressLine2") ?? stringField(source, "line2"),
    barangay: stringField(source, "barangay"),
    city,
    region: stringField(source, "region"),
    postalCode: stringField(source, "postalCode"),
    countryCode: stringField(source, "countryCode") ?? (structured ? null : "PH"),
  };
  if (!components.addressLine1 && !components.city) return null;
  return Object.values(components)
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(", ");
}

function riderActions(status: DeliveryJobState): RiderDeliveryView["allowedActions"] {
  switch (status) {
    case "ASSIGNED":
      return ["MARK_EN_ROUTE"];
    case "EN_ROUTE":
      return ["MARK_ARRIVED"];
    case "ARRIVED":
      return ["MARK_DELIVERED", "MARK_FAILED"];
    default:
      return [];
  }
}

function isFinished(status: DeliveryJobState): boolean {
  return status === "DELIVERED" || status === "CANCELED" || status === "ESCALATED";
}

function projectDelivery(row: RiderBatchRow): RiderDeliveryView | null {
  if (row.job_sequence !== row.stop_sequence || row.job_status !== row.stop_status) return null;
  const address = parseObject(row.address_snapshot_json);
  const contact = parseObject(row.contact_snapshot_json);
  const instructions = parseInstructions(row.instructions_snapshot);
  const formattedAddress = address ? displayAddress(address) : null;
  const recipient = contact ? nullableString(contact.recipient) : undefined;
  const phone = contact ? nullableString(contact.phone) : undefined;
  if (!formattedAddress || !recipient || !phone || !instructions) return null;
  return {
    jobId: row.job_id,
    stopId: row.stop_id,
    orderId: row.order_id,
    sequence: row.job_sequence,
    status: row.job_status,
    destination: {
      coordinate:
        row.latitude === null || row.longitude === null
          ? null
          : { latitude: row.latitude, longitude: row.longitude },
      displayAddress: formattedAddress,
      recipient,
      phone,
      instructions,
    },
    jobVersion: row.job_version,
    stopVersion: row.stop_version,
    allowedActions: [],
  };
}

export async function getRiderBatches(
  database: D1Database,
  query: { riderAuthUserId: string; requestId: string },
): Promise<RpcResult<RiderBatchList>> {
  const rider = await database
    .prepare("SELECT id FROM rider_identity WHERE auth_user_id=? AND status='ACTIVE'")
    .bind(query.riderAuthUserId)
    .first<{ id: string }>();
  if (!rider) return failure("FORBIDDEN", "An active Rider identity is required", query.requestId);

  const rows = await database
    .prepare(
      `SELECT batch.id AS batch_id, batch.location_id AS batch_location_id,
              batch.fulfillment_mode AS batch_fulfillment_mode,
              batch.cycle_id AS batch_cycle_id, batch.status AS batch_status,
              batch.version AS batch_version, job.id AS job_id, job.order_id,
              job.sequence AS job_sequence, job.status AS job_status,
              job.version AS job_version, stop.id AS stop_id,
              stop.sequence AS stop_sequence, stop.status AS stop_status,
              stop.version AS stop_version, stop.latitude, stop.longitude,
              stop.address_snapshot_json, stop.contact_snapshot_json,
              stop.instructions_snapshot
       FROM delivery_batch batch
       JOIN delivery_job job ON job.batch_id=batch.id
         AND job.rider_id=batch.rider_id
         AND job.location_id=batch.location_id
         AND job.zone_id=batch.zone_id
         AND job.fulfillment_mode=batch.fulfillment_mode
         AND ((batch.fulfillment_mode='INSTANT' AND batch.cycle_id IS NULL AND job.cycle_id IS NULL)
           OR (batch.fulfillment_mode='SCHEDULED' AND batch.cycle_id IS NOT NULL AND job.cycle_id=batch.cycle_id))
         AND job.context_resolution_status='RESOLVED'
       JOIN delivery_stop stop ON stop.delivery_job_id=job.id
         AND stop.batch_id=batch.id AND stop.sequence=job.sequence
       WHERE batch.rider_id=?
         AND batch.status IN ('ASSIGNED','DISPATCHED','IN_PROGRESS','EXCEPTION')
         AND batch.context_resolution_status='RESOLVED'
         AND NOT EXISTS (
           SELECT 1 FROM delivery_job batch_job
           WHERE batch_job.batch_id=batch.id AND (
             batch_job.rider_id IS NOT batch.rider_id
             OR batch_job.location_id IS NOT batch.location_id
             OR batch_job.zone_id IS NOT batch.zone_id
             OR batch_job.fulfillment_mode IS NOT batch.fulfillment_mode
             OR batch_job.context_resolution_status<>'RESOLVED'
             OR (batch.fulfillment_mode='INSTANT' AND batch_job.cycle_id IS NOT NULL)
             OR (batch.fulfillment_mode='SCHEDULED'
               AND (batch.cycle_id IS NULL OR batch_job.cycle_id IS NOT batch.cycle_id))
             OR NOT EXISTS (
               SELECT 1 FROM delivery_stop batch_stop
               WHERE batch_stop.delivery_job_id=batch_job.id
                 AND batch_stop.batch_id=batch.id
                 AND batch_stop.sequence=batch_job.sequence
                 AND batch_stop.status=batch_job.status
             )
           )
         )
         AND NOT EXISTS (
           SELECT 1
           FROM delivery_stop claimed_stop
           JOIN delivery_job claimed_job ON claimed_job.id=claimed_stop.delivery_job_id
           WHERE claimed_stop.batch_id=batch.id AND (
             claimed_job.batch_id IS NOT batch.id
             OR claimed_stop.sequence IS NOT claimed_job.sequence
             OR claimed_stop.status IS NOT claimed_job.status
             OR claimed_job.rider_id IS NOT batch.rider_id
             OR claimed_job.location_id IS NOT batch.location_id
             OR claimed_job.zone_id IS NOT batch.zone_id
             OR claimed_job.fulfillment_mode IS NOT batch.fulfillment_mode
             OR claimed_job.context_resolution_status<>'RESOLVED'
             OR (batch.fulfillment_mode='INSTANT' AND claimed_job.cycle_id IS NOT NULL)
             OR (batch.fulfillment_mode='SCHEDULED'
               AND (batch.cycle_id IS NULL OR claimed_job.cycle_id IS NOT batch.cycle_id))
           )
         )
       ORDER BY batch.created_at, batch.id, stop.sequence, job.id`,
    )
    .bind(rider.id)
    .all<RiderBatchRow>();

  const grouped = new Map<string, { row: RiderBatchRow; deliveries: RiderDeliveryView[] }>();
  for (const row of rows.results) {
    const delivery = projectDelivery(row);
    if (!delivery)
      return failure("INTERNAL_ERROR", "Delivery details are unavailable", query.requestId);
    const existing = grouped.get(row.batch_id);
    if (existing) existing.deliveries.push(delivery);
    else grouped.set(row.batch_id, { row, deliveries: [delivery] });
  }

  const batches: RiderBatchView[] = [];
  for (const { row, deliveries } of grouped.values()) {
    const unfinished = deliveries.filter((delivery) => !isFinished(delivery.status));
    const current = unfinished[0] ?? null;
    if (current) current.allowedActions = riderActions(current.status);
    const common = {
      batchId: row.batch_id,
      locationId: row.batch_location_id,
      status: row.batch_status,
      version: row.batch_version,
      currentDelivery: current,
      upcomingDeliveries: unfinished.slice(1),
    };
    batches.push(
      row.batch_fulfillment_mode === "INSTANT"
        ? { ...common, fulfillmentMode: "INSTANT", cycleId: null }
        : { ...common, fulfillmentMode: "SCHEDULED", cycleId: row.batch_cycle_id as string },
    );
  }
  return { ok: true, value: { batches }, requestId: query.requestId };
}
