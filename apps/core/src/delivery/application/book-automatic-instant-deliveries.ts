import { z } from "@freshmarkets/validation";
import type { DeliveryProvider } from "../ports/delivery-provider";
import { bookOrderDelivery } from "./book-order-delivery";

const selection = z.object({
  providerCode: z.literal("lalamove"),
  providerServiceType: z.string().min(1),
});

/** Packing plus an unbooked delivery job is the durable first-booking intent.
 * Never creates a replacement for an existing submitted/uncertain/closed attempt.
 */
export async function bookAutomaticInstantDeliveries(
  database: D1Database,
  providers: () => ReadonlyMap<string, DeliveryProvider>,
  now: number,
  orderId?: string,
) {
  const rows = await database
    .prepare(`SELECT job.id,job.order_id,job.location_id,job.version,
      snapshot.delivery_execution_snapshot_json selection
    FROM delivery_job job JOIN grocery_order grocery ON grocery.id=job.order_id
    JOIN fulfillment_record fulfillment ON fulfillment.order_id=grocery.id
    JOIN order_fulfillment_snapshot snapshot ON snapshot.order_id=grocery.id
    WHERE job.fulfillment_mode='INSTANT' AND job.status='UNASSIGNED'
      AND fulfillment.status IN ('PACKING','PACKED') AND fulfillment.location_id=job.location_id
      AND grocery.status IN ('FULFILLMENT_PENDING','FULFILLMENT_READY')
      AND (? IS NULL OR grocery.id=?)
      AND NOT EXISTS (SELECT 1 FROM delivery_provider_dispatch dispatch WHERE dispatch.delivery_job_id=job.id
        AND (dispatch.status!='PENDING' OR dispatch.client_idempotency_key!='auto-book:'||job.id OR dispatch.client_idempotency_key IS NULL))
      AND NOT EXISTS (SELECT 1 FROM idempotency_records command WHERE command.scope='admin.delivery.externalDispatch'
        AND command.idempotency_key='auto-book:'||job.id AND command.status!='PROCESSING')
    ORDER BY fulfillment.updated_at,job.id LIMIT 25`)
    .bind(orderId ?? null, orderId ?? null)
    .all<{
      id: string;
      order_id: string;
      location_id: string;
      version: number;
      selection: string | null;
    }>();
  let submitted = 0,
    deferred = 0;
  for (const row of rows.results) {
    let chosen: z.infer<typeof selection>;
    let provider: DeliveryProvider | undefined;
    try {
      chosen = selection.parse(JSON.parse(row.selection ?? "null"));
      provider = providers().get(chosen.providerCode);
    } catch {
      deferred += 1;
      continue;
    }
    if (!provider) {
      deferred += 1;
      continue;
    }
    const result = await bookOrderDelivery(
      { db: database, provider, configuredServiceType: chosen.providerServiceType, now: () => now },
      {
        requestId: `auto-book:${row.id}`,
        headers: {},
        locationId: row.location_id,
        jobId: row.id,
        expectedVersion: row.version,
        providerCode: chosen.providerCode,
        pickup: { kind: "IMMEDIATE" },
        idempotencyKey: `auto-book:${row.id}`,
      },
      null,
    );
    if (result.ok) submitted += 1;
    else deferred += 1;
  }
  return { attempted: rows.results.length, submitted, deferred };
}
