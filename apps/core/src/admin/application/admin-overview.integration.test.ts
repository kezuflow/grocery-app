import { describe, expect, it } from "vitest";
import { SELF } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import type { Capability, CoreServiceBinding } from "@freshmarkets/contracts";
import { enqueueNotification } from "../../notifications/application/enqueue-notification";

const core = exports.default as unknown as CoreServiceBinding;

async function signUp() {
  const email = `overview-${crypto.randomUUID().slice(0, 12)}@example.com`;
  const password = "correct-horse-battery-staple";
  const response = await SELF.fetch("https://core.example.invalid/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://core.example.invalid" },
    body: JSON.stringify({ name: "Overview Admin", email, password }),
  });
  expect(response.status).toBeLessThan(400);
  const body = (await response.json()) as { user: { id: string } };
  await env.DB.prepare("UPDATE user SET email_verified=1 WHERE id=?").bind(body.user.id).run();
  let cookie = (response.headers.getSetCookie?.() ?? [])
    .map((item) => item.split(";", 1)[0])
    .join("; ");
  if (!cookie) {
    const signIn = await SELF.fetch("https://core.example.invalid/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://core.example.invalid" },
      body: JSON.stringify({ email, password }),
    });
    cookie = (signIn.headers.getSetCookie?.() ?? [])
      .map((item) => item.split(";", 1)[0])
      .join("; ");
  }
  return { cookie, userId: body.user.id };
}

async function seedStaff(options: {
  capabilities: ReadonlyArray<Capability>;
  scope: "global" | "location";
}) {
  const principal = await signUp();
  const now = Date.now();
  const staffId = crypto.randomUUID();
  const roleId = crypto.randomUUID();
  const statements = [
    env.DB.prepare(
      "INSERT INTO staff_identity (id, auth_user_id, display_name, status, created_at, updated_at) VALUES (?, ?, 'Overview Admin', 'active', ?, ?)",
    ).bind(staffId, principal.userId, now, now),
    env.DB.prepare(
      "INSERT INTO role (id, code, name, created_at) VALUES (?, ?, 'Overview', ?)",
    ).bind(roleId, `overview-${crypto.randomUUID().slice(0, 8)}`, now),
    env.DB.prepare("INSERT INTO staff_role (staff_id, role_id) VALUES (?, ?)").bind(
      staffId,
      roleId,
    ),
    env.DB.prepare(
      "INSERT INTO staff_scope (id, staff_id, scope_kind, market_id, location_id) VALUES (?, ?, ?, NULL, ?)",
    ).bind(
      crypto.randomUUID(),
      staffId,
      options.scope,
      options.scope === "location" ? "location-cebu-central" : null,
    ),
  ];
  for (const capability of options.capabilities) {
    statements.push(
      env.DB.prepare(
        "INSERT OR IGNORE INTO permission (id, code, description, created_at) VALUES (?, ?, 'overview', ?)",
      ).bind(crypto.randomUUID(), capability, now),
      env.DB.prepare(
        "INSERT OR IGNORE INTO role_permission (role_id, permission_id) SELECT ?, id FROM permission WHERE code=?",
      ).bind(roleId, capability),
    );
  }
  await env.DB.batch(statements);
  return principal.cookie;
}

