import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { listCustomerOrders } from "./list-customer-orders";
import { seedTestInstantOrder } from "../../test-commerce-fixtures";

describe("bounded customer order history", () => {
  it("uses stable keyset pages across equal timestamps, legacy dates and concurrent new orders", async () => {
    const prefix = crypto.randomUUID();
    const customerId = `customer-${prefix}-a`;
    for (const [suffix, at] of [
      ["a", 1000],
      ["b", 2000],
      ["c", 2000],
      ["d", 3000],
    ] as const) {
      const id = `${prefix}-${suffix}`;
      await seedTestInstantOrder(env.DB, id);
      await env.DB.prepare(
        "UPDATE grocery_order SET customer_id=?,created_at=?,committed_at=?,status=? WHERE id=?",
      )
        .bind(
          customerId,
          at,
          suffix === "a" ? null : at,
          suffix === "a" ? "DELIVERED" : "COMMITTED",
          id,
        )
        .run();
    }
    const first = await listCustomerOrders(env.DB, { customerId, requestId: "history", limit: 2 });
    if (!first.ok || !first.value.nextCursor) throw new Error("Missing first page");
    expect(first.value.items.map((order) => order.id)).toEqual([`${prefix}-d`, `${prefix}-c`]);
    await seedTestInstantOrder(env.DB, `${prefix}-e`);
    await env.DB.prepare("UPDATE grocery_order SET customer_id=?,committed_at=4000 WHERE id=?")
      .bind(customerId, `${prefix}-e`)
      .run();
    const second = await listCustomerOrders(env.DB, {
      customerId,
      requestId: "history",
      limit: 2,
      cursor: first.value.nextCursor,
    });
    expect(second).toMatchObject({
      ok: true,
      value: {
        items: [
          { id: `${prefix}-b` },
          { id: `${prefix}-a`, committedAt: new Date(1000).toISOString() },
        ],
        nextCursor: null,
      },
    });
    const filtered = await listCustomerOrders(env.DB, {
      customerId,
      requestId: "history",
      limit: 1,
      filter: "completed",
    });
    expect(filtered).toMatchObject({
      ok: true,
      value: { items: [{ id: `${prefix}-a` }], nextCursor: null },
    });
    expect(
      await listCustomerOrders(env.DB, {
        customerId: "another-customer",
        requestId: "history",
        cursor: first.value.nextCursor,
      }),
    ).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
    expect(
      await listCustomerOrders(env.DB, {
        customerId,
        requestId: "history",
        filter: "active",
        cursor: first.value.nextCursor,
      }),
    ).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
  });

  it("rejects malformed page cursors", async () => {
    expect(
      await listCustomerOrders(env.DB, {
        customerId: "customer",
        requestId: "history",
        cursor: "malformed",
      }),
    ).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
  });
});
