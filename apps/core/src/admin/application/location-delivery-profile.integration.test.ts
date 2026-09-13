import { env, exports } from "cloudflare:workers";
import { expect, it } from "vitest";
import { locationManager } from "../../test-location-fixtures";
import { upsertLocationDeliveryProfile } from "./delivery-provider-operations";
import { createAuth } from "../../auth/service";
import { requestHash } from "../../idempotency";

const core = exports.default;
const wizardAddress = {
  addressLine1: "Saved entrance",
  addressLine2: null,
  barangay: null,
  city: "Cebu",
  region: "Cebu",
  postalCode: null,
  countryCode: "PH",
};
async function wizardFixture() {
  const { request } = await fixture();
  await env.DB.prepare(
    "UPDATE fulfillment_location SET address_json=?,version=version+1 WHERE id=?",
  )
    .bind(JSON.stringify(wizardAddress), request.locationId)
    .run();
  const row = await env.DB.prepare("SELECT version FROM fulfillment_location WHERE id=?")
    .bind(request.locationId)
    .first<{ version: number }>();
  if (!row) throw new Error("Location missing");
  return {
    ...request,
    ...wizardAddress,
    formattedAddress: "Saved entrance, Cebu, Cebu, PH",
    expectedLocationVersion: row.version,
  };
}
it("saves the reviewed location address and replays it after the location changes", async () => {
  const request = await wizardFixture();
  const saved = await core.upsertLocationDeliveryProfile(request);
  expect(saved).toMatchObject({ ok: true, value: { profile: { addressLine1: "Saved entrance" } } });
  await env.DB.prepare("UPDATE fulfillment_location SET version=version+1 WHERE id=?")
    .bind(request.locationId)
    .run();
  expect(await core.upsertLocationDeliveryProfile(request)).toEqual(saved);
  expect(
    await core.upsertLocationDeliveryProfile({
      ...request,
      idempotencyKey: crypto.randomUUID(),
      expectedVersion: 1,
    }),
  ).toMatchObject({ ok: false, error: { code: "STALE_VERSION" } });
});
it("rejects a different pickup address in the guided setup", async () => {
  const request = await wizardFixture();
  expect(
    await core.upsertLocationDeliveryProfile({ ...request, addressLine1: "Different entrance" }),
  ).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
  expect(
    await env.DB.prepare(
      "SELECT COUNT(*) count FROM fulfillment_location_delivery_profile WHERE location_id=?",
    )
      .bind(request.locationId)
      .first(),
  ).toEqual({ count: 0 });
});
it("rechecks the reviewed location version inside the pickup write transaction", async () => {
  const request = await wizardFixture();
  const db = new Proxy(env.DB, {
    get(target, property) {
      if (property === "batch")
        return async (statements: D1PreparedStatement[]) => {
          await env.DB.prepare("UPDATE fulfillment_location SET version=version+1 WHERE id=?")
            .bind(request.locationId)
            .run();
          return target.batch(statements);
        };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  expect(await upsertLocationDeliveryProfile({ db, auth: createAuth(env) }, request)).toMatchObject(
    { ok: false },
  );
  expect(
    await env.DB.prepare(
      "SELECT COUNT(*) count FROM fulfillment_location_delivery_profile WHERE location_id=?",
    )
      .bind(request.locationId)
      .first(),
  ).toEqual({ count: 0 });
  expect(
    await env.DB.prepare("SELECT COUNT(*) count FROM idempotency_records WHERE idempotency_key=?")
      .bind(request.idempotencyKey)
      .first(),
  ).toEqual({ count: 0 });
});
async function fixture() {
  const manager = await locationManager();
  await env.DB.prepare(
    "INSERT INTO role_permission(role_id,permission_id) SELECT ?,id FROM permission WHERE code IN ('delivery.read','delivery.manage')",
  )
    .bind(manager.id)
    .run();
  const request = {
    headers: manager.headers,
    requestId: crypto.randomUUID(),
    locationId: "location-cebu-central",
    senderName: "Pickup contact",
    phoneE164: "+639171110000",
    email: null,
    formattedAddress: "Receiving entrance, Cebu",
    addressLine1: "Receiving entrance",
    city: "Cebu",
    countryCode: "PH",
    expectedVersion: 0,
    idempotencyKey: crypto.randomUUID(),
  };
  await env.DB.prepare("DELETE FROM fulfillment_location_delivery_profile WHERE location_id=?")
    .bind(request.locationId)
    .run();
  return { manager, request };
}
it("replays the original pickup profile after later changes", async () => {
  const { request } = await fixture();
  const created = await core.upsertLocationDeliveryProfile(request);
  expect(created).toMatchObject({ ok: true });
  expect(
    await core.upsertLocationDeliveryProfile({
      ...request,
      senderName: "Later contact",
      expectedVersion: 1,
      idempotencyKey: crypto.randomUUID(),
    }),
  ).toMatchObject({ ok: true });
  expect(await core.upsertLocationDeliveryProfile(request)).toEqual(created);
});
it("recovers a historical unfinished claim without granting another intent its key", async () => {
  const { request } = await fixture();
  const hash = await requestHash({
    locationId: request.locationId,
    expectedVersion: 0,
    senderName: request.senderName,
    phoneE164: request.phoneE164,
    email: null,
    formattedAddress: request.formattedAddress,
    addressLine1: request.addressLine1,
    addressLine2: null,
    barangay: null,
    city: request.city,
    region: null,
    postalCode: null,
    countryCode: request.countryCode,
    pickupInstructions: null,
  });
  await env.DB.prepare(
    "INSERT INTO idempotency_records(scope,idempotency_key,request_hash,result_type,status,created_at,updated_at) VALUES ('admin.delivery.locationProfile',?,?,'admin.delivery.locationProfile','PROCESSING',1,1)",
  )
    .bind(request.idempotencyKey, hash)
    .run();
  expect(
    await core.upsertLocationDeliveryProfile({ ...request, senderName: "Other intent" }),
  ).toMatchObject({ ok: false, error: { code: "IDEMPOTENCY_CONFLICT" } });
  const result = await core.upsertLocationDeliveryProfile(request);
  expect(result).toMatchObject({ ok: true });
  expect(await core.upsertLocationDeliveryProfile(request)).toEqual(result);
});
it.each([
  "BEFORE INSERT ON idempotency_records",
  "BEFORE INSERT ON fulfillment_location_delivery_profile",
  "BEFORE INSERT ON audit_event",
  "BEFORE UPDATE ON idempotency_records WHEN NEW.status='SUCCEEDED'",
])("rolls back a suppressed pickup effect %s and recovers", async (trigger) => {
  const { request } = await fixture();
  await env.DB.exec(
    `CREATE TRIGGER ignore_pickup_audit ${trigger} BEGIN SELECT RAISE(IGNORE); END;`,
  );
  try {
    expect(await core.upsertLocationDeliveryProfile(request)).toMatchObject({ ok: false });
    expect(
      await env.DB.prepare(
        "SELECT count(*) count FROM fulfillment_location_delivery_profile WHERE location_id=?",
      )
        .bind(request.locationId)
        .first(),
    ).toEqual({ count: 0 });
    expect(
      await env.DB.prepare("SELECT count(*) count FROM idempotency_records WHERE idempotency_key=?")
        .bind(request.idempotencyKey)
        .first(),
    ).toEqual({ count: 0 });
  } finally {
    await env.DB.exec("DROP TRIGGER ignore_pickup_audit");
  }
  expect(await core.upsertLocationDeliveryProfile(request)).toMatchObject({ ok: true });
});
it("rejects lost scope at the write boundary without a profile or receipt", async () => {
  const { manager, request } = await fixture();
  const db = new Proxy(env.DB, {
    get(target, property) {
      if (property === "batch")
        return async (statements: D1PreparedStatement[]) => {
          await target.prepare("DELETE FROM staff_scope WHERE staff_id=?").bind(manager.id).run();
          return target.batch(statements);
        };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  expect(await upsertLocationDeliveryProfile({ db, auth: createAuth(env) }, request)).toMatchObject(
    { ok: false },
  );
  expect(
    await env.DB.prepare(
      "SELECT count(*) count FROM fulfillment_location_delivery_profile WHERE location_id=?",
    )
      .bind(request.locationId)
      .first(),
  ).toEqual({ count: 0 });
  expect(
    await env.DB.prepare("SELECT count(*) count FROM idempotency_records WHERE idempotency_key=?")
      .bind(request.idempotencyKey)
      .first(),
  ).toEqual({ count: 0 });
});
it("allows one competing pickup update and preserves the winning replay", async () => {
  const { request } = await fixture();
  expect(await core.upsertLocationDeliveryProfile(request)).toMatchObject({ ok: true });
  const commands = ["First", "Second"].map((senderName) => ({
    ...request,
    senderName,
    expectedVersion: 1,
    idempotencyKey: crypto.randomUUID(),
  }));
  const results = await Promise.all(
    commands.map((command) => core.upsertLocationDeliveryProfile(command)),
  );
  expect(results.filter((result) => result.ok)).toHaveLength(1);
  for (const [index, command] of commands.entries()) {
    const result = results[index];
    if (result?.ok) expect(await core.upsertLocationDeliveryProfile(command)).toEqual(result);
    else
      expect(
        await env.DB.prepare(
          "SELECT count(*) count FROM idempotency_records WHERE idempotency_key=?",
        )
          .bind(command.idempotencyKey)
          .first(),
      ).toEqual({ count: 0 });
  }
});
