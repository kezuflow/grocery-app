import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import { enqueueNotification } from "./enqueue-notification";
import { consumeNotificationBatch, publishNotificationOutbox } from "./notification-queue";

async function notification(now: number) {
  const customerId = `queue-customer-${crypto.randomUUID()}`;
  await env.DB.prepare(
    "INSERT INTO customer (id,auth_user_id,status,created_at,updated_at) VALUES (?,?,'active',?,?)",
  )
    .bind(customerId, `auth-${customerId}`, now, now)
    .run();
  const result = await enqueueNotification(env.DB, {
    type: "ORDER_CONFIRMED",
    aggregateType: "ORDER",
    aggregateId: `order-${customerId}`,
    customerId,
    recipient: "queue@example.com",
    templateData: { orderNumber: "FM-QUEUE" },
    scheduledAt: now,
    idempotencyKey: `queue-${customerId}`,
  });
  if (!result.ok) throw new Error(result.code);
  return result.value.id;
}

function batch(outboxId: string, attempts = 1) {
  const ack = vi.fn();
  const retry = vi.fn();
  return {
    value: {
      messages: [{ body: { outboxId }, attempts, ack, retry }],
    } as unknown as MessageBatch<{ outboxId: string }>,
    ack,
    retry,
  };
}

describe("notification Queue transport", () => {
  it("publishes only the stable outbox identity and consumes duplicates idempotently", async () => {
    const now = Date.now();
    const outboxId = await notification(now);
    const messages: unknown[] = [];
    const published = await publishNotificationOutbox(
      env.DB,
      {
        async send(message) {
          messages.push(message);
        },
      },
      now,
    );
    expect(published).toEqual({ attempted: 1, published: 1 });
    expect(messages).toEqual([{ outboxId }]);
    await expect(
      env.DB.prepare(
        "SELECT publication_status,lease_owner,lease_expires_at FROM notification_outbox WHERE id=?",
      )
        .bind(outboxId)
        .first(),
    ).resolves.toEqual({
      publication_status: "PUBLISHED",
      lease_owner: null,
      lease_expires_at: null,
    });

    const send = vi.fn(async () => ({ ok: true as const }));
    const first = batch(outboxId);
    await consumeNotificationBatch(env.DB, { send }, first.value, now);
    expect(first.ack).toHaveBeenCalledOnce();
    expect(first.retry).not.toHaveBeenCalled();
    const duplicate = batch(outboxId, 2);
    await consumeNotificationBatch(env.DB, { send }, duplicate.value, now + 1);
    expect(duplicate.ack).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledOnce();
  });

  it("recovers publication failure and refuses a duplicate after an uncertain send", async () => {
    const now = Date.now();
    const outboxId = await notification(now);
    await publishNotificationOutbox(
      env.DB,
      {
        async send() {
          throw new Error("queue unavailable");
        },
      },
      now,
    );
    await expect(
      env.DB.prepare("SELECT publication_status,status FROM notification_outbox WHERE id=?")
        .bind(outboxId)
        .first(),
    ).resolves.toEqual({ publication_status: "FAILED", status: "PENDING" });
    const messages: unknown[] = [];
    await publishNotificationOutbox(
      env.DB,
      {
        async send(message) {
          messages.push(message);
        },
      },
      now + 1,
    );
    expect(messages).toEqual([{ outboxId }]);

    await env.DB.batch([
      env.DB.prepare(
        "UPDATE notification_outbox SET status='PROCESSING',available_at=? WHERE id=?",
      ).bind(now, outboxId),
      env.DB.prepare(
        "INSERT INTO notification_attempt (id,notification_id,status,attempted_at) VALUES (?,?,'PROCESSING',?)",
      ).bind(`uncertain-${outboxId}`, outboxId, now),
    ]);
    const send = vi.fn(async () => ({ ok: true as const }));
    const uncertain = batch(outboxId, 2);
    await consumeNotificationBatch(env.DB, { send }, uncertain.value, now + 5 * 60_000);
    expect(uncertain.ack).toHaveBeenCalledOnce();
    expect(send).not.toHaveBeenCalled();
    await expect(
      env.DB.prepare("SELECT status,last_error_code FROM notification_outbox WHERE id=?")
        .bind(outboxId)
        .first(),
    ).resolves.toEqual({ status: "FAILED", last_error_code: "SEND_OUTCOME_UNKNOWN" });
  });
});
