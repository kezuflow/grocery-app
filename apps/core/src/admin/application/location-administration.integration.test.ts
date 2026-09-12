import { describe, it, expect } from "vitest";
import { env, exports } from "cloudflare:workers";
import { locationManager as staff } from "../../test-location-fixtures";
import type { CreateAdminLocationRequest } from "@freshmarkets/contracts";
import { createAuth } from "../../auth/service";
import {
  createAdminLocation,
  transitionAdminLocation,
  updateAdminLocation,
} from "./location-administration";
import type { GeocoderPort } from "../../geography/ports/geocoder";
import { GeocoderError } from "../../geography/infrastructure/geocoder-error";
import { getGlobalCommerceConfiguration } from "../../commerce/application/global-commerce-configuration";

const core = exports.default;
function createRequest(headers: Record<string, string>): CreateAdminLocationRequest {
  return {
    headers,
    requestId: crypto.randomUUID(),
    idempotencyKey: crypto.randomUUID(),
    reason: "Set up warehouse",
    marketId: "market-metro-cebu",
    code: `warehouse-${crypto.randomUUID()}`,
    name: "Central warehouse",
    purpose: "CENTRAL_WAREHOUSE",
    latitude: 10.32,
    longitude: 123.91,
    capabilities: ["RECEIVING", "INVENTORY"],
    address: {
      addressLine1: "Test street",
      addressLine2: null,
      barangay: null,
      city: "Cebu",
      region: "Cebu",
      countryCode: "PH",
      postalCode: null,
    },
  };
}
async function noEffects(key: string) {
  expect(
    await env.DB.prepare("SELECT COUNT(*) count FROM idempotency_records WHERE idempotency_key=?")
      .bind(key)
      .first(),
  ).toEqual({ count: 0 });
  expect(
    await env.DB.prepare("SELECT COUNT(*) count FROM audit_event WHERE idempotency_key=?")
      .bind(key)
      .first(),
  ).toEqual({ count: 0 });
}

