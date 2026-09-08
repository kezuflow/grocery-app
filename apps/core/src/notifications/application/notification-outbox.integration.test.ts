import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { deliverNotifications, deliverNotificationById } from "./deliver-notifications";
import { enqueueNotification } from "./enqueue-notification";
import { createCloudflareEmailDeliveryPort } from "../infrastructure/email-delivery-port";
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
  async function pending() {
    const customerId = await customer();
    const result = await enqueueNotification(env.DB, {
      type: "ORDER_CONFIRMED",
      aggregateType: "ORDER",
      aggregateId: crypto.randomUUID(),
      customerId,
      recipient: "test@example.com",
      templateData: {},
      scheduledAt: 1,
      idempotencyKey: crypto.randomUUID(),
    });
    if (!result.ok) throw new Error("Missing notification");
    return result.value.id;
  }
  it("never retries a provider-accepted send whose response is lost", async () => {
    const id = await pending();
    let sends = 0;
    const port = createCloudflareEmailDeliveryPort({
      AUTH_EMAIL_FROM: "orders@example.com",
      EMAIL: {
        async send() {
          sends++;
          throw new Error("Network response lost");
        },
      },
    });
    expect(await deliverNotificationById(env.DB, port, id, 1)).toBe("TERMINAL");
    expect(await deliverNotificationById(env.DB, port, id, 1_000_000)).toBe("TERMINAL");
    expect(sends).toBe(1);
    expect(
      await env.DB.prepare(
        "SELECT status,last_error_code,attempts FROM notification_outbox WHERE id=?",
      )
        .bind(id)
        .first(),
    ).toEqual({ status: "FAILED", last_error_code: "SEND_OUTCOME_UNKNOWN", attempts: 1 });
  });
  it("allows one concurrent consumer to contact the provider", async () => {
    const id = await pending();
    let sends = 0;
    const port = {
      async send() {
        sends++;
        return { ok: true as const };
      },
    };
    const results = await Promise.all(
      Array.from({ length: 4 }, () => deliverNotificationById(env.DB, port, id, 1)),
    );
    expect(sends).toBe(1);
    expect(results.filter((result) => result === "SENT")).toHaveLength(1);
    expect(await deliverNotificationById(env.DB, port, id, 2)).toBe("ALREADY_SENT");
    expect(
      await env.DB.prepare(
        "SELECT count(*) count FROM notification_attempt WHERE notification_id=?",
      )
        .bind(id)
        .first(),
    ).toEqual({ count: 1 });
  });
  it.each(["outbox", "attempt"])(
    "retains uncertainty when final %s evidence cannot commit",
    async (effect) => {
      const id = await pending();
      let sends = 0;
      const port = {
        async send() {
          sends++;
          return { ok: true as const };
        },
      };
      const target = effect === "outbox" ? "notification_outbox" : "notification_attempt";
      await env.DB.exec(
        `CREATE TRIGGER ignore_send_completion BEFORE UPDATE ON ${target} WHEN NEW.status='SENT' BEGIN SELECT RAISE(IGNORE); END;`,
      );
      try {
        expect(await deliverNotificationById(env.DB, port, id, 1)).toBe("BUSY");
        expect(
          await env.DB.prepare("SELECT status FROM notification_outbox WHERE id=?")
            .bind(id)
            .first(),
        ).toEqual({ status: "PROCESSING" });
        expect(
          await env.DB.prepare("SELECT status FROM notification_attempt WHERE notification_id=?")
            .bind(id)
            .first(),
        ).toEqual({ status: "PROCESSING" });
      } finally {
        await env.DB.exec("DROP TRIGGER ignore_send_completion");
      }
      expect(await deliverNotificationById(env.DB, port, id, 300_002)).toBe("TERMINAL");
      expect(sends).toBe(1);
    },
  );
  it("applies a late known success to the same uncertain attempt", async () => {
    const id = await pending();
    let sends = 0;
    expect(
      await deliverNotificationById(
        env.DB,
        {
          async send() {
            sends++;
            expect(
              await deliverNotificationById(
                env.DB,
                {
                  async send() {
                    throw new Error("Must not send replacement");
                  },
                },
                id,
                300_002,
              ),
            ).toBe("TERMINAL");
            return { ok: true };
          },
        },
        id,
        1,
      ),
    ).toBe("SENT");
    expect(sends).toBe(1);
    expect(
      await env.DB.prepare("SELECT status,last_error_code FROM notification_outbox WHERE id=?")
        .bind(id)
        .first(),
    ).toEqual({ status: "SENT", last_error_code: null });
    expect(
      await env.DB.prepare("SELECT status FROM notification_attempt WHERE notification_id=?")
        .bind(id)
        .first(),
    ).toEqual({ status: "SENT" });
  });
  it("never performs a sixth send after the fifth result persistence is lost", async () => {
    const id = await pending();
    let now = 1;
    let sends = 0;
    for (let attempt = 1; attempt < 5; attempt++) {
      expect(
        await deliverNotificationById(
          env.DB,
          {
            async send() {
              sends++;
              return { ok: false, code: "RATE_LIMITED", outcome: "NOT_SENT" };
            },
          },
          id,
          now,
        ),
      ).toBe("RETRY");
      const row = await env.DB.prepare("SELECT available_at FROM notification_outbox WHERE id=?")
        .bind(id)
        .first<{ available_at: number }>();
      if (!row) throw new Error("Missing notification");
      now = row.available_at;
    }
    await env.DB.exec(
      "CREATE TRIGGER ignore_fifth_send BEFORE UPDATE ON notification_outbox WHEN NEW.status='SENT' BEGIN SELECT RAISE(IGNORE); END;",
    );
    try {
      expect(
        await deliverNotificationById(
          env.DB,
          {
            async send() {
              sends++;
              return { ok: true };
            },
          },
          id,
          now,
        ),
      ).toBe("BUSY");
    } finally {
      await env.DB.exec("DROP TRIGGER ignore_fifth_send");
    }
    await deliverNotifications(
      env.DB,
      {
        async send() {
          throw new Error("Sixth send forbidden");
        },
      },
      now + 300_001,
    );
    expect(sends).toBe(5);
    expect(
      await env.DB.prepare(
        "SELECT status,attempts,last_error_code FROM notification_outbox WHERE id=?",
      )
        .bind(id)
        .first(),
    ).toEqual({ status: "FAILED", attempts: 5, last_error_code: "SEND_OUTCOME_UNKNOWN" });
  });
  it("respects the scheduled instant on direct delivery commands", async () => {
    const id = await pending();
    let sends = 0;
    await env.DB.prepare("UPDATE notification_outbox SET scheduled_at=100 WHERE id=?")
      .bind(id)
      .run();
    const port = {
      async send() {
        sends++;
        return { ok: true as const };
      },
    };
    expect(await deliverNotificationById(env.DB, port, id, 99)).toBe("BUSY");
    expect(sends).toBe(0);
    expect(await deliverNotificationById(env.DB, port, id, 100)).toBe("SENT");
    expect(sends).toBe(1);
  });
  it("cannot send without its durable attempt record", async () => {
    const customerId = await customer();
    const queued = await enqueueNotification(env.DB, {
      type: "ORDER_CONFIRMED",
      aggregateType: "ORDER",
      aggregateId: "attempt-proof",
      customerId,
      recipient: "proof@example.com",
      templateData: {},
      scheduledAt: 1,
      idempotencyKey: crypto.randomUUID(),
    });
    if (!queued.ok) throw new Error("Missing intent");
    let sends = 0;
    await env.DB.exec(
      "CREATE TRIGGER ignore_email_attempt BEFORE INSERT ON notification_attempt BEGIN SELECT RAISE(IGNORE); END;",
    );
    try {
      await deliverNotificationById(
        env.DB,
        {
          async send() {
            sends++;
            return { ok: true };
          },
        },
        queued.value.id,
        1,
      );
      expect(sends).toBe(0);
      expect(
        await env.DB.prepare("SELECT status,attempts FROM notification_outbox WHERE id=?")
          .bind(queued.value.id)
          .first(),
      ).toEqual({ status: "PENDING", attempts: 0 });
    } finally {
      await env.DB.exec("DROP TRIGGER ignore_email_attempt");
    }
    expect(
      await deliverNotificationById(
        env.DB,
        {
          async send() {
            sends++;
            return { ok: true };
          },
        },
        queued.value.id,
        1,
      ),
    ).toBe("SENT");
    expect(sends).toBe(1);
  });
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
        return { ok: false as const, code: "TEMPORARY", outcome: "NOT_SENT" as const };
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
          return { ok: false, code: "TEMPORARY", outcome: "NOT_SENT" } as const;
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
