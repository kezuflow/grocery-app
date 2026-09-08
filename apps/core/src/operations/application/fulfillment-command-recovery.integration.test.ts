import { describe, it, expect } from "vitest";
import { env, exports } from "cloudflare:workers";
import { locationManager } from "../../test-location-fixtures";
import { seedTestInstantOrder } from "../../test-commerce-fixtures";
import { createAuth } from "../../auth/service";
import { advanceAdminFulfillment } from "../../admin/application/operations-commands";
import { requestHash } from "../../idempotency";
const core = exports.default;
async function fixture() {
  const manager = await locationManager("location"),
    orderId = crypto.randomUUID();
  await seedTestInstantOrder(env.DB, orderId);
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO role_permission(role_id,permission_id) SELECT ?,id FROM permission WHERE code='fulfillment.manage'",
    ).bind(manager.id),
    env.DB.prepare("UPDATE grocery_order SET status='COMMITTED',version=1 WHERE id=?").bind(
      orderId,
    ),
    env.DB.prepare(
      "INSERT INTO fulfillment_record(id,order_id,location_id,status,version,updated_at) VALUES (?,?,'location-cebu-central','NOT_STARTED',1,1)",
    ).bind(crypto.randomUUID(), orderId),
  ]);
  return {
    manager,
    request: {
      headers: manager.headers,
      requestId: crypto.randomUUID(),
      orderId,
      locationId: "location-cebu-central",
      action: "START_PICKING" as const,
      expectedVersion: 1,
      idempotencyKey: crypto.randomUUID(),
      reason: "Prepare paid order",
    },
  };
}
async function noEffects(key: string, orderId: string) {
  expect(
    await env.DB.prepare("SELECT status,version FROM grocery_order WHERE id=?")
      .bind(orderId)
      .first(),
  ).toEqual({ status: "COMMITTED", version: 1 });
  expect(
    await env.DB.prepare("SELECT status,version FROM fulfillment_record WHERE order_id=?")
      .bind(orderId)
      .first(),
  ).toEqual({ status: "NOT_STARTED", version: 1 });
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
describe("reachable fulfillment command recovery", () => {
  it("rejects acceptance when payment evidence changes immediately before the transaction", async () => {
    const { request } = await fixture();
    const database = new Proxy(env.DB, {
      get(target, key) {
        if (key === "batch")
          return async (statements: D1PreparedStatement[]) => {
            await target
              .prepare(
                "UPDATE payment_attempt SET status='FAILED' WHERE id=(SELECT payment_id FROM grocery_order WHERE id=?)",
              )
              .bind(request.orderId)
              .run();
            return target.batch(statements);
          };
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    expect(
      await advanceAdminFulfillment({ db: database, auth: createAuth(env) }, request),
    ).toMatchObject({ ok: false });
    await noEffects(request.idempotencyKey, request.orderId);
  });

  it("does not treat a committed order label as successful canonical payment", async () => {
    const { request } = await fixture();
    const intentId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO payment_intent(id,purpose,subject_type,subject_id,customer_id,amount_minor,currency,status,idempotency_key,version,created_at,updated_at) VALUES (?,'GROCERY_CHECKOUT','checkout_quote',?, ?,100,'PHP','PROCESSING',?,1,1,1)",
      ).bind(intentId, request.orderId, `customer-${request.orderId}`, intentId),
      env.DB.prepare(
        "UPDATE payment_attempt SET payment_intent_id=? WHERE id=(SELECT payment_id FROM grocery_order WHERE id=?)",
      ).bind(intentId, request.orderId),
    ]);
    expect(await core.advanceAdminFulfillment(request)).toMatchObject({ ok: false });
    await noEffects(request.idempotencyKey, request.orderId);
  });

  it("recovers an interrupted retained pre-transaction claim through the original command", async () => {
    const { request } = await fixture();
    const hash = await requestHash({
      orderId: request.orderId,
      action: request.action,
      expectedVersion: request.expectedVersion,
    });
    await env.DB.prepare(
      "INSERT INTO idempotency_records(scope,idempotency_key,request_hash,status,result_type,created_at,updated_at) VALUES ('fulfillment.advance',?,?,'PROCESSING','command',1,1)",
    )
      .bind(request.idempotencyKey, hash)
      .run();
    expect(await core.advanceAdminFulfillment(request)).toMatchObject({
      ok: true,
      value: { status: "PICKING", version: 2 },
    });
    expect(
      await env.DB.prepare("SELECT status FROM idempotency_records WHERE idempotency_key=?")
        .bind(request.idempotencyKey)
        .first(),
    ).toEqual({ status: "SUCCEEDED" });
    expect(
      await env.DB.prepare("SELECT COUNT(*) count FROM audit_event WHERE idempotency_key=?")
        .bind(request.idempotencyKey)
        .first(),
    ).toEqual({ count: 1 });
  });
  it("replays the original Admin result after later advancement and audits once", async () => {
    const { request } = await fixture();
    const first = await core.advanceAdminFulfillment(request);
    expect(first).toMatchObject({ ok: true, value: { status: "PICKING", version: 2 } });
    expect(
      await core.advanceAdminFulfillment({
        ...request,
        action: "MARK_READY_TO_PACK",
        expectedVersion: 2,
        idempotencyKey: crypto.randomUUID(),
      }),
    ).toMatchObject({ ok: true, value: { status: "READY_TO_PACK", version: 3 } });
    expect(await core.advanceAdminFulfillment({ ...request, requestId: "replay" })).toEqual({
      ...first,
      requestId: "replay",
    });
    expect(
      await env.DB.prepare("SELECT COUNT(*) count FROM audit_event WHERE idempotency_key=?")
        .bind(request.idempotencyKey)
        .first(),
    ).toEqual({ count: 1 });
    expect(
      await core.advanceAdminFulfillment({ ...request, reason: "Different reason" }),
    ).toMatchObject({ ok: false, error: { code: "IDEMPOTENCY_CONFLICT" } });
  });
  it("keeps the legacy RPC reachable with the same atomic audit and replay semantics", async () => {
    const { request } = await fixture();
    const first = await core.advanceFulfillment(request);
    expect(first).toMatchObject({ ok: true, value: { status: "PICKING" } });
    expect(
      await core.advanceFulfillment({
        ...request,
        action: "MARK_READY_TO_PACK",
        expectedVersion: 2,
        idempotencyKey: crypto.randomUUID(),
      }),
    ).toMatchObject({ ok: true, value: { status: "READY_TO_PACK" } });
    expect(await core.advanceFulfillment(request)).toEqual(first);
    expect(
      await env.DB.prepare("SELECT COUNT(*) count FROM audit_event WHERE idempotency_key=?")
        .bind(request.idempotencyKey)
        .first(),
    ).toEqual({ count: 1 });
  });
  it.each(["scope", "permission", "staff"])(
    "rejects %s loss between authorization and batch with no claim or state effects",
    async (change) => {
      const { manager, request } = await fixture();
      let reachedBatch = false;
      const database = new Proxy(env.DB, {
        get(target, key) {
          if (key === "batch")
            return async (statements: D1PreparedStatement[]) => {
              reachedBatch = true;
              await env.DB.prepare(
                change === "scope"
                  ? "DELETE FROM staff_scope WHERE staff_id=?"
                  : change === "permission"
                    ? "DELETE FROM role_permission WHERE role_id=?"
                    : "UPDATE staff_identity SET status='inactive' WHERE id=?",
              )
                .bind(manager.id)
                .run();
              return target.batch(statements);
            };
          const value = Reflect.get(target, key);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      const result = await advanceAdminFulfillment(
        { db: database, auth: createAuth(env) },
        request,
      );
      expect(reachedBatch).toBe(true);
      expect(result).toMatchObject({ ok: false });
      await noEffects(request.idempotencyKey, request.orderId);
    },
  );
  it("rolls back a late batch failure and allows the identical command to recover", async () => {
    const { request } = await fixture();
    let reachedBatch = false;
    const database = new Proxy(env.DB, {
      get(target, key) {
        if (key === "batch")
          return async (statements: D1PreparedStatement[]) => {
            reachedBatch = true;
            return target.batch([
              ...statements,
              target.prepare("INSERT INTO commitment_abort(id) VALUES (-99)"),
            ]);
          };
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    expect(
      await advanceAdminFulfillment({ db: database, auth: createAuth(env) }, request),
    ).toMatchObject({ ok: false });
    expect(reachedBatch).toBe(true);
    await noEffects(request.idempotencyKey, request.orderId);
    expect(await core.advanceAdminFulfillment(request)).toMatchObject({
      ok: true,
      value: { status: "PICKING", version: 2 },
    });
  });
  it("serializes duplicate commands and preserves supported retained-result replay", async () => {
    const { request } = await fixture();
    const results = await Promise.all([
      core.advanceAdminFulfillment(request),
      core.advanceAdminFulfillment(request),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect(results.every((result) => result.ok)).toBe(true);
    const hash = await requestHash({
      orderId: request.orderId,
      action: request.action,
      expectedVersion: request.expectedVersion,
    });
    await env.DB.prepare(
      "UPDATE idempotency_records SET request_hash=?,result_reference=? WHERE scope='fulfillment.advance' AND idempotency_key=?",
    )
      .bind(hash, request.orderId, request.idempotencyKey)
      .run();
    expect(
      await core.advanceAdminFulfillment({
        ...request,
        action: "MARK_READY_TO_PACK",
        expectedVersion: 2,
        idempotencyKey: crypto.randomUUID(),
      }),
    ).toMatchObject({ ok: true });
    expect(await core.advanceAdminFulfillment(request)).toMatchObject({
      ok: true,
      value: { status: "PICKING", version: 2 },
    });
  });
});
