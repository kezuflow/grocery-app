import type { AdminDeliveryOperationView } from "@freshmarkets/contracts";
import { manualDeliveryActions } from "../domain/manual-delivery";
import { deliveryRetryReadySql, returnedDeliveryInspectionSql } from "./delivery-retry-readiness";
import {
  dispatchUnavailableMessage,
  firstDispatchEligibility,
} from "../domain/dispatch-eligibility";

type DispatchRow = {
  manualActions: AdminDeliveryOperationView["manualActions"];
  canRevisePromise: boolean;
  canInspectReturnedGoods: boolean;
  courierPickup: AdminDeliveryOperationView["courierPickup"];
  manualDelivery: AdminDeliveryOperationView["manualDelivery"];
  jobId: string;
  orderId: string;
  status: string;
  deliveredAtIso: string | null;
  version: number;
  cycleId: string | null;
  fulfillmentMode: "INSTANT" | "SCHEDULED";
  addressSnapshotJson: string;
  externalProvider: "lalamove" | "grab-express" | null;
  externalProviderDeliveryId: string | null;
  externalDispatchId: string | null;
  externalStatus: string | null;
  externalProviderStatus: string | null;
  externalTrackingUrl: string | null;
  externalVersion: number | null;
  sortAt: number;
};

function courierPickupDecision(row: {
  fulfillment_mode: string;
  status: string;
  can_manage: number;
  pending_cancel: number;
  external_status: string | null;
  pickup_deadline: number | null;
  fulfillment_status: string;
  order_status: string;
  retry_ready: number;
  promised_at: number | null;
}): AdminDeliveryOperationView["courierPickup"] {
  const eligibility = firstDispatchEligibility({
    canManage: Boolean(row.can_manage),
    jobStatus: row.status,
    orderStatus: row.order_status,
    fulfillmentStatus: row.fulfillment_status,
    pendingCancellation: Boolean(row.pending_cancel),
    latestAttempt: row.external_status === null ? null : { status: row.external_status },
    retryReady: Boolean(row.retry_ready),
    deliveryDeadline: row.fulfillment_mode === "INSTANT" ? row.promised_at : row.pickup_deadline,
    now: Date.now(),
  });
  if (!eligibility.eligible)
    return { allowedKinds: [], unavailableReason: dispatchUnavailableMessage(eligibility) };
  return {
    allowedKinds: row.fulfillment_mode === "INSTANT" ? ["IMMEDIATE"] : ["IMMEDIATE", "SCHEDULED"],
    unavailableReason: null,
  };
}

/**
 * Location-scoped delivery dispatch board joined to the fulfillment record
 * that owns the location. Ordered so undelivered work surfaces first.
 */
