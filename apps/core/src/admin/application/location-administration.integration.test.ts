import { describe, it, expect } from "vitest";
import { SELF } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { z } from "@freshmarkets/validation";
import type { CreateAdminLocationRequest } from "@freshmarkets/contracts";
import { createAuth } from "../../auth/service";
import { createAdminLocation, transitionAdminLocation } from "./location-administration";
import { getGlobalCommerceConfiguration } from "../../commerce/application/global-commerce-configuration";

const core = exports.default;
async function staff(scope: "global" | "location" = "global", manage = true) {
  const id = crypto.randomUUID();
  const response = await SELF.fetch("https://core.example.invalid/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://core.example.invalid" },
    body: JSON.stringify({
      name: "Location manager",
      email: `locations-${id}@example.com`,
      password: "correct-horse-battery-staple",
    }),
  });
  const { user } = z.object({ user: z.object({ id: z.string() }) }).parse(await response.json());
  let cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(";", 1)[0])
    .join("; ");
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("UPDATE user SET email_verified=1 WHERE id=?").bind(user.id),
    env.DB.prepare(
      "INSERT INTO staff_identity(id,auth_user_id,display_name,status,created_at,updated_at) VALUES (?,?,'Location manager','active',?,?)",
    ).bind(id, user.id, now, now),
    env.DB.prepare("INSERT INTO role(id,code,name,created_at) VALUES (?,?,'Locations',?)").bind(
      id,
      `locations-${id}`,
      now,
    ),
    env.DB.prepare("INSERT INTO staff_role(staff_id,role_id) VALUES (?,?)").bind(id, id),
    env.DB.prepare(
      "INSERT INTO staff_scope(id,staff_id,scope_kind,location_id) VALUES (?,?,?,?)",
    ).bind(id, id, scope, scope === "global" ? null : "location-cebu-central"),
    env.DB.prepare(
      "INSERT INTO role_permission(role_id,permission_id) SELECT ?,id FROM permission WHERE code='locations.read' OR (code='locations.manage' AND ?=1)",
    ).bind(id, manage ? 1 : 0),
  ]);
  if (!cookie) {
    const signedIn = await SELF.fetch("https://core.example.invalid/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://core.example.invalid" },
      body: JSON.stringify({
        email: `locations-${id}@example.com`,
        password: "correct-horse-battery-staple",
      }),
    });
    cookie = signedIn.headers
      .getSetCookie()
      .map((value) => value.split(";", 1)[0])
      .join("; ");
  }
  expect(cookie.length).toBeGreaterThan(0);
  return { id, headers: { cookie } };
}
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
    const changed = await core.updateAdminLocation({
      ...request,
      name: "Renamed site",
      locationId: created.value.locationId,
      expectedVersion: 1,
      idempotencyKey: crypto.randomUUID(),
    });
    expect(changed.ok).toBe(true);
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
