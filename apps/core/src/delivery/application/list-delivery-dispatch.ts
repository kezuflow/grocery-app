import type { AdminDeliveryOperationView } from "@freshmarkets/contracts";
import { manualDeliveryActions } from "../domain/manual-delivery";

type DispatchRow = {
  manualActions: AdminDeliveryOperationView["manualActions"];
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
};

/**
 * Location-scoped delivery dispatch board joined to the fulfillment record
 * that owns the location. Ordered so undelivered work surfaces first.
 */
export async function listDeliveryDispatch(
  database: D1Database,
  query: {
    locationId: string;
    cycleId?: string;
    cursorId?: string;
    limit?: number;
    actorAuthUserId?: string;
  },
): Promise<Array<DispatchRow>> {
  const limit = query.limit ?? 200;
  const clauses = ["f.location_id=?", "d.status NOT IN ('CANCELED','DELIVERED','ESCALATED')"];
  const binds: unknown[] = [query.locationId];
  if (query.cycleId) {
    clauses.push("o.cycle_id=?");
    binds.push(query.cycleId);
  }
  if (query.cursorId) {
    clauses.push("d.id<?");
    binds.push(query.cursorId);
  }
  const rows = await database
    .prepare(
      `SELECT d.id AS job_id,d.order_id,d.status,d.address_snapshot_json,
              d.delivered_at,d.version,o.cycle_id,d.fulfillment_mode,
              dispatch.id AS external_dispatch_id,dispatch.provider AS external_provider,
              dispatch.provider_delivery_id AS external_provider_delivery_id,
              dispatch.status AS external_status,dispatch.provider_status AS external_provider_status,dispatch.tracking_url AS external_tracking_url,
              dispatch.version AS external_version,dispatch.method,dispatch.manual_person_name,dispatch.manual_phone_e164,
              dispatch.manual_reason,dispatch.handed_over_at,dispatch.final_payable_minor,COALESCE(dispatch.delivery_currency,o.currency) AS delivery_currency,
              o.status AS order_status,f.status AS fulfillment_status,
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
       WHERE ${clauses.join(" AND ")} ORDER BY d.id DESC LIMIT ?`,
    )
    .bind(query.actorAuthUserId ?? null, ...binds, limit)
    .all<{
      method: string | null;
      manual_person_name: string | null;
      manual_phone_e164: string | null;
      manual_reason: string | null;
      handed_over_at: number | null;
      final_payable_minor: number | null;
      delivery_currency: string | null;
      order_status: string;
      fulfillment_status: string;
      pending_cancel: number;
      can_manage: number;
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
    }>();
  return rows.results.map((r) => ({
    manualActions: r.can_manage
      ? manualDeliveryActions({
          mode: r.fulfillment_mode,
          jobStatus: r.status,
          orderStatus: r.order_status,
          fulfillmentStatus: r.fulfillment_status,
          pendingCancellation: r.pending_cancel !== 0,
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
            reason: r.manual_reason,
            status: r.external_status,
            handedOverAt: r.handed_over_at,
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
  }));
}