export async function listDeliveryDispatch(
  database: D1Database,
  query: {
    locationId: string;
    orderId?: string;
    cycleId?: string;
    cursor?: { createdAt: number; id: string };
    limit?: number;
    actorAuthUserId?: string;
  },
): Promise<Array<DispatchRow>> {
  const limit = query.limit ?? 200;
  const clauses = ["f.location_id=?"];
  const binds: unknown[] = [query.locationId];
  if (query.orderId) {
    clauses.push("o.id=?");
    binds.push(query.orderId);
  } else clauses.push("d.status NOT IN ('CANCELED','DELIVERED','ESCALATED')");
  if (query.cycleId) {
    clauses.push("o.cycle_id=?");
    binds.push(query.cycleId);
  }
  if (query.cursor) {
    clauses.push("(d.created_at<? OR (d.created_at=? AND d.id<?))");
    binds.push(query.cursor.createdAt, query.cursor.createdAt, query.cursor.id);
  }
  const rows = await database
    .prepare(
      `SELECT d.id AS job_id,d.order_id,d.status,d.address_snapshot_json,d.created_at AS sort_at,
              d.delivered_at,d.version,o.cycle_id,d.fulfillment_mode,
              dispatch.id AS external_dispatch_id,dispatch.provider AS external_provider,
              dispatch.provider_delivery_id AS external_provider_delivery_id,
              dispatch.status AS external_status,dispatch.provider_status AS external_provider_status,dispatch.tracking_url AS external_tracking_url,
              dispatch.version AS external_version,dispatch.method,dispatch.manual_person_name,dispatch.manual_phone_e164,
              dispatch.manual_reason,json_extract(dispatch.request_snapshot_json,'$.note') AS manual_note,
              dispatch.handed_over_at,dispatch.final_payable_minor,COALESCE(dispatch.delivery_currency,o.currency) AS delivery_currency,
              o.status AS order_status,f.status AS fulfillment_status,d.promised_at,
              EXISTS (SELECT 1 FROM delivery_job job WHERE job.id=d.id AND ${deliveryRetryReadySql}) AS retry_ready,
              EXISTS (SELECT 1 FROM delivery_job job WHERE job.id=d.id AND ${returnedDeliveryInspectionSql}) AS return_eligible,
              (SELECT MAX(revision.return_inspected_at) FROM delivery_promise_revision revision WHERE revision.dispatch_id=dispatch.id) AS returned_goods_inspected,
              (SELECT COALESCE((SELECT revision.promised_at FROM delivery_promise_revision revision WHERE revision.delivery_job_id=d.id ORDER BY revision.job_version DESC LIMIT 1),delivery_window.ends_at,snapshot.delivery_date) FROM order_fulfillment_snapshot snapshot
                LEFT JOIN order_delivery_window_snapshot delivery_window ON delivery_window.order_id=snapshot.order_id WHERE snapshot.order_id=o.id) AS pickup_deadline,
              EXISTS (SELECT 1 FROM delivery_provider_command c JOIN delivery_provider_dispatch p ON p.id=c.dispatch_id
                WHERE p.delivery_job_id=d.id AND c.operation='CANCEL' AND c.status IN ('SUBMITTING','OUTCOME_UNKNOWN','OBSERVED')) AS pending_cancel,
              EXISTS (SELECT 1 FROM staff_identity s JOIN staff_role sr ON sr.staff_id=s.id JOIN role_permission rp ON rp.role_id=sr.role_id
                JOIN permission permission ON permission.id=rp.permission_id WHERE s.auth_user_id=? AND s.status='active' AND permission.code='delivery.manage') AS can_manage
       FROM delivery_job d JOIN fulfillment_record f ON f.order_id=d.order_id
       LEFT JOIN grocery_order o ON o.id=d.order_id
       LEFT JOIN delivery_provider_dispatch dispatch ON dispatch.id=(
         SELECT latest.id FROM delivery_provider_dispatch latest WHERE latest.delivery_job_id=d.id
         ORDER BY latest.attempt_sequence DESC LIMIT 1
       )
       WHERE ${clauses.join(" AND ")} ORDER BY d.created_at DESC,d.id DESC LIMIT ?`,
    )
    .bind(query.actorAuthUserId ?? null, ...binds, limit)
    .all<{
      method: string | null;
      manual_person_name: string | null;
      manual_phone_e164: string | null;
      manual_reason: string | null;
      manual_note: string | null;
      handed_over_at: number | null;
      final_payable_minor: number | null;
      delivery_currency: string | null;
      order_status: string;
      retry_ready: number;
      return_eligible: number;
      returned_goods_inspected: number | null;
      promised_at: number | null;
      fulfillment_status: string;
      pending_cancel: number;
      can_manage: number;
      pickup_deadline: number | null;
      job_id: string;
      order_id: string;
      status: string;
      address_snapshot_json: string;
      delivered_at: number | null;
      version: number;
      cycle_id: string | null;
      fulfillment_mode: "INSTANT" | "SCHEDULED";
      external_provider: "lalamove" | "grab-express" | null;
      external_provider_delivery_id: string | null;
      external_dispatch_id: string | null;
      external_status: string | null;
      external_provider_status: string | null;
      external_tracking_url: string | null;
      external_version: number | null;
      sort_at: number;
    }>();
  return rows.results.map((r) => ({
    courierPickup: courierPickupDecision(r),
    canRevisePromise: Boolean(r.can_manage && r.retry_ready),
    canInspectReturnedGoods: Boolean(r.can_manage && r.return_eligible),
    manualActions: r.can_manage
      ? manualDeliveryActions({
          mode: r.fulfillment_mode,
          returnedGoodsInspected: Boolean(r.returned_goods_inspected),
          jobStatus: r.status,
          orderStatus: r.order_status,
          fulfillmentStatus: r.fulfillment_status,
          pendingCancellation: r.pending_cancel !== 0,
          retryReady: Boolean(r.retry_ready),
          deliveryDeadline: r.fulfillment_mode === "INSTANT" ? r.promised_at : r.pickup_deadline,
          now: Date.now(),
          attempt:
            r.method && r.external_status
              ? { method: r.method, status: r.external_status, handedOverAt: r.handed_over_at }
              : null,
        })
      : [],
    manualDelivery:
      r.method === "MANUAL" &&
      r.external_dispatch_id &&
      r.manual_person_name &&
      r.manual_phone_e164 &&
      r.manual_reason &&
      r.external_status &&
      r.external_version
        ? {
            dispatchId: r.external_dispatch_id,
            personName: r.manual_person_name,
            phoneE164: r.manual_phone_e164,
            selectionReason: r.manual_reason,
            note: r.manual_note,
            status: r.external_status,
            handedOverAt: r.handed_over_at,
            returnInspectedAt: r.returned_goods_inspected,
            actualCostMinor: r.final_payable_minor,
            currency: r.delivery_currency,
            version: r.external_version,
          }
        : null,
    jobId: r.job_id,
    orderId: r.order_id,
    status: r.status,
    addressSnapshotJson: r.address_snapshot_json,
    deliveredAtIso: r.delivered_at === null ? null : new Date(r.delivered_at).toISOString(),
    version: r.version,
    cycleId: r.cycle_id,
    fulfillmentMode: r.fulfillment_mode,
    externalProvider: r.external_provider,
    externalDispatchId: r.external_dispatch_id,
    externalProviderDeliveryId: r.external_provider_delivery_id,
    externalStatus: r.external_status,
    externalProviderStatus: r.external_provider_status,
    externalTrackingUrl: r.external_tracking_url,
    externalVersion: r.external_version,
    sortAt: r.sort_at,
  }));
}
