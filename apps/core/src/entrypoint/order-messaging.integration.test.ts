import { env } from "cloudflare:workers";
import { SELF } from "cloudflare:test";
import { expect, it } from "vitest";
import { createCoreRpcContext } from "./context";
import { createMessagesRpc } from "./messages-rpc";
import { expireOrderMessages } from "../messages/application/expire-order-messages";

async function customerSession() {
  const email = `message-${crypto.randomUUID()}@example.com`;
  const signup = await SELF.fetch("https://core.example.invalid/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://core.example.invalid" },
    body: JSON.stringify({ name: "Message test", email, password: "correct-horse-battery-staple" }),
  });
  expect(signup.status).toBeLessThan(400);
  const { user } = (await signup.json()) as { user: { id: string } };
  await env.DB.prepare("UPDATE user SET email_verified=1 WHERE id=?").bind(user.id).run();
  const signin = await SELF.fetch("https://core.example.invalid/api/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://core.example.invalid" },
    body: JSON.stringify({ email, password: "correct-horse-battery-staple" }),
  });
  expect(signin.status).toBeLessThan(400);
  const cookie = signin.headers
    .getSetCookie()
    .map((value) => value.split(";", 1)[0])
    .join("; ");
  const context = createCoreRpcContext(env);
  const customer = await context.access.resolveAuthenticatedCustomer({
    requestId: "customer",
    headers: { cookie },
  });
  if (!customer.ok) throw new Error("Customer setup failed");
  return { cookie, customerId: customer.value.customerId };
}

async function committedOrder(customerId: string): Promise<string> {
  const orderId = crypto.randomUUID();
  const paymentId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO payment_attempt
      (id,customer_id,amount_minor,currency,status,provider,idempotency_key,created_at,updated_at)
      VALUES (?,?,100,'PHP','SUCCEEDED','mock',?,?,?)`).bind(
      paymentId,
      customerId,
      paymentId,
      1,
      1,
    ),
    env.DB.prepare(`INSERT INTO grocery_order
      (id,customer_id,payment_id,fulfillment_mode,cycle_id,address_snapshot_json,
       status,total_minor,currency,created_at,committed_at)
      VALUES (?,?,?,'INSTANT',NULL,'{}','PAID',100,'PHP',1,1)`).bind(
      orderId,
      customerId,
      paymentId,
    ),
  ]);
  return orderId;
}

async function staffSession(): Promise<{ cookie: string; staffId: string; roleId: string }> {
  const email = `message-staff-${crypto.randomUUID()}@example.com`;
  const password = "correct-horse-battery-staple";
  const signup = await SELF.fetch("https://core.example.invalid/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://core.example.invalid" },
    body: JSON.stringify({ name: "Message staff", email, password }),
  });
  expect(signup.status).toBeLessThan(400);
  const { user } = (await signup.json()) as { user: { id: string } };
  await env.DB.prepare("UPDATE user SET email_verified=1 WHERE id=?").bind(user.id).run();
  const signin = await SELF.fetch("https://core.example.invalid/api/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://core.example.invalid" },
    body: JSON.stringify({ email, password }),
  });
  const cookie = signin.headers
    .getSetCookie()
    .map((value) => value.split(";", 1)[0])
    .join("; ");
  const staffId = crypto.randomUUID();
  const roleId = crypto.randomUUID();
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO staff_identity
      (id,auth_user_id,display_name,status,created_at,updated_at)
      VALUES (?,?,'Message staff','active',?,?)`).bind(staffId, user.id, now, now),
    env.DB.prepare("INSERT INTO role(id,code,name,created_at) VALUES (?,?,'Message role',?)").bind(
      roleId,
      `message-${crypto.randomUUID()}`,
      now,
    ),
    env.DB.prepare("INSERT INTO staff_role(staff_id,role_id) VALUES (?,?)").bind(staffId, roleId),
    env.DB.prepare(`INSERT INTO staff_scope(id,staff_id,scope_kind,market_id,location_id)
      VALUES (?,?,'global',NULL,NULL)`).bind(crypto.randomUUID(), staffId),
    env.DB.prepare(`INSERT INTO role_permission(role_id,permission_id)
      SELECT ?,id FROM permission WHERE code='orders.read'`).bind(roleId),
  ]);
  return { cookie, staffId, roleId };
}

