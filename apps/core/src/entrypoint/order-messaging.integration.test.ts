import { env } from "cloudflare:workers";
import { SELF } from "cloudflare:test";
import { expect, it, vi } from "vitest";
import { createCoreRpcContext } from "./context";
import { createMessagesRpc } from "./messages-rpc";
import { expireOrderMessages } from "../messages/application/expire-order-messages";
import {
  cancelOrderMessageAttachment,
  stageOrderMessageAttachment,
} from "../messages/application/order-message-attachments";

const png = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4////fwAJ+wP9CNHoHgAAAABJRU5ErkJggg==",
  ),
  (character) => character.charCodeAt(0),
);

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
  const staff = await staffSession();
  expect(
    await rpc.listAdminOrderConversations({
      requestId: "admin-unread-after-acknowledgement",
      headers: { cookie: staff.cookie },
    }),
  ).toMatchObject({
    ok: true,
    value: {
      items: [{ unreadCount: 1, recentIncomingSequences: [1] }],
      totalUnreadCount: 1,
    },
  });
  expect(
    await rpc.listCustomerOrderConversations({ requestId: "customer-acknowledgement", headers }),
  ).toMatchObject({
    ok: true,
    value: {
      items: [{ unreadCount: 1, recentIncomingSequences: [2] }],
      totalUnreadCount: 1,
    },
  });
  expect(
    await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM audit_event WHERE action='ORDER.MESSAGE_SENT' AND aggregate_id=?",
    )
      .bind(orderId)
      .first<{ n: number }>(),
  ).toMatchObject({ n: 1 });

  const pdfKey = crypto.randomUUID();
  expect(
    await rpc.stageCustomerOrderMessageAttachment({
      requestId: "pdf-rejected",
      headers,
      orderId,
      bytes: new TextEncoder().encode("%PDF-1.7"),
      mimeType: "application/pdf",
      fileName: "document.pdf",
      idempotencyKey: pdfKey,
    }),
  ).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
  expect(
    await env.DB.prepare("SELECT id FROM order_message_upload WHERE idempotency_key=?")
      .bind(pdfKey)
      .first(),
  ).toBeNull();
  const invalidKey = crypto.randomUUID();
  expect(
    await rpc.stageCustomerOrderMessageAttachment({
      requestId: "corrupt-image",
      headers,
      orderId,
      bytes: Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0]),
      mimeType: "image/png",
      fileName: "corrupt.png",
      idempotencyKey: invalidKey,
    }),
  ).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
  expect(
    await env.DB.prepare("SELECT id FROM order_message_upload WHERE idempotency_key=?")
      .bind(invalidKey)
      .first(),
  ).toMatchObject({ id: expect.any(String) });
  const uploadRequest = {
    requestId: "upload",
    headers,
    orderId,
    bytes: png,
    mimeType: "image/png",
    fileName: "proof.png",
    idempotencyKey: crypto.randomUUID(),
  };
  const staged = await rpc.stageCustomerOrderMessageAttachment(uploadRequest);
  if (!staged.ok) throw new Error(staged.error.message);
  expect(staged).toMatchObject({
    ok: true,
    value: { fileName: "proof.webp", mimeType: "image/webp" },
  });
  if (!staged.ok) return;
  expect(
    await rpc.stageCustomerOrderMessageAttachment({ ...uploadRequest, requestId: "upload-replay" }),
  ).toMatchObject({ ok: true, value: { id: staged.value.id } });
  const changed = png.slice();
  changed[changed.length - 1] ^= 1;
  expect(
    await rpc.stageCustomerOrderMessageAttachment({ ...uploadRequest, bytes: changed }),
  ).toMatchObject({ ok: false, error: { code: "IDEMPOTENCY_CONFLICT" } });
  const storedUpload = await env.DB.prepare(`SELECT object_key AS objectKey,
    mime_type AS storedMime,byte_size AS storedSize,content_digest AS storedDigest,
    input_mime_type AS inputMime,input_byte_size AS inputSize,input_digest AS inputDigest
    FROM order_message_upload WHERE id=?`)
    .bind(staged.value.id)
    .first<{
      objectKey: string;
      storedMime: string;
      storedSize: number;
      storedDigest: string;
      inputMime: string;
      inputSize: number;
      inputDigest: string;
    }>();
  expect(storedUpload).toMatchObject({
    storedMime: "image/webp",
    inputMime: "image/png",
    inputSize: png.byteLength,
  });
  expect(storedUpload?.storedDigest).not.toBe(storedUpload?.inputDigest);
  const storedObject = await env.PRODUCT_MEDIA.head(storedUpload?.objectKey ?? "missing");
  expect(storedObject?.size).toBe(storedUpload?.storedSize);
  expect(storedObject?.httpMetadata?.contentType).toBe("image/webp");
  await env.DB.prepare("UPDATE order_message_upload SET status='UNKNOWN' WHERE id=?")
    .bind(staged.value.id)
    .run();
  expect(await rpc.stageCustomerOrderMessageAttachment(uploadRequest)).toMatchObject({
    ok: true,
    value: { id: staged.value.id },
  });
  expect(
    await env.DB.prepare("SELECT status FROM order_message_upload WHERE id=?")
      .bind(staged.value.id)
      .first(),
  ).toMatchObject({ status: "STORED" });
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
    value: { fileName: "proof.webp", mimeType: "image/webp" },
  });
  if (content.ok)
    expect(new TextDecoder().decode(content.value.bytes.subarray(8, 12))).toBe("WEBP");

  const legacyPdf = new TextEncoder().encode("%PDF-1.7 legacy attachment");
  const legacyId = crypto.randomUUID();
  const legacyKey = `messages/${orderId}/${legacyId}`;
  const userId = await env.DB.prepare("SELECT auth_user_id AS id FROM customer WHERE id=?")
    .bind(customerId)
    .first<{ id: string }>();
  if (!userId || !sent.ok) throw new Error("Legacy fixture setup failed");
  await env.DB.prepare(`INSERT INTO order_message_upload
    (id,order_id,actor_kind,actor_user_id,idempotency_key,message_id,object_key,
     file_name,mime_type,byte_size,content_digest,status,created_at,updated_at)
    VALUES (?,?,'CUSTOMER',?,?,?,?,?,'application/pdf',?,'legacy-digest','ATTACHED',?,?)`)
    .bind(
      legacyId,
      orderId,
      userId.id,
      crypto.randomUUID(),
      sent.value.messageId,
      legacyKey,
      "old-document.pdf",
      legacyPdf.byteLength,
      Date.now(),
      Date.now(),
    )
    .run();
  await env.PRODUCT_MEDIA.put(legacyKey, legacyPdf, {
    httpMetadata: { contentType: "application/pdf" },
    customMetadata: { contentDigest: "legacy-digest" },
  });
  expect(
    await rpc.readCustomerOrderMessageAttachment({
      requestId: "legacy-download",
      headers,
      orderId,
      attachmentId: legacyId,
    }),
  ).toMatchObject({
    ok: true,
    value: { fileName: "old-document.pdf", mimeType: "application/pdf" },
  });

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
  const futureRpc = createMessagesRpc(
    createCoreRpcContext(env, { now: () => new Date(future) }),
    () => undefined,
  );
  expect(
    await futureRpc.listCustomerOrderConversations({
      requestId: "held-unread",
      headers,
    }),
  ).toMatchObject({ ok: true, value: { totalUnreadCount: 1 } });
  expect(await expireOrderMessages(env.DB, env.PRODUCT_MEDIA, future)).toBe(0);
  await env.DB.prepare(
    "UPDATE order_message_hold SET released_at=?,released_by_user_id=? WHERE order_id=?",
  )
    .bind(base, user.id, orderId)
    .run();
  expect(
    await futureRpc.listCustomerOrderConversations({
      requestId: "expired-unread",
      headers,
    }),
  ).toMatchObject({ ok: true, value: { totalUnreadCount: 0 } });
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