describe("Global location setup", () => {
  it.each([
    ["claim", "BEFORE INSERT ON idempotency_records"],
    ["location", "BEFORE INSERT ON fulfillment_location"],
    ["capability", "BEFORE INSERT ON location_capability"],
    ["audit", "BEFORE INSERT ON audit_event"],
    ["receipt", "BEFORE UPDATE ON idempotency_records WHEN NEW.status='SUCCEEDED'"],
  ])("rolls back suppressed %s creation evidence and replays recovery", async (_name, trigger) => {
    const manager = await staff();
    const request = createRequest(manager.headers);
    await env.DB.exec(
      `CREATE TRIGGER ignore_location_effect ${trigger} BEGIN SELECT RAISE(IGNORE); END;`,
    );
    try {
      expect(await core.createAdminLocation(request)).toMatchObject({ ok: false });
      await noEffects(request.idempotencyKey);
      expect(
        await env.DB.prepare("SELECT count(*) count FROM fulfillment_location WHERE code=?")
          .bind(request.code)
          .first(),
      ).toEqual({ count: 0 });
    } finally {
      await env.DB.exec("DROP TRIGGER ignore_location_effect");
    }
    const result = await core.createAdminLocation(request);
    expect(result).toMatchObject({ ok: true });
    expect(await core.createAdminLocation(request)).toEqual(result);
  });
  it("rejects a suppressed capability removal without retaining a misleading result", async () => {
    const manager = await staff();
    const request = createRequest(manager.headers);
    const created = await core.createAdminLocation(request);
    if (!created.ok) throw new Error("Create failed");
    const update = {
      ...request,
      locationId: created.value.locationId,
      expectedVersion: 1,
      capabilities: [],
      idempotencyKey: crypto.randomUUID(),
    };
    await env.DB.exec(
      "CREATE TRIGGER ignore_location_capability_delete BEFORE DELETE ON location_capability BEGIN SELECT RAISE(IGNORE); END;",
    );
    try {
      expect(await core.updateAdminLocation(update)).toMatchObject({ ok: false });
      await noEffects(update.idempotencyKey);
      expect(
        await env.DB.prepare("SELECT version FROM fulfillment_location WHERE id=?")
          .bind(created.value.locationId)
          .first(),
      ).toEqual({ version: 1 });
    } finally {
      await env.DB.exec("DROP TRIGGER ignore_location_capability_delete");
    }
    const result = await core.updateAdminLocation(update);
    expect(result).toMatchObject({ ok: true, value: { capabilities: [], version: 2 } });
    expect(await core.updateAdminLocation(update)).toEqual(result);
    expect(
      await env.DB.prepare("SELECT count(*) count FROM location_capability WHERE location_id=?")
        .bind(created.value.locationId)
        .first(),
    ).toEqual({ count: 0 });
  });
  it("permanently finalizes temporary address text at the confirmed pin and retains saved evidence", async () => {
    const manager = await staff();
    const request = {
      ...createRequest(manager.headers),
      componentsSource: "TEMPORARY_GEOCODER" as const,
      confirmationSource: "USER_PIN" as const,
    };
    const coordinates: { latitude: number; longitude: number }[] = [];
    const geocoder: GeocoderPort = {
      search: async () => [],
      reverseTemporary: async () => {
        throw new Error("Unexpected temporary reverse");
      },
      reversePermanent: async ({ coordinate }) => {
        coordinates.push(coordinate);
        return {
          provider: "mapbox",
          providerReference: "protected-reference",
          displayAddress: "Permanent address",
          coordinate: { latitude: 1, longitude: 1 },
          accuracy: null,
          components: { ...request.address, addressLine1: "Permanently confirmed road" },
        };
      },
    };
    const deps = { db: env.DB, auth: createAuth(env), geocoder };
    const result = await createAdminLocation(deps, request);
    expect(result).toMatchObject({
      ok: true,
      value: {
        latitude: request.latitude,
        longitude: request.longitude,
        addressProviderDerived: true,
        address: { addressLine1: "Permanently confirmed road" },
      },
    });
    if (!result.ok || !result.value.address) throw new Error("Expected confirmed location");
    expect(coordinates).toEqual([{ latitude: request.latitude, longitude: request.longitude }]);
    expect(await createAdminLocation(deps, request)).toEqual(result);
    expect(coordinates).toHaveLength(1);
    const before = await env.DB.prepare("SELECT address_json FROM fulfillment_location WHERE id=?")
      .bind(result.value.locationId)
      .first();
    const update = {
      ...request,
      componentsSource: "SAVED_ADDRESS" as const,
      address: result.value.address,
      locationId: result.value.locationId,
      expectedVersion: 1,
      idempotencyKey: crypto.randomUUID(),
      name: "Renamed warehouse",
    };
    expect((await updateAdminLocation(deps, update)).ok).toBe(true);
    expect(coordinates).toHaveLength(1);
    expect(
      await env.DB.prepare("SELECT address_json FROM fulfillment_location WHERE id=?")
        .bind(result.value.locationId)
        .first(),
    ).toEqual(before);
    expect(
      (
        await updateAdminLocation(deps, {
          ...update,
          latitude: 10.33,
          expectedVersion: 2,
          idempotencyKey: crypto.randomUUID(),
        })
      ).ok,
    ).toBe(true);
    expect(coordinates).toHaveLength(2);
    expect(coordinates[1]).toEqual({ latitude: 10.33, longitude: request.longitude });
  });
  it.each(["provider", "revoked"] as const)(
    "leaves no location effects when address finalization is %s",
    async (mode) => {
      const manager = await staff();
      const request = {
        ...createRequest(manager.headers),
        componentsSource: "TEMPORARY_GEOCODER" as const,
        confirmationSource: "GEOCODER" as const,
      };
      const geocoder: GeocoderPort = {
        search: async () => [],
        reverseTemporary: async () => {
          throw new Error("Unexpected temporary reverse");
        },
        reversePermanent: async () => {
          if (mode === "provider") throw new GeocoderError("GEOCODER_TIMEOUT");
          await env.DB.prepare("DELETE FROM staff_scope WHERE staff_id=?").bind(manager.id).run();
          return {
            provider: "mapbox",
            providerReference: "protected-reference",
            displayAddress: "Confirmed",
            coordinate: { latitude: request.latitude, longitude: request.longitude },
            accuracy: null,
            components: request.address,
          };
        },
      };
      expect(
        (await createAdminLocation({ db: env.DB, auth: createAuth(env), geocoder }, request)).ok,
      ).toBe(false);
      await noEffects(request.idempotencyKey);
      expect(
        await env.DB.prepare("SELECT COUNT(*) count FROM fulfillment_location WHERE code=?")
          .bind(request.code)
          .first(),
      ).toEqual({ count: 0 });
    },
  );
  it("invalidates unstarted quotes but protects started payments and their origin", async () => {
    const manager = await staff();
    const request = {
      ...createRequest(manager.headers),
      purpose: "CUSTOMER_FULFILLMENT" as const,
      capabilities: ["PICKING", "PACKING", "DISPATCH"] as const,
    };
    const created = await core.createAdminLocation(request);
    if (!created.ok) throw new Error("Create failed");
    const id = crypto.randomUUID();
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO customer(id,auth_user_id,status,created_at,updated_at) VALUES (?,?,'active',?,?)",
      ).bind(id, `auth-${id}`, now, now),
      env.DB.prepare(
        "INSERT INTO customer_address(id,customer_id,label,recipient,phone,address_json,latitude,longitude,status,version,created_at,updated_at) VALUES (?,?,'Home','Customer','+639171234567','{}',10.3,123.9,'active',1,?,?)",
      ).bind(id, id, now, now),
      ...["unstarted", "started"].map((kind) =>
        env.DB.prepare(`INSERT INTO checkout_quote
        (id,attempt_id,customer_id,cart_id,address_id,delivery_cycle_id,fulfillment_mode,currency,subtotal_minor,total_minor,lines_json,cycle_snapshot_json,status,version,expires_at,idempotency_key,created_at,updated_at)
        VALUES (?,?,?,?,?,'cycle-next-cebu','SCHEDULED','PHP',100,100,'[]',?,'ACTIVE',1,?,?,?,?)`).bind(
          `${kind}-${id}`,
          `${kind}-${id}`,
          id,
          `cart-${id}`,
          id,
          JSON.stringify({ locationId: created.value.locationId }),
          now + 60000,
          `${kind}-${id}`,
          now,
          now,
        ),
      ),
      env.DB.prepare(`INSERT INTO payment_intent(id,purpose,subject_type,subject_id,customer_id,amount_minor,currency,status,idempotency_key,version,created_at,updated_at)
        VALUES (?,'GROCERY_CHECKOUT','checkout_quote',?,?,100,'PHP','PROCESSING',?,1,?,?)`).bind(
        id,
        `started-${id}`,
        id,
        id,
        now,
        now,
      ),
    ]);
    const rename = {
      ...request,
      name: "Renamed site",
      locationId: created.value.locationId,
      expectedVersion: 1,
      idempotencyKey: crypto.randomUUID(),
    };
    for (const trigger of [
      "BEFORE INSERT ON geography_configuration",
      "BEFORE UPDATE ON checkout_quote WHEN NEW.status='SUPERSEDED'",
    ]) {
      const revision = await env.DB.prepare(
        "SELECT version FROM geography_configuration WHERE market_id=?",
      )
        .bind(request.marketId)
        .first();
      await env.DB.exec(
        `CREATE TRIGGER ignore_location_invalidation ${trigger} BEGIN SELECT RAISE(IGNORE); END;`,
      );
      try {
        expect(await core.updateAdminLocation(rename)).toMatchObject({ ok: false });
        await noEffects(rename.idempotencyKey);
        expect(
          await env.DB.prepare("SELECT version FROM fulfillment_location WHERE id=?")
            .bind(created.value.locationId)
            .first(),
        ).toEqual({ version: 1 });
        expect(
          await env.DB.prepare("SELECT version FROM geography_configuration WHERE market_id=?")
            .bind(request.marketId)
            .first(),
        ).toEqual(revision);
        expect(
          await env.DB.prepare("SELECT status FROM checkout_quote WHERE id=?")
            .bind(`unstarted-${id}`)
            .first(),
        ).toEqual({ status: "ACTIVE" });
      } finally {
        await env.DB.exec("DROP TRIGGER ignore_location_invalidation");
      }
    }
    const changed = await core.updateAdminLocation(rename);
    expect(changed.ok).toBe(true);
    expect(await core.updateAdminLocation(rename)).toEqual(changed);
    expect(
      await env.DB.prepare("SELECT status FROM checkout_quote WHERE id=?")
        .bind(`unstarted-${id}`)
        .first(),
    ).toEqual({ status: "SUPERSEDED" });
    expect(
      await env.DB.prepare("SELECT status FROM checkout_quote WHERE id=?")
        .bind(`started-${id}`)
        .first(),
    ).toEqual({ status: "ACTIVE" });
    const move = {
      ...request,
      latitude: 10.4,
      locationId: created.value.locationId,
      expectedVersion: 2,
      idempotencyKey: crypto.randomUUID(),
    };
    expect((await core.updateAdminLocation(move)).ok).toBe(false);
    await noEffects(move.idempotencyKey);
    expect(
      await env.DB.prepare("SELECT latitude,version FROM fulfillment_location WHERE id=?")
        .bind(created.value.locationId)
        .first(),
    ).toEqual({ latitude: request.latitude, version: 2 });
  });
  it("creates, edits, activates and deactivates with exact replay, audit and scoped visibility", async () => {
    const manager = await staff();
    const request = createRequest(manager.headers);
    const created = await core.createAdminLocation(request);
    expect(created).toMatchObject({
      ok: true,
      value: { status: "inactive", version: 1, purpose: "CENTRAL_WAREHOUSE" },
    });
    if (!created.ok) throw new Error("Location creation failed");
    expect(created.value).not.toHaveProperty("headers");
    expect(await core.createAdminLocation(request)).toEqual(created);
    expect(await core.createAdminLocation({ ...request, name: "Changed" })).toMatchObject({
      ok: false,
      error: { code: "IDEMPOTENCY_CONFLICT" },
    });
    const updated = await core.updateAdminLocation({
      ...request,
      locationId: created.value.locationId,
      expectedVersion: 1,
      name: "Receiving warehouse",
      idempotencyKey: crypto.randomUUID(),
    });
    expect(updated).toMatchObject({ ok: true, value: { name: "Receiving warehouse", version: 2 } });
    const activate = {
      headers: manager.headers,
      requestId: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
      reason: "Receiving ready",
      locationId: created.value.locationId,
      expectedVersion: 2,
      action: "ACTIVATE" as const,
    };
    const active = await core.transitionAdminLocation(activate);
    expect(active).toMatchObject({ ok: true, value: { status: "active", version: 3 } });
    expect(await core.transitionAdminLocation(activate)).toEqual(active);
    const config = await getGlobalCommerceConfiguration(env.DB, { requestId: crypto.randomUUID() });
    expect(config.ok).toBe(true);
    if (config.ok)
      expect(
        config.value.readinessBlockers.some((blocker) =>
          blocker.message.includes("Receiving warehouse"),
        ),
      ).toBe(false);
    const deactivated = await core.transitionAdminLocation({
      ...activate,
      idempotencyKey: crypto.randomUUID(),
      expectedVersion: 3,
      action: "DEACTIVATE",
    });
    expect(deactivated).toMatchObject({ ok: true, value: { status: "inactive", version: 4 } });
    const locations = await core.listAdminLocations({
      headers: manager.headers,
      requestId: crypto.randomUUID(),
    });
    expect(locations).toMatchObject({
      ok: true,
      value: {
        canManage: true,
        items: expect.arrayContaining([
          expect.objectContaining({ locationId: created.value.locationId, status: "inactive" }),
        ]),
      },
    });
    const scopes = await core.listAdminScopes({
      headers: manager.headers,
      requestId: crypto.randomUUID(),
    });
    expect(scopes).toMatchObject({
      ok: true,
      value: expect.arrayContaining([
        expect.objectContaining({ locationId: created.value.locationId }),
      ]),
    });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) count FROM audit_event WHERE aggregate_id=? AND action LIKE 'LOCATION.%'",
      )
        .bind(created.value.locationId)
        .first(),
    ).toEqual({ count: 4 });
  });

  it("rejects unauthenticated, local and read-only writes before effects", async () => {
    for (const headers of [
      {},
      (await staff("location")).headers,
      (await staff("global", false)).headers,
    ]) {
      const request = createRequest(headers);
      expect((await core.createAdminLocation(request)).ok).toBe(false);
      await noEffects(request.idempotencyKey);
    }
  });
  it("rejects invalid warehouse dispatch and coordinates without effects", async () => {
    const manager = await staff();
    for (const patch of [{ latitude: 91 }, { capabilities: ["RECEIVING", "DISPATCH"] as const }]) {
      const request = { ...createRequest(manager.headers), ...patch };
      expect((await core.createAdminLocation(request)).ok).toBe(false);
      await noEffects(request.idempotencyKey);
    }
  });
  it("does not create duplicate locations in a concurrent replay", async () => {
    const manager = await staff();
    const request = createRequest(manager.headers);
    const results = await Promise.all([
      core.createAdminLocation(request),
      core.createAdminLocation(request),
    ]);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(results[0]).toEqual(results[1]);
    expect(
      await env.DB.prepare("SELECT COUNT(*) count FROM fulfillment_location WHERE code=?")
        .bind(request.code)
        .first(),
    ).toEqual({ count: 1 });
    expect(
      await env.DB.prepare("SELECT COUNT(*) count FROM audit_event WHERE idempotency_key=?")
        .bind(request.idempotencyKey)
        .first(),
    ).toEqual({ count: 1 });
  });
  it.each(["scope", "market", "failure"] as const)(
    "rolls back creation on late %s change",
    async (changed) => {
      const manager = await staff();
      const request = createRequest(manager.headers);
      let reached = false;
      const database = new Proxy(env.DB, {
        get(target, property) {
          if (property === "batch")
            return async (statements: D1PreparedStatement[]) => {
              reached = true;
              if (changed === "scope")
                await target
                  .prepare("DELETE FROM staff_scope WHERE staff_id=?")
                  .bind(manager.id)
                  .run();
              if (changed === "market")
                await target
                  .prepare("UPDATE market SET status='inactive' WHERE id=?")
                  .bind(request.marketId)
                  .run();
              try {
                return await target.batch(
                  changed === "failure"
                    ? [
                        ...statements,
                        target.prepare("INSERT INTO admin_command_abort(id) VALUES (-1)"),
                      ]
                    : statements,
                );
              } finally {
                if (changed === "market")
                  await target
                    .prepare("UPDATE market SET status='active' WHERE id=?")
                    .bind(request.marketId)
                    .run();
              }
            };
          const value = Reflect.get(target, property);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      expect((await createAdminLocation({ db: database, auth: createAuth(env) }, request)).ok).toBe(
        false,
      );
      expect(reached).toBe(true);
      await noEffects(request.idempotencyKey);
      expect(
        await env.DB.prepare("SELECT COUNT(*) count FROM fulfillment_location WHERE code=?")
          .bind(request.code)
          .first(),
      ).toEqual({ count: 0 });
    },
  );
  it("rejects competing versions and revoked activation capabilities without partial effects", async () => {
    const manager = await staff();
    const request = createRequest(manager.headers);
    const created = await core.createAdminLocation(request);
    if (!created.ok) throw new Error("Create failed");
    const input = {
      headers: manager.headers,
      requestId: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
      reason: "Ready",
      locationId: created.value.locationId,
      expectedVersion: 1,
      action: "ACTIVATE" as const,
    };
    const database = new Proxy(env.DB, {
      get(target, property) {
        if (property === "batch")
          return async (statements: D1PreparedStatement[]) => {
            await target
              .prepare(
                "UPDATE location_capability SET enabled=0 WHERE location_id=? AND capability='INVENTORY'",
              )
              .bind(input.locationId)
              .run();
            return target.batch(statements);
          };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    expect((await transitionAdminLocation({ db: database, auth: createAuth(env) }, input)).ok).toBe(
      false,
    );
    await noEffects(input.idempotencyKey);
    expect(
      await env.DB.prepare("SELECT status,version FROM fulfillment_location WHERE id=?")
        .bind(input.locationId)
        .first(),
    ).toEqual({ status: "inactive", version: 1 });
    const update = {
      ...request,
      locationId: input.locationId,
      expectedVersion: 1,
      idempotencyKey: crypto.randomUUID(),
    };
    const results = await Promise.all([
      core.updateAdminLocation(update),
      core.updateAdminLocation({
        ...update,
        idempotencyKey: crypto.randomUUID(),
        name: "Concurrent edit",
      }),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(
      await env.DB.prepare("SELECT version FROM fulfillment_location WHERE id=?")
        .bind(input.locationId)
        .first(),
    ).toEqual({ version: 2 });
  });
});