it("commits one customer message and acknowledgement with exact replay, private attachment and expiry", async () => {
  const { cookie, customerId } = await customerSession();
  const orderId = await committedOrder(customerId);
  const rpc = createMessagesRpc(createCoreRpcContext(env), () => undefined);
  const headers = { cookie };
  expect(
    (
      await SELF.fetch(
        `https://core.example.invalid/api/commerce/messages/stream?orderId=${orderId}`,
        {
          headers: { upgrade: "websocket", origin: "https://untrusted.example", cookie },
        },
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await SELF.fetch(
        `https://core.example.invalid/api/commerce/messages/stream?orderId=${orderId}`,
        {
          headers: { upgrade: "websocket", origin: "https://core.example.invalid" },
        },
      )
    ).status,
  ).toBe(401);
  expect(
    await rpc.getCustomerOrderMessages({ requestId: "none", headers: {}, orderId }),
  ).toMatchObject({ ok: false, error: { code: "UNAUTHENTICATED" } });
  const key = crypto.randomUUID();
  const request = {
    requestId: "send",
    headers,
    orderId,
    body: "Where is my Order?",
    attachmentIds: [],
    idempotencyKey: key,
  };
  const first = await rpc.sendCustomerOrderMessage(request);
  expect(first).toMatchObject({ ok: true, value: { sequence: 1 } });
  const replay = await rpc.sendCustomerOrderMessage({ ...request, requestId: "replay" });
  expect(replay).toMatchObject({ ok: true, value: first.ok ? first.value : {} });
  expect(await rpc.sendCustomerOrderMessage({ ...request, body: "Changed" })).toMatchObject({
    ok: false,
    error: { code: "IDEMPOTENCY_CONFLICT" },
  });
  const thread = await rpc.getCustomerOrderMessages({ requestId: "read", headers, orderId });
  expect(thread).toMatchObject({
    ok: true,
    value: {
      items: [{ senderKind: "CUSTOMER", body: "Where is my Order?" }, { senderKind: "AUTOMATION" }],
    },
  });
  expect(
    await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM audit_event WHERE action='ORDER.MESSAGE_SENT' AND aggregate_id=?",
    )
      .bind(orderId)
      .first<{ n: number }>(),
  ).toMatchObject({ n: 1 });

  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
  const staged = await rpc.stageCustomerOrderMessageAttachment({
    requestId: "upload",
    headers,
    orderId,
    bytes: png,
    mimeType: "image/png",
    fileName: "proof.png",
    idempotencyKey: crypto.randomUUID(),
  });
  expect(staged).toMatchObject({ ok: true, value: { fileName: "proof.png" } });
  if (!staged.ok) return;
  expect(
    await rpc.readCustomerOrderMessageAttachment({
      requestId: "private",
      headers,
      orderId,
      attachmentId: staged.value.id,
    }),
  ).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  const sent = await rpc.sendCustomerOrderMessage({
    requestId: "send-file",
    headers,
    orderId,
    body: "",
    attachmentIds: [staged.value.id],
    idempotencyKey: crypto.randomUUID(),
  });
  expect(sent).toMatchObject({ ok: true, value: { sequence: 3, acknowledgementMessageId: null } });
  const content = await rpc.readCustomerOrderMessageAttachment({
    requestId: "download",
    headers,
    orderId,
    attachmentId: staged.value.id,
  });
  expect(content).toMatchObject({
    ok: true,
    value: { fileName: "proof.png", mimeType: "image/png" },
  });
  if (content.ok) expect([...content.value.bytes]).toEqual([...png]);

  const base = Date.now();
  const future = base + 15 * 24 * 60 * 60 * 1000;
  expect(await expireOrderMessages(env.DB, env.PRODUCT_MEDIA, future)).toBe(0);
  expect(
    await env.DB.prepare("SELECT COUNT(*) AS n FROM order_message_content WHERE message_id=?")
      .bind(first.ok ? first.value.messageId : "")
      .first<{ n: number }>(),
  ).toMatchObject({ n: 1 });

  const orphan = await rpc.stageCustomerOrderMessageAttachment({
    requestId: "orphan",
    headers,
    orderId,
    bytes: png,
    mimeType: "image/png",
    fileName: "unused.png",
    idempotencyKey: crypto.randomUUID(),
  });
  expect(orphan.ok).toBe(true);
  expect(
    await expireOrderMessages(env.DB, env.PRODUCT_MEDIA, base + 25 * 60 * 60 * 1000),
  ).toBeGreaterThan(0);
  if (orphan.ok) {
    const orphanRow = await env.DB.prepare(
      "SELECT object_key AS objectKey,status FROM order_message_upload WHERE id=?",
    )
      .bind(orphan.value.id)
      .first<{ objectKey: string; status: string }>();
    expect(orphanRow?.status).toBe("DELETED");
    expect(await env.PRODUCT_MEDIA.head(orphanRow?.objectKey ?? "missing")).toBeNull();
  }

  await env.DB.batch([
    env.DB.prepare("UPDATE grocery_order SET status='CANCELED' WHERE id=?").bind(orderId),
    env.DB.prepare(`INSERT INTO order_cancellation
      (id,order_id,actor_type,cause,reason,status,retained_service_fee_minor,
       required_refund_minor,currency,version,created_at,updated_at)
      VALUES (?,?,'CUSTOMER','CUSTOMER_REQUEST','Test close','COMPLETED',0,0,'PHP',1,?,?)`).bind(
      crypto.randomUUID(),
      orderId,
      base,
      base,
    ),
  ]);
  const user = await env.DB.prepare("SELECT auth_user_id AS id FROM customer WHERE id=?")
    .bind(customerId)
    .first<{ id: string }>();
  if (!user) throw new Error("Customer user missing");
  await env.DB.prepare(`INSERT INTO order_message_hold
    (order_id,reason,actor_user_id,created_at) VALUES (?,?,?,?)`)
    .bind(orderId, "Test hold", user.id, base)
    .run();
  expect(await expireOrderMessages(env.DB, env.PRODUCT_MEDIA, future)).toBe(0);
  await env.DB.prepare(
    "UPDATE order_message_hold SET released_at=?,released_by_user_id=? WHERE order_id=?",
  )
    .bind(base, user.id, orderId)
    .run();
  expect(await expireOrderMessages(env.DB, env.PRODUCT_MEDIA, future)).toBeGreaterThan(0);
  expect(
    await env.DB.prepare("SELECT COUNT(*) AS n FROM order_message_content WHERE message_id=?")
      .bind(first.ok ? first.value.messageId : "")
      .first<{ n: number }>(),
  ).toMatchObject({ n: 0 });
  expect(
    await rpc.getCustomerOrderMessages({ requestId: "expired", headers, orderId }),
  ).toMatchObject({ ok: true, value: { items: [] } });
  expect(
    await rpc.readCustomerOrderMessageAttachment({
      requestId: "deleted",
      headers,
      orderId,
      attachmentId: staged.value.id,
    }),
  ).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  const upload = await env.DB.prepare(
    "SELECT object_key AS objectKey,status FROM order_message_upload WHERE id=?",
  )
    .bind(staged.value.id)
    .first<{ objectKey: string; status: string }>();
  expect(upload?.status).toBe("DELETED");
  expect(await env.PRODUCT_MEDIA.head(upload?.objectKey ?? "missing")).toBeNull();
});