it("limits unsent photos before transformation and cancels removed uploads", async () => {
  const { cookie, customerId } = await customerSession();
  const orderId = await committedOrder(customerId);
  const rpc = createMessagesRpc(createCoreRpcContext(env), () => undefined);
  const headers = { cookie };
  const request = (key: string) => ({
    requestId: key,
    headers,
    orderId,
    bytes: png,
    mimeType: "image/png",
    fileName: "proof.png",
    idempotencyKey: key,
  });
  const keys = Array.from({ length: 4 }, () => crypto.randomUUID());
  const staged = await Promise.all(
    keys.slice(0, 3).map(async (key) => rpc.stageCustomerOrderMessageAttachment(request(key))),
  );
  expect(staged.every((result) => result.ok)).toBe(true);
  expect(await rpc.stageCustomerOrderMessageAttachment(request(keys[3]))).toMatchObject({
    ok: false,
    error: { code: "CONFLICT" },
  });
  expect(
    await env.DB.prepare("SELECT id FROM order_message_upload WHERE idempotency_key=?")
      .bind(keys[3])
      .first(),
  ).toBeNull();
  const cancel = { requestId: "cancel", headers, orderId, idempotencyKey: keys[0] };
  expect(await rpc.cancelCustomerOrderMessageAttachment(cancel)).toMatchObject({
    ok: true,
    value: { canceled: true },
  });
  expect(await rpc.cancelCustomerOrderMessageAttachment(cancel)).toMatchObject({ ok: true });
  expect(await rpc.stageCustomerOrderMessageAttachment(request(keys[0]))).toMatchObject({
    ok: false,
    error: { code: "CONFLICT" },
  });
  expect(await rpc.stageCustomerOrderMessageAttachment(request(keys[3]))).toMatchObject({
    ok: true,
  });
  const canceled = await env.DB.prepare(`SELECT object_key AS objectKey,status,file_name AS fileName
    FROM order_message_upload WHERE idempotency_key=?`)
    .bind(keys[0])
    .first<{ objectKey: string; status: string; fileName: string | null }>();
  expect(canceled).toMatchObject({ status: "DELETE_PENDING", fileName: null });
  await expireOrderMessages(env.DB, env.PRODUCT_MEDIA, Date.now() + 180_000);
  expect(await env.PRODUCT_MEDIA.head(canceled?.objectKey ?? "missing")).toBeNull();

  const removedBeforeUpload = crypto.randomUUID();
  expect(
    await rpc.cancelCustomerOrderMessageAttachment({
      requestId: "cancel-early",
      headers,
      orderId,
      idempotencyKey: removedBeforeUpload,
    }),
  ).toMatchObject({ ok: true });
  expect(await rpc.stageCustomerOrderMessageAttachment(request(removedBeforeUpload))).toMatchObject(
    {
      ok: false,
      error: { code: "CONFLICT" },
    },
  );
  expect(
    await env.DB.prepare("SELECT id FROM order_message_upload WHERE idempotency_key=?")
      .bind(removedBeforeUpload)
      .first(),
  ).toBeNull();
});

