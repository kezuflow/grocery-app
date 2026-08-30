import type {
  AppErrorCode,
  DeliveryInstructions,
  DeliveryJobState,
  DeliveryMapDetail,
  DeliveryMapDetailRequest,
  FulfillmentMode,
  RpcResult,
} from "@freshmarkets/contracts";
import { resolveOperationsAdministrationAccess } from "../../admin/application/operations-administration-access";
import {
  deriveDeliverySelection,
  deliveryReadRequestId,
  resolveDeliveryReadContext,
  type DeliveryMapReadDeps,
} from "./get-delivery-map";

type DetailRow = {
  job_id: string;
  order_id: string;
  batch_id: string | null;
  job_sequence: number | null;
  fulfillment_mode: FulfillmentMode;
  cycle_id: string | null;
  location_id: string;
  status: DeliveryJobState;
  context_resolution_status: "RESOLVED" | "LEGACY_UNRESOLVED";
  version: number;
  stop_id: string | null;
  stop_status: DeliveryJobState | null;
  stop_batch_id: string | null;
  stop_sequence: number | null;
  stop_version: number | null;
  latitude: number | null;
  longitude: number | null;
  address_snapshot_json: string;
  contact_snapshot_json: string;
  instructions_snapshot: string | null;
  batch_fulfillment_mode: FulfillmentMode | null;
  batch_cycle_id: string | null;
  batch_location_id: string | null;
  batch_status: string | null;
  batch_context_resolution_status: "RESOLVED" | "LEGACY_UNRESOLVED" | null;
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
  if (value === null)
    return {
      buildingUnit: null,
      landmark: null,
      gateGuard: null,
      deliveryNote: null,
      recipientInstruction: null,
    };
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

export async function getDeliveryMapDetail(
  deps: DeliveryMapReadDeps,
  request: DeliveryMapDetailRequest,
): Promise<RpcResult<DeliveryMapDetail>> {
  const requestId = deliveryReadRequestId(request);
  if (
    request === null ||
    typeof request !== "object" ||
    Array.isArray(request) ||
    typeof request.jobId !== "string" ||
    request.jobId.trim().length === 0 ||
    !Number.isInteger(request.expectedVersion) ||
    request.expectedVersion <= 0
  ) {
    return failure("VALIDATION_FAILED", "A positive expected version is required", requestId);
  }
  const context = await resolveDeliveryReadContext(deps, request);
  if (!context.ok) return context;
  const row = await deps.db
    .prepare(
      `SELECT job.id AS job_id, job.order_id, job.batch_id, job.sequence AS job_sequence, job.fulfillment_mode,
              job.cycle_id, job.location_id, job.status, job.context_resolution_status,
              job.version, stop.id AS stop_id, stop.status AS stop_status,
              stop.batch_id AS stop_batch_id, stop.sequence AS stop_sequence,
              stop.version AS stop_version, stop.latitude, stop.longitude, stop.address_snapshot_json,
              stop.contact_snapshot_json, stop.instructions_snapshot,
              batch.fulfillment_mode AS batch_fulfillment_mode,
              batch.cycle_id AS batch_cycle_id, batch.location_id AS batch_location_id,
              batch.status AS batch_status,
              batch.context_resolution_status AS batch_context_resolution_status
       FROM delivery_job job
       JOIN delivery_stop stop ON stop.delivery_job_id=job.id
       LEFT JOIN delivery_batch batch ON batch.id=job.batch_id
       WHERE job.id=? AND job.location_id=? AND job.fulfillment_mode=?
         AND ${request.fulfillmentMode === "INSTANT" ? "job.cycle_id IS NULL" : "job.cycle_id=?"}
         AND job.status NOT IN ('DELIVERED','CANCELED')`,
    )
    .bind(
      request.jobId,
      request.locationId,
      request.fulfillmentMode,
      ...(request.fulfillmentMode === "SCHEDULED" ? [request.cycleId] : []),
    )
    .first<DetailRow>();
  if (!row) return failure("NOT_FOUND", "Open delivery job not found", request.requestId);
  if (row.version !== request.expectedVersion)
    return failure(
      "STALE_VERSION",
      "Delivery job changed; refresh before retrying",
      request.requestId,
    );

  const address = parseObject(row.address_snapshot_json);
  const contact = parseObject(row.contact_snapshot_json);
  const instructions = parseInstructions(row.instructions_snapshot);
  const recipient = contact ? nullableString(contact.recipient) : undefined;
  const phone = contact ? nullableString(contact.phone) : undefined;
  const formattedAddress = address ? displayAddress(address) : null;
  if (!address || !contact || !formattedAddress || !recipient || !phone || !instructions) {
    return failure("INTERNAL_ERROR", "Delivery details are unavailable", request.requestId);
  }

  const selection = deriveDeliverySelection(row, context.value);
  const manageAccess = selection.selectable
    ? await resolveOperationsAdministrationAccess(
        deps,
        request,
        "delivery.manage",
        request.locationId,
      )
    : null;
  return {
    ok: true,
    value: {
      jobId: row.job_id,
      orderId: row.order_id,
      orderNumber: null,
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
      status: row.status,
      version: row.version,
      allowedActions: manageAccess?.ok ? ["CREATE_AND_ASSIGN_BATCH"] : [],
    },
    requestId: request.requestId,
  };
}