it("requires Orders capability and current location scope for staff messages", async () => {
  const customer = await customerSession();
  const orderId = await committedOrder(customer.customerId);
  const otherOrderId = await committedOrder(customer.customerId);
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO order_fulfillment_snapshot
      (order_id,location_id,zone_id,fulfillment_mode,sourcing_modes_json,created_at)
      VALUES (?,'location-cebu-central','zone-a','INSTANT','{}',1)`).bind(orderId),
    env.DB.prepare(`INSERT INTO order_fulfillment_snapshot
      (order_id,location_id,zone_id,fulfillment_mode,sourcing_modes_json,created_at)
      VALUES (?,'location-other','zone-b','INSTANT','{}',1)`).bind(otherOrderId),
  ]);
  const staff = await staffSession();
  const rpc = createMessagesRpc(createCoreRpcContext(env), () => undefined);
  const headers = { cookie: staff.cookie };
  expect(
    await rpc.getAdminOrderMessages({ requestId: "admin-read", headers, orderId }),
  ).toMatchObject({ ok: true });
  expect(
    await rpc.sendAdminOrderMessage({
      requestId: "admin-send",
      headers,
      orderId,
      body: "Hello",
      attachmentIds: [],
      idempotencyKey: crypto.randomUUID(),
    }),
  ).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  await env.DB.prepare(`INSERT INTO role_permission(role_id,permission_id)
    SELECT ?,id FROM permission WHERE code='orders.manage'`)
    .bind(staff.roleId)
    .run();
  expect(
    await rpc.sendAdminOrderMessage({
      requestId: "admin-send",
      headers,
      orderId,
      body: "Hello",
      attachmentIds: [],
      idempotencyKey: crypto.randomUUID(),
    }),
  ).toMatchObject({ ok: true });
  await env.DB.prepare(
    "UPDATE staff_scope SET scope_kind='location',location_id=? WHERE staff_id=?",
  )
    .bind("location-cebu-central", staff.staffId)
    .run();
  expect(await rpc.getAdminOrderMessages({ requestId: "local", headers, orderId })).toMatchObject({
    ok: true,
  });
  expect(
    await rpc.listAdminOrderConversations({
      requestId: "inbox",
      headers,
      locationId: "location-cebu-central",
    }),
  ).toMatchObject({ ok: true, value: { items: [{ orderId }] } });
  expect(await rpc.listAdminOrderConversations({ requestId: "unscoped", headers })).toMatchObject({
    ok: false,
    error: { code: "FORBIDDEN" },
  });
  expect(await rpc.getOrderAcknowledgement({ requestId: "local-settings", headers })).toMatchObject(
    { ok: false, error: { code: "FORBIDDEN" } },
  );
  expect(
    await rpc.listAdminOrderConversations({
      requestId: "other-inbox",
      headers,
      locationId: "location-other",
    }),
  ).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  const socketHeaders = {
    upgrade: "websocket",
    origin: "https://core.example.invalid",
    cookie: staff.cookie,
  };
  expect(
    (
      await SELF.fetch("https://core.example.invalid/api/admin/messages/stream", {
        headers: socketHeaders,
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await SELF.fetch(
        "https://core.example.invalid/api/admin/messages/stream?locationId=location-other",
        { headers: socketHeaders },
      )
    ).status,
  ).toBe(403);
  const locationStream = await SELF.fetch(
    "https://core.example.invalid/api/admin/messages/stream?locationId=location-cebu-central",
    { headers: socketHeaders },
  );
  expect(locationStream.status).toBe(101);
  locationStream.webSocket?.accept();
  locationStream.webSocket?.close();
  expect(
    await rpc.getAdminOrderMessages({ requestId: "other", headers, orderId: otherOrderId }),
  ).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  expect(
    await rpc.sendAdminOrderMessage({
      requestId: "other-send",
      headers,
      orderId: otherOrderId,
      body: "Wrong location",
      attachmentIds: [],
      idempotencyKey: crypto.randomUUID(),
    }),
  ).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  expect(
    await rpc.sendAdminOrderMessage({
      requestId: "local-send",
      headers,
      orderId,
      body: "Location update",
      attachmentIds: [],
      idempotencyKey: crypto.randomUUID(),
    }),
  ).toMatchObject({ ok: true });
  expect(
    await env.DB.prepare("SELECT revision FROM order_message_revision WHERE audience_key=?")
      .bind("location:location-cebu-central")
      .first(),
  ).toMatchObject({ revision: 2 });
  const staged = await rpc.stageAdminOrderMessageAttachment({
    requestId: "local-upload",
    headers,
    orderId,
    bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]),
    mimeType: "image/png",
    fileName: "location-proof.png",
    idempotencyKey: crypto.randomUUID(),
  });
  expect(staged).toMatchObject({ ok: true });
  if (!staged.ok) throw new Error("Location upload failed");
  expect(
    await rpc.sendAdminOrderMessage({
      requestId: "local-file",
      headers,
      orderId,
      body: "",
      attachmentIds: [staged.value.id],
      idempotencyKey: crypto.randomUUID(),
    }),
  ).toMatchObject({ ok: true });
  expect(
    await rpc.readAdminOrderMessageAttachment({
      requestId: "local-download",
      headers,
      orderId,
      attachmentId: staged.value.id,
    }),
  ).toMatchObject({ ok: true });
  await env.DB.prepare("DELETE FROM staff_scope WHERE staff_id=?").bind(staff.staffId).run();
  expect(await rpc.getAdminOrderMessages({ requestId: "revoked", headers, orderId })).toMatchObject(
    { ok: false, error: { code: "FORBIDDEN" } },
  );
});
