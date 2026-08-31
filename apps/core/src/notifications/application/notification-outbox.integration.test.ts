import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { deliverNotifications } from "./deliver-notifications";
import { enqueueNotification } from "./enqueue-notification";
import {
  projectDomainNotifications,
  projectOrderCancellationNotification,
} from "./project-domain-notifications";

async function customer() {
  const id = `notification-customer-${crypto.randomUUID()}`;
  await env.DB.prepare(
    "INSERT INTO customer (id,auth_user_id,status,created_at,updated_at) VALUES (?,?,'active',1,1)",
  )
    .bind(id, `auth-${id}`)
    .run();
  return id;
}

describe("notification outbox", () => {
  it("deduplicates intent and records successful delivery independently", async () => {
    const customerId = await customer();
    const key = `notification-${crypto.randomUUID()}`;
    const input = {
      type: "ORDER_CONFIRMED" as const,
      aggregateType: "ORDER",
      aggregateId: "order-1",
      customerId,
      recipient: "customer@example.com",
      templateData: { orderNumber: "FM-1" },
      scheduledAt: 100,
      idempotencyKey: key,
    };
    await enqueueNotification(env.DB, input);
    await enqueueNotification(env.DB, input);
    const sent: string[] = [];
    const result = await deliverNotifications(
      env.DB,
      {
        async send(message) {
          sent.push(message.subject);
          return { ok: true };
        },
      },
      100,
    );
    expect(result).toEqual({ attempted: 1, delivered: 1 });
    expect(sent).toEqual(["Your FreshMarkets order is confirmed"]);
    expect(
      await env.DB.prepare(
        "SELECT status,attempts,(SELECT COUNT(*) FROM notification_attempt WHERE notification_id=notification_outbox.id) attemptRows FROM notification_outbox WHERE idempotency_key=?",
      )
        .bind(key)
        .first(),
    ).toEqual({ status: "SENT", attempts: 1, attemptRows: 1 });
  });

  it("retries with backoff, recovers expired leases, and terminates after five failures", async () => {
    const customerId = await customer();
    const key = `notification-fail-${crypto.randomUUID()}`;
    await enqueueNotification(env.DB, {
      type: "PAYMENT_FAILED",
      aggregateType: "PAYMENT",
      aggregateId: "payment-1",
      customerId,
      recipient: "customer@example.com",
      templateData: {},
      scheduledAt: 1,
      idempotencyKey: key,
    });
    const failing = {
      async send() {
        return { ok: false as const, code: "TEMPORARY" };
      },
    };
    let now = 1;
    for (let attempt = 1; attempt <= 5; attempt++) {
      await deliverNotifications(env.DB, failing, now);
      const row = await env.DB.prepare(
        "SELECT status,available_at FROM notification_outbox WHERE idempotency_key=?",
      )
        .bind(key)
        .first<{ status: string; available_at: number }>();
      if (attempt < 5) expect(row?.status).toBe("PENDING");
      now = row?.available_at ?? now;
    }
    expect(
      await env.DB.prepare(
        "SELECT status,attempts FROM notification_outbox WHERE idempotency_key=?",
      )
        .bind(key)
        .first(),
    ).toEqual({ status: "FAILED", attempts: 5 });
  });

  it("projects a stable order-confirmed fact once", async () => {
    const suffix = crypto.randomUUID();
    const userId = `notification-user-${suffix}`;
    const customerId = `notification-project-${suffix}`;
    const paymentId = `notification-payment-${suffix}`;
    const orderId = `notification-order-${suffix}`;
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO user (id,name,email,email_verified,created_at,updated_at) VALUES (?,'Customer',?,1,?,?)",
      ).bind(userId, `${suffix}@example.com`, now, now),
      env.DB.prepare(
        "INSERT INTO customer (id,auth_user_id,status,created_at,updated_at) VALUES (?,?,'active',?,?)",
      ).bind(customerId, userId, now, now),
      env.DB.prepare(
        "INSERT INTO payment_attempt (id,customer_id,amount_minor,currency,status,provider,idempotency_key,created_at,updated_at) VALUES (?,?,100,'PHP','SUCCEEDED','mock',?,?,?)",
      ).bind(paymentId, customerId, `notification-payment-key-${suffix}`, now, now),
      env.DB.prepare(
        "INSERT INTO grocery_order (id,customer_id,cycle_id,fulfillment_mode,address_snapshot_json,status,total_minor,currency,payment_id,version,created_at,order_number,committed_at) VALUES (?,?,'cycle-next-cebu','SCHEDULED','{}','COMMITTED',100,'PHP',?,1,?,'FM-NOTIFICATION',?)",
      ).bind(orderId, customerId, paymentId, now, now),
    ]);
    expect(await projectDomainNotifications(env.DB, now)).toBeGreaterThanOrEqual(1);
    await projectDomainNotifications(env.DB, now);
    expect(
      await env.DB.prepare("SELECT COUNT(*) count FROM notification_outbox WHERE idempotency_key=?")
        .bind(`order-confirmed:${orderId}`)
        .first(),
    ).toEqual({ count: 1 });
  });

  it("deduplicates cancellation transitions and leaves commerce state unchanged on delivery failure", async () => {
    const suffix = crypto.randomUUID();
    const userId = `cancellation-user-${suffix}`;
    const customerId = `cancellation-project-${suffix}`;
    const attemptId = `cancellation-attempt-${suffix}`;
    const orderId = `cancellation-order-${suffix}`;
    const cancellationId = `cancellation-${suffix}`;
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO user (id,name,email,email_verified,created_at,updated_at) VALUES (?,'Customer',?,1,?,?)",
      ).bind(userId, `${suffix}@example.com`, now, now),
      env.DB.prepare(
        "INSERT INTO customer (id,auth_user_id,status,created_at,updated_at) VALUES (?,?,'active',?,?)",
      ).bind(customerId, userId, now, now),
      env.DB.prepare(
        "INSERT INTO payment_attempt (id,customer_id,amount_minor,currency,status,provider,idempotency_key,created_at,updated_at) VALUES (?,?,10000,'PHP','SUCCEEDED','mock',?,?,?)",
      ).bind(attemptId, customerId, `cancel-attempt-${suffix}`, now, now),
      env.DB.prepare(
        "INSERT INTO grocery_order (id,customer_id,cycle_id,fulfillment_mode,address_snapshot_json,status,total_minor,currency,payment_id,version,created_at,order_number,committed_at) VALUES (?,?,NULL,'INSTANT','{}','CANCELLATION_REQUESTED',10000,'PHP',?,2,?,'FM-CANCEL-NOTIFY',?)",
      ).bind(orderId, customerId, attemptId, now, now),
      env.DB.prepare(
        "INSERT INTO order_cancellation (id,order_id,actor_type,cause,reason,status,retained_service_fee_minor,required_refund_minor,currency,version,created_at,updated_at) VALUES (?,?,'CUSTOMER','CUSTOMER_REQUEST','Plans changed','REQUESTED',500,9500,'PHP',1,?,?)",
      ).bind(cancellationId, orderId, now, now),
    ]);

    await projectOrderCancellationNotification(env.DB, {
      cancellationId,
      state: "REQUESTED",
      scheduledAt: now,
    });
    await projectOrderCancellationNotification(env.DB, {
      cancellationId,
      state: "REQUESTED",
      scheduledAt: now,
    });
    await env.DB.prepare(
      "UPDATE order_cancellation SET status='REFUNDS_PROCESSING',version=version+1 WHERE id=?",
    )
      .bind(cancellationId)
      .run();
    await projectOrderCancellationNotification(env.DB, {
      cancellationId,
      state: "REFUNDS_PROCESSING",
      scheduledAt: now,
    });

    expect(
      await env.DB.prepare(
        "SELECT event_type,COUNT(*) AS count FROM notification_outbox WHERE aggregate_id=? GROUP BY event_type ORDER BY event_type",
      )
        .bind(cancellationId)
        .all(),
    ).toMatchObject({
      results: [
        { event_type: "ORDER_CANCELLATION_REQUESTED", count: 1 },
        { event_type: "ORDER_REFUND_PROGRESSING", count: 1 },
      ],
    });

    await deliverNotifications(
      env.DB,
      {
        async send() {
          return { ok: false, code: "TEMPORARY" } as const;
        },
      },
      now,
    );
    expect(
      await env.DB.prepare("SELECT status FROM grocery_order WHERE id=?").bind(orderId).first(),
    ).toEqual({ status: "CANCELLATION_REQUESTED" });
    expect(
      await env.DB.prepare("SELECT status FROM order_cancellation WHERE id=?")
        .bind(cancellationId)
        .first(),
    ).toEqual({ status: "REFUNDS_PROCESSING" });
  });
});
