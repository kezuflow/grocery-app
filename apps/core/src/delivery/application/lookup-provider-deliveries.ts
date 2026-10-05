import type { DeliveryProvider } from "../ports/delivery-provider";
import { applyProviderObservation } from "./apply-provider-observation";

/** Bounded read repair for missing callbacks; uncertain mutations are never resubmitted. */
export async function lookupProviderDeliveries(
  database: D1Database,
  providers: ReadonlyMap<string, DeliveryProvider>,
  now: number,
) {
  const due = await database
    .prepare(`SELECT id,provider,provider_delivery_id,version,lookup_attempts FROM delivery_provider_dispatch
    WHERE method='EXTERNAL' AND provider_delivery_id IS NOT NULL AND lookup_attempts<5 AND next_lookup_at<=?
      AND (status IN ('ACTIVE','OUTCOME_UNKNOWN','RECONCILIATION_REQUIRED') OR (provider_status='COMPLETED' AND missing_delivery_proof=1))
      AND NOT EXISTS (SELECT 1 FROM delivery_provider_dispatch newer WHERE newer.delivery_job_id=delivery_provider_dispatch.delivery_job_id AND newer.attempt_sequence>delivery_provider_dispatch.attempt_sequence)
    ORDER BY next_lookup_at,id LIMIT 5`)
    .bind(now)
    .all<{
      id: string;
      provider: string;
      provider_delivery_id: string;
      version: number;
      lookup_attempts: number;
    }>();
  let applied = 0;
  let attempted = 0;
  for (const row of due.results) {
    const provider = providers.get(row.provider);
    if (!provider?.capabilities.retrieveDelivery) continue;
    const claim = await database
      .prepare(
        `UPDATE delivery_provider_dispatch SET next_lookup_at=?,lookup_attempts=lookup_attempts+1 WHERE id=? AND version=? AND lookup_attempts=? AND next_lookup_at<=? AND provider_delivery_id=?`,
      )
      .bind(
        now + 60_000 * 2 ** row.lookup_attempts,
        row.id,
        row.version,
        row.lookup_attempts,
        now,
        row.provider_delivery_id,
      )
      .run();
    if (claim.meta.changes !== 1) continue;
    attempted++;
    const result = await provider.get(row.provider_delivery_id);
    if (!result.ok || !result.value || result.value.providerDeliveryId !== row.provider_delivery_id)
      continue;
    const observation = result.value;
    const inboxId = `lookup-observation:${row.id}:${now}`;
    const raw = JSON.stringify(observation);
    const hash = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw))),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");
    await database
      .prepare(`INSERT OR IGNORE INTO delivery_provider_event_inbox(id,provider,provider_event_id,dispatch_id,provider_delivery_id,merchant_order_id,observed_at,provider_status,payload_hash,raw_payload,processing_status,received_at)
      SELECT ?,provider,?,id,provider_delivery_id,merchant_order_id,?,?,?,?, 'RECEIVED',? FROM delivery_provider_dispatch WHERE id=? AND provider_delivery_id=? AND version=?`)
      .bind(
        inboxId,
        inboxId,
        now,
        observation.status,
        hash,
        raw,
        now,
        row.id,
        row.provider_delivery_id,
        row.version,
      )
      .run();
    if (
      !(await database
        .prepare(`SELECT id FROM delivery_provider_event_inbox WHERE id=?`)
        .bind(inboxId)
        .first())
    )
      continue;
    const outcome = await applyProviderObservation(
      database,
      {
        dispatchId: row.id,
        status: observation.status,
        observedAt: now,
        trackingUrl: observation.trackingUrl,
        driverId: observation.driverId,
        resetDriver: observation.driverId === null,
        pickupPin: observation.pickupPin,
        evidence: observation.evidence,
        replacementCheck: observation.replacementCheck,
      },
      { inboxId, expectedVersion: row.version },
    );
    if (outcome.outcome === "APPLIED" || outcome.outcome === "OLDER") {
      applied++;
      // Active deliveries keep being read. Missing terminal proof has at most
      // five reads, even if the provider repeatedly returns no evidence.
      await database
        .prepare(
          `UPDATE delivery_provider_dispatch SET lookup_attempts=CASE WHEN provider_status='COMPLETED' AND missing_delivery_proof=1 THEN lookup_attempts ELSE 0 END WHERE id=? AND provider_delivery_id=? AND version=?`,
        )
        .bind(
          row.id,
          row.provider_delivery_id,
          row.version + (outcome.outcome === "APPLIED" ? 1 : 0),
        )
        .run();
    }
  }
  return { attempted, applied };
}
