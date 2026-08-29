import { applyD1Migrations, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const migrationName = "0043_delivery_batches_and_map_stops.sql";
const scheduledAddress =
  '{"recipient":"Ana Scheduled","phone":"09170000001","latitude":10.3157,"longitude":123.8854,"delivery_instructions_json":"{\\"gateGuard\\":\\"Call guard\\"}","address_json":"{\\"line1\\":\\"Scheduled legacy\\"}"}';
const instantAddress =
  '{"recipient":"Ian Instant","phone":"09170000002","latitude":10.3171,"longitude":123.8891,"delivery_instructions_json":"{\\"landmark\\":\\"Blue gate\\"}","address_json":"{\\"line1\\":\\"Instant legacy\\"}"}';
const deliveredAddress =
  '{"recipient":"Dina Delivered","phone":"09170000003","latitude":10.3192,"longitude":123.8922,"delivery_instructions_json":"{\\"deliveryNote\\":\\"Leave with recipient\\"}","address_json":"{\\"line1\\":\\"Delivered legacy\\"}"}';
const proofJson =
  '{"deliveredAt":1700000000400,"riderUserId":"auth-rider-legacy","legacy":"byte-preserved"}';
const eventJson = '{"from":"ARRIVED","to":"DELIVERED","source":"legacy-domain-event"}';

async function rejects(sql: string, bindings: readonly unknown[] = []): Promise<void> {
  let rejected = false;
  try {
    await env.DB.prepare(sql)
      .bind(...bindings)
      .run();
  } catch {
    rejected = true;
  }
  expect(rejected).toBe(true);
}

async function seedPre0043CompatibilityRows(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES ('auth-rider-legacy', 'Legacy Rider', 'legacy-rider@example.com', 1, 100, 100)",
    ),
    env.DB.prepare(
      "INSERT INTO staff_identity (id, auth_user_id, display_name, status, created_at, updated_at, version) VALUES ('staff-rider-legacy', 'auth-rider-legacy', 'Legacy Rider', 'active', 100, 110, 4)",
    ),
    env.DB.prepare(
      "INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES ('auth-delivery-customer', 'Delivery Customer', 'delivery-customer@example.com', 1, 100, 100)",
    ),
    env.DB.prepare(
      "INSERT INTO customer (id, auth_user_id, status, version, created_at, updated_at) VALUES ('customer-delivery-map', 'auth-delivery-customer', 'active', 2, 100, 110)",
    ),
    ...["scheduled", "instant", "delivered"].map((kind, index) =>
      env.DB.prepare(
        "INSERT INTO payment_attempt (id, customer_id, amount_minor, currency, status, provider, idempotency_key, created_at, updated_at, version) VALUES (?, 'customer-delivery-map', 25000, 'PHP', 'SUCCEEDED', 'mock', ?, ?, ?, 1)",
      ).bind(`payment-delivery-${kind}`, `payment-delivery-${kind}-key`, 200 + index, 200 + index),
    ),
    env.DB.prepare(
      "INSERT INTO grocery_order (id, customer_id, cycle_id, fulfillment_mode, address_snapshot_json, status, total_minor, currency, payment_id, version, created_at) VALUES ('order-delivery-scheduled', 'customer-delivery-map', 'cycle-next-cebu', 'SCHEDULED', ?, 'COMMITTED', 25000, 'PHP', 'payment-delivery-scheduled', 7, 200)",
    ).bind(scheduledAddress),
    env.DB.prepare(
      "INSERT INTO grocery_order (id, customer_id, cycle_id, fulfillment_mode, address_snapshot_json, status, total_minor, currency, payment_id, version, created_at) VALUES ('order-delivery-instant', 'customer-delivery-map', NULL, 'INSTANT', ?, 'COMMITTED', 25000, 'PHP', 'payment-delivery-instant', 5, 201)",
    ).bind(instantAddress),
    env.DB.prepare(
      "INSERT INTO grocery_order (id, customer_id, cycle_id, fulfillment_mode, address_snapshot_json, status, total_minor, currency, payment_id, version, created_at) VALUES ('order-delivery-delivered', 'customer-delivery-map', 'cycle-next-cebu', 'SCHEDULED', ?, 'DELIVERED', 25000, 'PHP', 'payment-delivery-delivered', 9, 202)",
    ).bind(deliveredAddress),
    env.DB.prepare(
      "INSERT INTO order_fulfillment_snapshot (order_id, location_id, cycle_id, zone_id, cutoff_at, delivery_date, promised_at, fulfillment_mode, sourcing_modes_json, created_at) VALUES ('order-delivery-scheduled', 'location-cebu-central', 'cycle-next-cebu', 'zone-cebu-city-core', 300, 400, 390, 'SCHEDULED', '[\"PLANNED\"]', 200)",
    ),
    env.DB.prepare(
      "INSERT INTO order_fulfillment_snapshot (order_id, location_id, cycle_id, zone_id, cutoff_at, delivery_date, promised_at, fulfillment_mode, sourcing_modes_json, created_at) VALUES ('order-delivery-instant', 'location-cebu-central', NULL, 'zone-cebu-city-core', NULL, NULL, 260, 'INSTANT', '[\"STOCKED\"]', 201)",
    ),
    env.DB.prepare(
      "INSERT INTO order_fulfillment_snapshot (order_id, location_id, cycle_id, zone_id, cutoff_at, delivery_date, promised_at, fulfillment_mode, sourcing_modes_json, created_at) VALUES ('order-delivery-delivered', 'location-cebu-central', 'cycle-next-cebu', 'zone-cebu-city-core', 300, 400, 390, 'SCHEDULED', '[\"PLANNED\"]', 202)",
    ),
    env.DB.prepare(
      "INSERT INTO delivery_job (id, order_id, cycle_id, fulfillment_mode, rider_user_id, status, address_snapshot_json, delivered_at, version, created_at, updated_at) VALUES ('job-delivery-scheduled', 'order-delivery-scheduled', 'cycle-next-cebu', 'SCHEDULED', NULL, 'UNASSIGNED', ?, NULL, 7, 200, 210)",
    ).bind(scheduledAddress),
    env.DB.prepare(
      "INSERT INTO delivery_job (id, order_id, cycle_id, fulfillment_mode, rider_user_id, status, address_snapshot_json, delivered_at, version, created_at, updated_at) VALUES ('job-delivery-instant', 'order-delivery-instant', NULL, 'INSTANT', NULL, 'UNASSIGNED', ?, NULL, 5, 201, 211)",
    ).bind(instantAddress),
    env.DB.prepare(
      "INSERT INTO delivery_job (id, order_id, cycle_id, fulfillment_mode, rider_user_id, status, address_snapshot_json, delivered_at, version, created_at, updated_at) VALUES ('job-delivery-delivered', 'order-delivery-delivered', 'cycle-next-cebu', 'SCHEDULED', 'auth-rider-legacy', 'DELIVERED', ?, 1700000000400, 9, 202, 1700000000400)",
    ).bind(deliveredAddress),
    env.DB.prepare(
      "INSERT INTO delivery_batch (id, cycle_id, status, rider_user_id, created_at, version) VALUES ('batch-delivery-legacy', 'cycle-next-cebu', 'COMPLETED', 'auth-rider-legacy', 190, 6)",
    ),
    env.DB.prepare(
      "INSERT INTO delivery_stop (id, batch_id, delivery_job_id, sequence, status, proof_json, version) VALUES ('stop-delivery-legacy', 'batch-delivery-legacy', 'job-delivery-delivered', 1, 'DELIVERED', ?, 8)",
    ).bind(proofJson),
    env.DB.prepare(
      "INSERT INTO domain_event (id, aggregate_type, aggregate_id, event_type, payload_json, occurred_at) VALUES ('event-delivery-legacy', 'DELIVERY_JOB', 'job-delivery-delivered', 'DELIVERED', ?, 1700000000400)",
    ).bind(eventJson),
  ]);
}

