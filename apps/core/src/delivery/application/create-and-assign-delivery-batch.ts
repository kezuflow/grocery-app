import type {
  AppErrorCode,
  CreateAndAssignDeliveryBatchRequest,
  DeliveryBatchView,
  RpcResult,
} from "@freshmarkets/contracts";
import { resolveOperationsAdministrationAccess } from "../../admin/application/operations-administration-access";
import { findIdempotencyRecord, requestHash } from "../../idempotency";
import {
  isAssignableDeliveryState,
  isBoundedCoordinate,
  isReusableDeliveryBatchState,
} from "../domain/delivery-assignment-policy";
import {
  commitDeliveryBatch,
  loadDeliveryAssignmentCandidates,
  loadDeliveryBatchView,
  type DeliveryAssignmentCandidate,
} from "../infrastructure/d1-delivery-dispatch-repository";
import type { DeliveryMapReadDeps } from "./get-delivery-map";

export type CreateAndAssignDeliveryBatchDeps = DeliveryMapReadDeps & {
  beforeCommit?: () => Promise<void>;
};

const SCOPE = "delivery.createAndAssignBatch";
const ROOT_KEYS = new Set([
  "headers",
  "requestId",
  "locationId",
  "fulfillmentMode",
  "cycleId",
  "riderId",
  "orderedDeliveries",
  "idempotencyKey",
]);
const ITEM_KEYS = new Set(["jobId", "expectedVersion"]);