it("prevents a conversion already in flight from storing a removed photo", async () => {
  const { cookie, customerId } = await customerSession();
  const orderId = await committedOrder(customerId);
  const rpcContext = createCoreRpcContext(env);
  let entered!: () => void;
  let release!: () => void;
  const converting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const images = {
    info: async (stream: ReadableStream<Uint8Array>) => {
      entered();
      await gate;
      return env.IMAGES.info(stream);
    },
    input: (stream: ReadableStream<Uint8Array>) => env.IMAGES.input(stream),
  } as ImagesBinding;
  const context = {
    env: { DB: env.DB, PRODUCT_MEDIA: env.PRODUCT_MEDIA, IMAGES: images },
    auth: rpcContext.auth,
    access: rpcContext.access,
  };
  const idempotencyKey = crypto.randomUUID();
  const request = {
    requestId: "racing-stage",
    headers: { cookie },
    orderId,
    bytes: png,
    mimeType: "image/png",
    fileName: "race.png",
    idempotencyKey,
  };
  const stage = stageOrderMessageAttachment(context, request, "CUSTOMER");
  await converting;
  expect(
    await cancelOrderMessageAttachment(
      context,
      { ...request, requestId: "racing-cancel" },
      "CUSTOMER",
    ),
  ).toMatchObject({ ok: true });
  release();
  expect(await stage).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
  const row = await env.DB.prepare(`SELECT object_key AS objectKey,status FROM order_message_upload
    WHERE idempotency_key=?`)
    .bind(idempotencyKey)
    .first<{ objectKey: string; status: string }>();
  expect(row?.status).toBe("DELETE_PENDING");
  expect(await env.PRODUCT_MEDIA.head(row?.objectKey ?? "missing")).toBeNull();
});