describe("canonical delivery batch migration 0043", () => {
  it("preserves compatibility delivery history while converging canonical batches and map stops", async () => {
    await seedPre0043CompatibilityRows();

    const migrations = JSON.parse(
      (env as unknown as { TEST_MIGRATIONS: string }).TEST_MIGRATIONS,
    ) as Parameters<typeof applyD1Migrations>[1];
    const migration = migrations.find((candidate) => candidate.name === migrationName);
    expect(
      migration,
      `${migrationName} must exist before the preservation fixture can upgrade`,
    ).toBeDefined();
    await applyD1Migrations(env.DB, [migration!]);

    const registered = await env.DB.prepare(
      "SELECT name FROM d1_migrations WHERE name >= '0041' ORDER BY name",
    ).all<{ name: string }>();
    expect(registered.results.map((row) => row.name)).toEqual([
      "0041_admin_catalog_authoring.sql",
      "0042_mapbox_address_confirmation.sql",
      migrationName,
    ]);

    const counts = await env.DB.prepare(
      "SELECT (SELECT COUNT(*) FROM delivery_job) AS jobs, (SELECT COUNT(*) FROM delivery_batch) AS batches, (SELECT COUNT(*) FROM delivery_stop) AS stops, (SELECT COUNT(DISTINCT delivery_job_id) FROM delivery_stop) AS stopped_jobs",
    ).first<{ jobs: number; batches: number; stops: number; stopped_jobs: number }>();
    expect(counts).toEqual({ jobs: 3, batches: 1, stops: 3, stopped_jobs: 3 });

    const instant = await env.DB.prepare(
      "SELECT fulfillment_mode, cycle_id, location_id, zone_id, batch_id, address_snapshot_json, version, created_at, updated_at FROM delivery_job WHERE id='job-delivery-instant'",
    ).first<Record<string, unknown>>();
    expect(instant).toEqual({
      fulfillment_mode: "INSTANT",
      cycle_id: null,
      location_id: "location-cebu-central",
      zone_id: "zone-cebu-city-core",
      batch_id: null,
      address_snapshot_json: instantAddress,
      version: 5,
      created_at: 201,
      updated_at: 211,
    });

    const batch = await env.DB.prepare(
      "SELECT fulfillment_mode, cycle_id, location_id, zone_id, rider_id, rider_user_id, status, version, created_at, updated_at, dispatched_at, completed_at FROM delivery_batch WHERE id='batch-delivery-legacy'",
    ).first<Record<string, unknown>>();
    expect(batch).toEqual({
      fulfillment_mode: "SCHEDULED",
      cycle_id: "cycle-next-cebu",
      location_id: "location-cebu-central",
      zone_id: "zone-cebu-city-core",
      rider_id: "rider-staff-rider-legacy",
      rider_user_id: "auth-rider-legacy",
      status: "COMPLETED",
      version: 6,
      created_at: 190,
      updated_at: 1700000000400,
      dispatched_at: 190,
      completed_at: 1700000000400,
    });

    const existingStop = await env.DB.prepare(
      "SELECT id, delivery_job_id, batch_id, sequence, latitude, longitude, address_snapshot_json, contact_snapshot_json, instructions_snapshot, status, proof_json, arrived_at, delivered_at, failure_reason_code, failure_notes, version, created_at, updated_at FROM delivery_stop WHERE delivery_job_id='job-delivery-delivered'",
    ).first<Record<string, unknown>>();
    expect(existingStop).toEqual({
      id: "stop-delivery-legacy",
      delivery_job_id: "job-delivery-delivered",
      batch_id: "batch-delivery-legacy",
      sequence: 1,
      latitude: 10.3192,
      longitude: 123.8922,
      address_snapshot_json: deliveredAddress,
      contact_snapshot_json: '{"recipient":"Dina Delivered","phone":"09170000003"}',
      instructions_snapshot: '{"deliveryNote":"Leave with recipient"}',
      status: "DELIVERED",
      proof_json: proofJson,
      arrived_at: null,
      delivered_at: 1700000000400,
      failure_reason_code: null,
      failure_notes: null,
      version: 8,
      created_at: 202,
      updated_at: 1700000000400,
    });

    const canonicalRider = await env.DB.prepare(
      "SELECT id, staff_id, auth_user_id, preferred_location_id, status, version, created_at, updated_at FROM rider_identity",
    ).first<Record<string, unknown>>();
    expect(canonicalRider).toEqual({
      id: "rider-staff-rider-legacy",
      staff_id: "staff-rider-legacy",
      auth_user_id: "auth-rider-legacy",
      preferred_location_id: "location-cebu-central",
      status: "ACTIVE",
      version: 1,
      created_at: 100,
      updated_at: 110,
    });

    const legacyEvent = await env.DB.prepare(
      "SELECT id, delivery_job_id, delivery_stop_id, rider_id, event_type, occurred_at, recorded_at, metadata_json, idempotency_key FROM delivery_event WHERE id='event-delivery-legacy'",
    ).first<Record<string, unknown>>();
    expect(legacyEvent).toEqual({
      id: "event-delivery-legacy",
      delivery_job_id: "job-delivery-delivered",
      delivery_stop_id: "stop-delivery-legacy",
      rider_id: "rider-staff-rider-legacy",
      event_type: "DELIVERED",
      occurred_at: 1700000000400,
      recorded_at: 1700000000400,
      metadata_json: eventJson,
      idempotency_key: null,
    });
    expect(
      await env.DB.prepare(
        "SELECT payload_json FROM domain_event WHERE id='event-delivery-legacy'",
      ).first<{ payload_json: string }>(),
    ).toEqual({ payload_json: eventJson });
    expect(
      await env.DB.prepare(
        "SELECT metadata_json, delivered_at, rider_id FROM delivery_proof WHERE delivery_stop_id='stop-delivery-legacy'",
      ).first<Record<string, unknown>>(),
    ).toEqual({
      metadata_json: proofJson,
      delivered_at: 1700000000400,
      rider_id: "rider-staff-rider-legacy",
    });

    await rejects("UPDATE delivery_stop SET latitude=11 WHERE id='stop-delivery-legacy'");
    await rejects(
      "UPDATE delivery_stop SET address_snapshot_json='{}' WHERE id='stop-delivery-legacy'",
    );
    await rejects("UPDATE delivery_event SET event_type='FAILED' WHERE id='event-delivery-legacy'");
    await rejects("DELETE FROM delivery_event WHERE id='event-delivery-legacy'");
    await rejects(
      "INSERT INTO delivery_batch (id, fulfillment_mode, cycle_id, location_id, zone_id, status, version, created_at, updated_at) VALUES ('invalid-instant-cycle', 'INSTANT', 'cycle-next-cebu', 'location-cebu-central', 'zone-cebu-city-core', 'DRAFT', 1, 1, 1)",
    );
    await rejects(
      "INSERT INTO delivery_batch (id, fulfillment_mode, cycle_id, location_id, zone_id, status, version, created_at, updated_at) VALUES ('invalid-scheduled-cycle', 'SCHEDULED', NULL, 'location-cebu-central', 'zone-cebu-city-core', 'DRAFT', 1, 1, 1)",
    );
    await env.DB.prepare(
      "INSERT INTO delivery_event (id, delivery_job_id, event_type, occurred_at, recorded_at, metadata_json, idempotency_key) VALUES ('event-new-key', 'job-delivery-instant', 'ASSIGNED', 1, 1, '{}', 'same-delivery-event-key')",
    ).run();
    await rejects(
      "INSERT INTO delivery_event (id, delivery_job_id, event_type, occurred_at, recorded_at, metadata_json, idempotency_key) VALUES ('event-duplicate-key-b', 'job-delivery-instant', 'ASSIGNED', 2, 2, '{}', 'same-delivery-event-key')",
    );

    const indexes = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name IN ('delivery_batch','delivery_job','delivery_stop','delivery_event') ORDER BY name",
    ).all<{ name: string }>();
    expect(indexes.results.map((row) => row.name)).toEqual(
      expect.arrayContaining([
        "delivery_batch_active_context_idx",
        "delivery_batch_rider_open_idx",
        "delivery_job_context_status_idx",
        "delivery_stop_batch_sequence_unique",
        "delivery_stop_job_unique",
        "delivery_event_job_time_idx",
        "delivery_event_idempotency_unique",
      ]),
    );

    const triggers = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name IN ('delivery_job','delivery_batch','delivery_stop','delivery_event') ORDER BY name",
    ).all<{ name: string }>();
    expect(triggers.results.map((row) => row.name)).toEqual(
      expect.arrayContaining([
        "delivery_batch_canonical_status_insert",
        "delivery_batch_canonical_status_update",
        "delivery_event_append_only_delete",
        "delivery_event_append_only_update",
        "delivery_job_canonical_status_insert",
        "delivery_job_canonical_status_update",
        "delivery_stop_canonical_status_insert",
        "delivery_stop_canonical_status_update",
        "delivery_stop_immutable_destination_update",
      ]),
    );

    const foreignKeyCheck = await env.DB.prepare("PRAGMA foreign_key_check").all();
    expect(foreignKeyCheck.results).toEqual([]);
  });
});
