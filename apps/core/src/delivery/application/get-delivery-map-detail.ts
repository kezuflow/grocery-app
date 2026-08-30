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
  resolveDeliveryReadContext,
  type DeliveryMapReadDeps,
} from "./get-delivery-map";

type DetailRow = {
  job_id: string;
  order_id: string;
  batch_id: string | null;
  fulfillment_mode: FulfillmentMode;
  cycle_id: string | null;
  location_id: string;
  status: DeliveryJobState;
  context_resolution_status: "RESOLVED" | "LEGACY_UNRESOLVED";
  version: number;
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
  const raw = snapshot.address_components_json;
  const components =
    typeof raw === "string"
      ? parseObject(raw)
      : raw !== null && typeof raw === "object" && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : null;
  if (!components) return null;
  const keys = [
    "addressLine1",
    "addressLine2",
    "barangay",
    "city",
    "region",
    "postalCode",
    "countryCode",
  ] as const;
  const values: string[] = [];
  for (const key of keys) {
    const value = components[key];
    if (value === null || value === undefined || value === "") continue;
    if (typeof value !== "string") return null;
    values.push(value);
  }
  return values.length > 0 ? values.join(", ") : null;
}

export async function getDeliveryMapDetail(
  deps: DeliveryMapReadDeps,
  request: DeliveryMapDetailRequest,
): Promise<RpcResult<DeliveryMapDetail>> {
  if (!Number.isInteger(request.expectedVersion) || request.expectedVersion <= 0) {
    return failure(
      "VALIDATION_FAILED",
      "A positive expected version is required",
      request.requestId,
    );
  }
  const context = await resolveDeliveryReadContext(deps, request);
  if (!context.ok) return context;
  const row = await deps.db
    .prepare(
      `SELECT job.id AS job_id, job.order_id, job.batch_id, job.fulfillment_mode,
              job.cycle_id, job.location_id, job.status, job.context_resolution_status,
              job.version, stop.latitude, stop.longitude, stop.address_snapshot_json,
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
      orderNumber: row.order_id,
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