function failure(code: AppErrorCode, message: string, requestId: string) {
  return { ok: false as const, error: { code, message, requestId } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function boundedIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 200;
}

function exactKeys(value: Record<string, unknown>, keys: Set<string>): boolean {
  return Object.keys(value).every((key) => keys.has(key));
}

export function isExactCreateAndAssignRequest(
  value: unknown,
): value is CreateAndAssignDeliveryBatchRequest {
  if (!isRecord(value) || !exactKeys(value, ROOT_KEYS)) return false;
  if (
    !boundedIdentifier(value.requestId) ||
    !boundedIdentifier(value.locationId) ||
    !boundedIdentifier(value.riderId) ||
    !boundedIdentifier(value.idempotencyKey) ||
    !isRecord(value.headers) ||
    !Object.values(value.headers).every((header) => typeof header === "string") ||
    !Array.isArray(value.orderedDeliveries) ||
    value.orderedDeliveries.length < 1 ||
    value.orderedDeliveries.length > 24
  ) {
    return false;
  }
  if (
    (value.fulfillmentMode !== "INSTANT" && value.fulfillmentMode !== "SCHEDULED") ||
    (value.fulfillmentMode === "INSTANT" && value.cycleId !== null) ||
    (value.fulfillmentMode === "SCHEDULED" && !boundedIdentifier(value.cycleId))
  ) {
    return false;
  }
  const ids = new Set<string>();
  for (const entry of value.orderedDeliveries) {
    if (
      !isRecord(entry) ||
      !exactKeys(entry, ITEM_KEYS) ||
      !boundedIdentifier(entry.jobId) ||
      !Number.isSafeInteger(entry.expectedVersion) ||
      (entry.expectedVersion as number) <= 0 ||
      ids.has(entry.jobId)
    ) {
      return false;
    }
    ids.add(entry.jobId);
  }
  return true;
}

function candidateFailure(
  candidate: DeliveryAssignmentCandidate,
  request: CreateAndAssignDeliveryBatchRequest,
): { code: AppErrorCode; message: string } | null {
  if (
    candidate.locationId !== request.locationId ||
    candidate.fulfillmentMode !== request.fulfillmentMode ||
    candidate.cycleId !== request.cycleId
  ) {
    return { code: "NOT_FOUND", message: "Delivery job is unavailable in this context" };
  }
  if (
    candidate.jobVersion !==
    request.orderedDeliveries.find((x) => x.jobId === candidate.jobId)?.expectedVersion
  )
    return { code: "STALE_VERSION", message: "Delivery job changed; refresh before assigning" };
  if (candidate.contextResolutionStatus !== "RESOLVED" || candidate.zoneId === null)
    return { code: "CONFLICT", message: "Delivery job context is unresolved" };
  if (candidate.stopId === null || candidate.stopVersion === null || candidate.stopStatus === null)
    return { code: "CONFLICT", message: "Canonical delivery stop is unavailable" };
  if (!isBoundedCoordinate(candidate.latitude, candidate.longitude))
    return { code: "VALIDATION_FAILED", message: "Delivery coordinates are unavailable" };
  if (
    !isAssignableDeliveryState(candidate.jobStatus) ||
    candidate.stopStatus !== candidate.jobStatus
  )
    return { code: "ILLEGAL_TRANSITION", message: "Delivery job is not assignable" };
  if (
    candidate.jobBatchId !== candidate.stopBatchId ||
    candidate.jobSequence !== candidate.stopSequence ||
    (candidate.jobBatchId === null) !== (candidate.jobSequence === null)
  ) {
    return { code: "CONFLICT", message: "Delivery stop assignment evidence is inconsistent" };
  }
  if (candidate.jobBatchId !== null) {
    if (
      candidate.batchResolutionStatus !== "RESOLVED" ||
      candidate.batchMode !== request.fulfillmentMode ||
      candidate.batchCycleId !== request.cycleId ||
      candidate.batchLocationId !== request.locationId ||
      candidate.batchZoneId !== candidate.zoneId
    ) {
      return { code: "CONFLICT", message: "Containing batch context is inconsistent" };
    }
    if (
      !candidate.batchStatus ||
      candidate.batchVersion === null ||
      !isReusableDeliveryBatchState(candidate.batchStatus)
    )
      return { code: "CONFLICT", message: "Delivery job has an active batch assignment" };
  }
  return null;
}

async function authoritativeReplay(
  deps: CreateAndAssignDeliveryBatchDeps,
  reference: string | null,
  requestId: string,
): Promise<RpcResult<DeliveryBatchView>> {
  if (!reference) return failure("CONFLICT", "The original command is still processing", requestId);
  const view = await loadDeliveryBatchView(deps.db, reference);
  return view
    ? { ok: true, value: view, requestId }
    : failure("INTERNAL_ERROR", "The original batch result is unavailable", requestId);
}

export async function createAndAssignDeliveryBatch(
  deps: CreateAndAssignDeliveryBatchDeps,
  request: CreateAndAssignDeliveryBatchRequest,
): Promise<RpcResult<DeliveryBatchView>> {
  const requestId =
    isRecord(request) && boundedIdentifier(request.requestId) ? request.requestId : "unknown";
  if (!isExactCreateAndAssignRequest(request))
    return failure("VALIDATION_FAILED", "Create-and-assign request is invalid", requestId);

  const access = await resolveOperationsAdministrationAccess(
    deps,
    request,
    "delivery.manage",
    request.locationId,
    { concealOutOfScopeLocation: true },
  );
  if (!access.ok) return access;

  const location = await deps.db
    .prepare("SELECT market_id FROM fulfillment_location WHERE id=? AND status='active'")
    .bind(request.locationId)
    .first<{ market_id: string }>();
  if (!location)
    return failure("NOT_FOUND", "Active fulfillment location not found", request.requestId);
  if (request.fulfillmentMode === "SCHEDULED") {
    const cycle = await deps.db
      .prepare(
        `SELECT cycle.id FROM delivery_cycle cycle
         WHERE cycle.id=? AND cycle.market_id=?
           AND EXISTS (SELECT 1 FROM cycle_zone_capacity capacity
                       WHERE capacity.cycle_id=cycle.id AND capacity.location_id=?)`,
      )
      .bind(request.cycleId, location.market_id, request.locationId)
      .first<{ id: string }>();
    if (!cycle) return failure("NOT_FOUND", "Delivery cycle is unavailable", request.requestId);
  }

  const hash = await requestHash({
    actorStaffId: access.value.staffId,
    locationId: request.locationId,
    fulfillmentMode: request.fulfillmentMode,
    cycleId: request.cycleId,
    riderId: request.riderId,
    orderedDeliveries: request.orderedDeliveries,
  });
  const prior = await findIdempotencyRecord(deps.db, SCOPE, request.idempotencyKey);
  if (prior) {
    if (prior.requestHash !== hash)
      return failure(
        "IDEMPOTENCY_CONFLICT",
        "Idempotency key was used for another request",
        request.requestId,
      );
    if (prior.status === "SUCCEEDED")
      return authoritativeReplay(deps, prior.resultReference, request.requestId);
    return failure("CONFLICT", "The original command is still processing", request.requestId);
  }

  const rider = await deps.db
    .prepare(
      "SELECT id FROM rider_identity WHERE id=? AND status='ACTIVE' AND (preferred_location_id IS NULL OR preferred_location_id=?)",
    )
    .bind(request.riderId, request.locationId)
    .first<{ id: string }>();
  if (!rider) return failure("NOT_FOUND", "Active Rider is unavailable", request.requestId);

  const ids = request.orderedDeliveries.map((entry) => entry.jobId);
  const candidatesById = await loadDeliveryAssignmentCandidates(deps.db, ids);
  const candidates: DeliveryAssignmentCandidate[] = [];
  let zoneId: string | null = null;
  for (const entry of request.orderedDeliveries) {
    const candidate = candidatesById.get(entry.jobId);
    if (!candidate)
      return failure("NOT_FOUND", "Delivery job is unavailable in this context", request.requestId);
    const invalid = candidateFailure(candidate, request);
    if (invalid) return failure(invalid.code, invalid.message, request.requestId);
    if (zoneId !== null && zoneId !== candidate.zoneId)
      return failure(
        "CONFLICT",
        "Selected deliveries do not share a delivery zone",
        request.requestId,
      );
    zoneId = candidate.zoneId;
    candidates.push(candidate);
  }
  if (!zoneId) return failure("CONFLICT", "Delivery context is incomplete", request.requestId);

  const batchId = crypto.randomUUID();
  const now = deps.now();
  try {
    await deps.beforeCommit?.();
    await commitDeliveryBatch(deps.db, {
      batchId,
      locationId: request.locationId,
      marketId: location.market_id,
      fulfillmentMode: request.fulfillmentMode,
      cycleId: request.cycleId,
      zoneId,
      riderId: request.riderId,
      actorStaffId: access.value.staffId,
      actorAuthUserId: access.value.authUserId,
      requestId: request.requestId,
      idempotencyKey: request.idempotencyKey,
      requestHash: hash,
      now,
      candidates,
    });
  } catch {
    const raced = await findIdempotencyRecord(deps.db, SCOPE, request.idempotencyKey);
    if (raced?.requestHash !== undefined && raced.requestHash !== hash)
      return failure(
        "IDEMPOTENCY_CONFLICT",
        "Idempotency key was used for another request",
        request.requestId,
      );
    if (raced?.status === "SUCCEEDED")
      return authoritativeReplay(deps, raced.resultReference, request.requestId);
    if (raced?.status === "PROCESSING")
      return failure("CONFLICT", "The original command is still processing", request.requestId);
    return failure("STALE_VERSION", "Delivery assignment changed concurrently", request.requestId);
  }
  const view = await loadDeliveryBatchView(deps.db, batchId);
  return view
    ? { ok: true, value: view, requestId: request.requestId }
    : failure("INTERNAL_ERROR", "Assigned batch could not be loaded", request.requestId);
}
