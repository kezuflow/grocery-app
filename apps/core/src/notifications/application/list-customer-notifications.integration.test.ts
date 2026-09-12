import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { seedTestInstantOrder } from "../../test-commerce-fixtures";
import { listCustomerNotifications } from "./list-customer-notifications";
import { enqueueNotification } from "./enqueue-notification";
import type { NotificationType } from "../domain/notification";

async function notice(
  customerId: string,
  orderId: string,
  type: NotificationType,
  at: number,
  aggregateType = "DELIVERY",
) {
  const result = await enqueueNotification(env.DB, {
    type,
    aggregateType,
    aggregateId: orderId,
    customerId,
    recipient: "private@example.com",
    templateData: { orderNumber: "PRIVATE PAYLOAD" },
    scheduledAt: at,
    idempotencyKey: crypto.randomUUID(),
  });
  if (!result.ok) throw new Error("Fixture notification failed");
  return result.value.id;
}

describe("customer notification read boundary", () => {
  it("projects cancellation and verified refund completion, never completion from a template alone", async () => {
    const order = crypto.randomUUID();
    await seedTestInstantOrder(env.DB, order);
    const customerId = `customer-${order}`;
    const cancellation = crypto.randomUUID();
    const payment = crypto.randomUUID();
    const refund = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO order_cancellation(id,order_id,actor_type,cause,reason,status,retained_service_fee_minor,required_refund_minor,currency,version,created_at,updated_at) VALUES (?,?,'CUSTOMER','CUSTOMER_REQUEST','Test','COMPLETED',0,100,'PHP',1,1,5)",
    )
      .bind(cancellation, order)
      .run();
    for (const type of [
      "ORDER_CANCELLATION_REQUESTED",
      "ORDER_REFUND_PROGRESSING",
      "ORDER_CANCELLATION_COMPLETED",
      "ORDER_REFUND_EXCEPTION",
      "ORDER_REFUND_COMPLETED",
    ] as const)
      await notice(customerId, cancellation, type, 2, "ORDER_CANCELLATION");
    let result = await listCustomerNotifications(env.DB, { customerId, requestId: "refund" }, 100);
    if (!result.ok) throw new Error("Missing read");
    expect(result.value.items.map((item) => item.type).sort()).toEqual([
      "ORDER_CANCELLATION_COMPLETED",
      "ORDER_CANCELLATION_REQUESTED",
      "ORDER_REFUND_PROGRESSING",
    ]);
    await env.DB.prepare("UPDATE order_cancellation SET status='EXCEPTION' WHERE id=?")
      .bind(cancellation)
      .run();
    result = await listCustomerNotifications(env.DB, { customerId, requestId: "refund" }, 100);
    if (!result.ok) throw new Error("Missing read");
    expect(result.value.items.find((item) => item.type === "ORDER_REFUND_EXCEPTION")?.href).toBe(
      "mailto:support@freshmarkets.ph",
    );
    await env.DB.prepare("UPDATE order_cancellation SET status='COMPLETED' WHERE id=?")
      .bind(cancellation)
      .run();
    await env.DB.prepare(
      "INSERT INTO payment_intent(id,purpose,subject_type,subject_id,customer_id,amount_minor,currency,status,idempotency_key,created_at,updated_at) VALUES (?,'GROCERY_CHECKOUT','ORDER',?,?,100,'PHP','SUCCEEDED',?,1,1)",
    )
      .bind(payment, order, customerId, payment)
      .run();
    await env.DB.prepare(
      "INSERT INTO payment_refund(id,payment_intent_id,amount_minor,currency,status,idempotency_key,created_at,updated_at) VALUES (?,?,100,'PHP','SUCCEEDED',?,1,5)",
    )
      .bind(refund, payment, refund)
      .run();
    await env.DB.prepare(
      "INSERT INTO order_cancellation_refund_member(id,cancellation_id,payment_intent_id,required_amount_minor,currency,refund_id,status,created_at,updated_at) VALUES (?,?,?,100,'PHP',?,'SUCCEEDED',1,5)",
    )
      .bind(crypto.randomUUID(), cancellation, payment, refund)
      .run();
    result = await listCustomerNotifications(env.DB, { customerId, requestId: "refund" }, 100);
    if (!result.ok) throw new Error("Missing read");
    expect(result.value.items[0]).toMatchObject({
      type: "ORDER_REFUND_COMPLETED",
      href: `/orders/${order}`,
    });
    expect(result.value.items.some((item) => item.type === "ORDER_REFUND_EXCEPTION")).toBe(false);
  });

  it("returns current grocery payment notices and suppresses resolved or membership payment actions", async () => {
    const order = crypto.randomUUID();
    await seedTestInstantOrder(env.DB, order);
    const customerId = `customer-${order}`;
    const payment = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO payment_intent(id,purpose,subject_type,subject_id,customer_id,amount_minor,currency,status,idempotency_key,created_at,updated_at) VALUES (?,'GROCERY_CHECKOUT','checkout_quote',?,?,100,'PHP','REQUIRES_ACTION',?,1,1)",
    )
      .bind(payment, order, customerId, payment)
      .run();
    await notice(customerId, payment, "PAYMENT_ACTION_REQUIRED", 1, "PAYMENT");
    let result = await listCustomerNotifications(env.DB, { customerId, requestId: "payment" }, 100);
    expect(result).toMatchObject({
      ok: true,
      value: { items: [{ type: "PAYMENT_ACTION_REQUIRED", href: "/checkout" }] },
    });
    await env.DB.prepare("UPDATE payment_intent SET status='FAILED' WHERE id=?")
      .bind(payment)
      .run();
    await notice(customerId, payment, "PAYMENT_FAILED", 2, "PAYMENT");
    result = await listCustomerNotifications(env.DB, { customerId, requestId: "payment" }, 100);
    expect(result).toMatchObject({ ok: true, value: { items: [{ type: "PAYMENT_FAILED" }] } });
    if (!result.ok) throw new Error("Missing read");
    expect(result.value.items).toHaveLength(1);
    await env.DB.prepare("UPDATE payment_intent SET status='SUCCEEDED' WHERE id=?")
      .bind(payment)
      .run();
    expect(
      await listCustomerNotifications(env.DB, { customerId, requestId: "payment" }, 100),
    ).toMatchObject({ ok: true, value: { items: [] } });
  });

  it("enforces both recipient and owned resource, hides future and unrelated notices, and leaks no internal fields", async () => {
    const own = crypto.randomUUID();
    const other = crypto.randomUUID();
    await seedTestInstantOrder(env.DB, own);
    await seedTestInstantOrder(env.DB, other);
    const customerId = `customer-${own}`;
    const id = await notice(customerId, own, "DELIVERED", 2);
    await notice(customerId, other, "DELIVERED", 3);
    await notice(`customer-${other}`, own, "DELIVERY_FAILED", 3);
    await notice(customerId, own, "OUT_FOR_DELIVERY", 200);
    await notice(customerId, own, "RENEWAL_ACTION_REQUIRED", 3, "SUBSCRIPTION");
    await notice(customerId, own, "PAYMENT_FAILED", 3, "PAYMENT");
    const result = await listCustomerNotifications(
      env.DB,
      { customerId, requestId: "notices" },
      100,
    );
    expect(result).toMatchObject({
      ok: true,
      value: { items: [{ type: "DELIVERED", href: `/orders/${own}` }], hasMore: false },
    });
    if (!result.ok) throw new Error("Missing read");
    expect(result.value.items).toHaveLength(1);
    expect(Object.keys(result.value.items[0] ?? {}).sort()).toEqual([
      "actionLabel",
      "href",
      "label",
      "occurredAt",
      "reference",
      "type",
    ]);
    expect(JSON.stringify(result)).not.toContain(id);
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
    expect(JSON.stringify(result)).not.toContain("private@example.com");
    // Email delivery outcome is immaterial to the transaction update.
    await env.DB.prepare(
      "UPDATE notification_outbox SET status='FAILED',last_error_code='INTERNAL_TEST_ERROR' WHERE id=?",
    )
      .bind(id)
      .run();
    expect(
      await listCustomerNotifications(env.DB, { customerId, requestId: "notices" }, 100),
    ).toEqual(result);
  });

  it("bounds and deterministically orders results, with committed confirmation independent of projection", async () => {
    const own = crypto.randomUUID();
    await seedTestInstantOrder(env.DB, own);
    const customerId = `customer-${own}`;
    await env.DB.prepare(
      "UPDATE grocery_order SET committed_at=99,order_number='FM-NOTICE' WHERE id=?",
    )
      .bind(own)
      .run();
    await notice(customerId, own, "ORDER_CONFIRMED", 99, "ORDER");
    for (let at = 1; at <= 30; at++) await notice(customerId, own, "DELIVERED", at);
    const first = await listCustomerNotifications(
      env.DB,
      { customerId, requestId: "bounded" },
      100,
    );
    if (!first.ok) throw new Error("Missing read");
    expect(first.value.items).toHaveLength(24);
    expect(first.value.hasMore).toBe(true);
    expect(first.value.items[0]).toMatchObject({ type: "ORDER_CONFIRMED", reference: "FM-NOTICE" });
    expect(first.value.items.filter((item) => item.type === "ORDER_CONFIRMED")).toHaveLength(1);
    expect(
      await listCustomerNotifications(env.DB, { customerId, requestId: "bounded" }, 100),
    ).toEqual(first);
  });
});