it("returns permanent validation and account-quota errors without storing originals", async () => {
  const { cookie, customerId } = await customerSession();
  const orderId = await committedOrder(customerId);
  const rpcContext = createCoreRpcContext(env);
  const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    for (const [providerCode, appCode] of [
      [9520, "VALIDATION_FAILED"],
      [9422, "CONFIGURATION_ERROR"],
    ] as const) {
      const images = {
        info: async () => {
          throw { code: providerCode };
        },
      } as unknown as ImagesBinding;
      const context = {
        env: { DB: env.DB, PRODUCT_MEDIA: env.PRODUCT_MEDIA, IMAGES: images },
        auth: rpcContext.auth,
        access: rpcContext.access,
      };
      const key = crypto.randomUUID();
      expect(
        await stageOrderMessageAttachment(
          context,
          {
            requestId: `image-error-${providerCode}`,
            headers: { cookie },
            orderId,
            bytes: png,
            mimeType: "image/png",
            fileName: "proof.png",
            idempotencyKey: key,
          },
          "CUSTOMER",
        ),
      ).toMatchObject({ ok: false, error: { code: appCode } });
      expect(
        await env.DB.prepare(`SELECT status,file_name AS fileName,normalization_ready AS ready
        FROM order_message_upload WHERE idempotency_key=?`)
          .bind(key)
          .first(),
      ).toMatchObject({ status: "DELETED", fileName: null, ready: 0 });
    }
    expect(logged.mock.calls.map(([entry]) => String(entry))).toEqual(
      expect.arrayContaining([
        expect.stringContaining('"event":"message_image_processing_failure","code":9422'),
      ]),
    );
  } finally {
    logged.mockRestore();
  }
});

it("counts customer unread messages across inbox pages and clears them after a read", async () => {
  const customer = await customerSession();
  const firstOrderId = await committedOrder(customer.customerId);
  const secondOrderId = await committedOrder(customer.customerId);
  const staff = await staffSession();
  await env.DB.prepare(`INSERT INTO role_permission(role_id,permission_id)
    SELECT ?,id FROM permission WHERE code='orders.manage'`)
    .bind(staff.roleId)
    .run();
  const rpc = createMessagesRpc(createCoreRpcContext(env), () => undefined);
  for (const orderId of [firstOrderId, secondOrderId]) {
    expect(
      await rpc.sendAdminOrderMessage({
        requestId: `send-${orderId}`,
        headers: { cookie: staff.cookie },
        orderId,
        body: "A new update",
        attachmentIds: [],
        idempotencyKey: crypto.randomUUID(),
      }),
    ).toMatchObject({ ok: true });
  }
  const headers = { cookie: customer.cookie };
  expect(
    await rpc.listCustomerOrderConversations({ requestId: "first-page", headers, limit: 1 }),
  ).toMatchObject({ ok: true, value: { items: [{ unreadCount: 1 }], totalUnreadCount: 2 } });
  expect(
    await rpc.markCustomerOrderConversationRead({
      requestId: "mark-read",
      headers,
      orderId: firstOrderId,
      throughSequence: 1,
    }),
  ).toMatchObject({ ok: true });
  expect(
    await rpc.listCustomerOrderConversations({ requestId: "after-read", headers, limit: 1 }),
  ).toMatchObject({ ok: true, value: { totalUnreadCount: 1 } });
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
    bytes: png,
    mimeType: "image/png",
    fileName: "location-proof.png",
    idempotencyKey: crypto.randomUUID(),
  });
  if (!staged.ok) throw new Error(staged.error.message);
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