describe("Admin operational overview", () => {
  it("requires authentication and a valid timezone", async () => {
    expect(
      await core.getAdminOverview({
        requestId: "overview-anonymous",
        headers: {},
        selectedScope: { kind: "GLOBAL" },
        timezone: "Asia/Manila",
      }),
    ).toMatchObject({ ok: false, error: { code: "UNAUTHENTICATED" } });
    const cookie = await seedStaff({ capabilities: [], scope: "global" });
    expect(
      await core.getAdminOverview({
        requestId: crypto.randomUUID(),
        headers: { cookie },
        selectedScope: { kind: "GLOBAL" },
        timezone: "not-a-timezone",
      }),
    ).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
  });

  it("returns authoritative global counts to a fully capable reader", async () => {
    const cookie = await seedStaff({
      capabilities: [
        "orders.read",
        "payments.read",
        "catalog.read",
        "fulfillment.read",
        "fulfillment.manage",
        "audit.read",
      ],
      scope: "global",
    });
    const result = await core.getAdminOverview({
      requestId: crypto.randomUUID(),
      headers: { cookie },
      selectedScope: { kind: "GLOBAL" },
      timezone: "Asia/Manila",
    });
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    const active = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM product WHERE status='active'",
    ).first<{ count: number }>();
    expect(result.value.cards.find((card) => card.code === "ACTIVE_PRODUCTS")?.value).toBe(
      active?.count ?? 0,
    );
    expect(result.value.deniedSections).toEqual([]);
    expect(result.value.exceptions.length).toBeLessThanOrEqual(12);
  });

  it("keeps location-scoped operations visible while denying global sections", async () => {
    const cookie = await seedStaff({
      capabilities: ["fulfillment.read", "fulfillment.manage"],
      scope: "location",
    });
    const result = await core.getAdminOverview({
      requestId: crypto.randomUUID(),
      headers: { cookie },
      selectedScope: {
        kind: "LOCATION",
        marketId: "market-metro-cebu",
        locationId: "location-cebu-central",
      },
      timezone: "Asia/Manila",
    });
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(result.value.deniedSections).toEqual(
      expect.arrayContaining(["orders", "payments", "catalog", "audit"]),
    );
    expect(result.value.deniedSections).not.toContain("operations");
    expect(result.value.cards.find((card) => card.code === "OPEN_ORDERS")).toMatchObject({
      value: null,
    });
  });
  it("scopes dashboard notifications and their completed-order links without exposing administrator problems", async () => {
    const otherLocation = `notice-location-${crypto.randomUUID()}`;
    await env.DB.prepare(
      "INSERT INTO fulfillment_location(id,market_id,code,name,type,latitude,longitude,status,created_at,updated_at) VALUES (?,'market-metro-cebu',?,'Other location','FULFILLMENT_CENTER',10,123,'active',1,1)",
    )
      .bind(otherLocation, otherLocation)
      .run();
    async function order(locationId: string) {
      const id = crypto.randomUUID();
      const customerId = `customer-${id}`;
      await env.DB.batch([
        env.DB.prepare(
          "INSERT INTO customer(id,auth_user_id,status,created_at,updated_at) VALUES (?,?,'active',1,1)",
        ).bind(customerId, `auth-${id}`),
        env.DB.prepare(
          "INSERT INTO payment_attempt(id,customer_id,amount_minor,currency,status,provider,idempotency_key,created_at,updated_at) VALUES (?,?,100,'PHP','SUCCEEDED','mock',?,1,1)",
        ).bind(`payment-${id}`, customerId, `payment-${id}`),
        env.DB.prepare(
          "INSERT INTO grocery_order(id,customer_id,cycle_id,fulfillment_mode,address_snapshot_json,status,total_minor,currency,payment_id,created_at,committed_at,order_number) VALUES (?,?,NULL,'INSTANT','{}','DELIVERED',100,'PHP',?,1,?,?)",
        ).bind(id, customerId, `payment-${id}`, Date.now(), `FM-${id}`),
        env.DB.prepare(
          "INSERT INTO fulfillment_record(id,order_id,location_id,status,updated_at) VALUES (?,?,?,'COMPLETED',1)",
        ).bind(`fulfillment-${id}`, id, locationId),
        env.DB.prepare(
          "INSERT OR IGNORE INTO delivery_job(id,order_id,fulfillment_mode,location_id,zone_id,status,context_resolution_status,address_snapshot_json,version,created_at,updated_at) VALUES (?,?,'INSTANT',?,'zone-cebu-city-core','DELIVERED','RESOLVED','{}',1,1,1)",
        ).bind(`job-${id}`, id, locationId),
        env.DB.prepare(
          "UPDATE delivery_job SET status='DELIVERED',delivered_at=1 WHERE order_id=?",
        ).bind(id),
        env.DB.prepare(
          "INSERT INTO order_issue(id,order_id,customer_id,category,status,details,version,idempotency_key,created_at,updated_at) VALUES (?,?,?,'OTHER','SUBMITTED','Customer needs help',1,?,?,?)",
        ).bind(`issue-${id}`, id, customerId, `issue-${id}`, Date.now(), Date.now()),
      ]);
      await enqueueNotification(env.DB, {
        type: "DELIVERED",
        aggregateType: "DELIVERY",
        aggregateId: id,
        customerId,
        recipient: "synthetic@example.com",
        templateData: { orderNumber: `FM-${id}` },
        scheduledAt: Date.now(),
        idempotencyKey: `delivered-${id}`,
      });
      return id;
    }
    const localOrder = await order("location-cebu-central");
    const otherOrder = await order(otherLocation);
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO payment_intent(id,purpose,subject_type,subject_id,customer_id,amount_minor,currency,status,idempotency_key,created_at,updated_at) VALUES (?,'GROCERY_CHECKOUT','ORDER',?,?,100,'PHP','SUCCEEDED',?,1,1)",
      ).bind(`intent-${localOrder}`, localOrder, `customer-${localOrder}`, `intent-${localOrder}`),
      env.DB.prepare(
        "INSERT INTO order_payment_reaction(id,payment_intent_id,reaction_id,order_id,applied_at) VALUES (?,?,?,?,1)",
      ).bind(
        `reaction-${localOrder}`,
        `intent-${localOrder}`,
        `reaction-${localOrder}`,
        localOrder,
      ),
      env.DB.prepare(
        "INSERT INTO payment_refund(id,payment_intent_id,amount_minor,currency,status,idempotency_key,created_at,updated_at) VALUES (?,?,100,'PHP','ESCALATED',?,?,?)",
      ).bind(
        `refund-${localOrder}`,
        `intent-${localOrder}`,
        `refund-${localOrder}`,
        Date.now(),
        Date.now(),
      ),
    ]);
    const cookie = await seedStaff({
      capabilities: ["fulfillment.read", "delivery.read", "orders.read", "payments.read"],
      scope: "location",
    });
    const request = {
      headers: { cookie },
      requestId: crypto.randomUUID(),
      selectedScope: {
        kind: "LOCATION" as const,
        marketId: "market-metro-cebu",
        locationId: "location-cebu-central",
      },
      timezone: "Asia/Manila",
    };
    const local = await core.getAdminOverview(request);
    if (!local.ok) throw new Error("Missing local overview");
    expect(local.value.notifications.map((item) => item.orderId)).toEqual([localOrder, localOrder]);
    expect(local.value.notifications.some((item) => item.label.includes("problem"))).toBe(false);
    expect(local.value.notifications.map((item) => item.href)).toEqual(
      expect.arrayContaining([
        `/admin/fulfillment?orderId=${localOrder}`,
        `/admin/delivery?orderId=${localOrder}`,
      ]),
    );
    expect(
      await core.getAdminOverview({ ...request, selectedScope: { kind: "GLOBAL" } }),
    ).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(
      await core.listFulfillmentQueue({
        ...request,
        locationId: "location-cebu-central",
        orderId: otherOrder,
      }),
    ).toMatchObject({ ok: true, value: { items: [] } });
    expect(
      await core.listDeliveryOperations({
        ...request,
        locationId: otherLocation,
        orderId: otherOrder,
      }),
    ).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(
      await core.listFulfillmentQueue({
        ...request,
        locationId: "location-cebu-central",
        orderId: localOrder,
      }),
    ).toMatchObject({
      ok: true,
      value: { items: [{ orderId: localOrder, status: "COMPLETED", allowedActions: [] }] },
    });
    expect(
      await core.listDeliveryOperations({
        ...request,
        locationId: "location-cebu-central",
        orderId: localOrder,
      }),
    ).toMatchObject({ ok: true, value: { items: [{ orderId: localOrder, status: "DELIVERED" }] } });
    const adminCookie = await seedStaff({
      capabilities: ["orders.read", "payments.read"],
      scope: "global",
    });
    const global = await core.getAdminOverview({
      ...request,
      headers: { cookie: adminCookie },
      selectedScope: { kind: "GLOBAL" },
    });
    if (!global.ok) throw new Error("Missing global overview");
    expect(
      global.value.notifications
        .filter((item) => item.label.includes("problem"))
        .map((item) => item.orderId)
        .sort(),
    ).toEqual([localOrder, otherOrder].sort());
    expect(
      global.value.notifications.every(
        (item) =>
          item.href.startsWith("/admin/orders/") ||
          item.href.startsWith("/admin/issues/") ||
          item.href.startsWith("/admin/payments/"),
      ),
    ).toBe(true);
    expect(
      global.value.notifications.find((item) => item.label === "Refund needs attention"),
    ).toMatchObject({ orderId: localOrder, href: `/admin/payments/intent-${localOrder}` });
    await env.DB.prepare(
      "DELETE FROM role_permission WHERE role_id IN (SELECT sr.role_id FROM staff_role sr JOIN staff_scope scope ON scope.staff_id=sr.staff_id WHERE scope.scope_kind='location')",
    ).run();
    expect(await core.getAdminOverview(request)).toMatchObject({
      ok: true,
      value: { notifications: [] },
    });
  });
});
