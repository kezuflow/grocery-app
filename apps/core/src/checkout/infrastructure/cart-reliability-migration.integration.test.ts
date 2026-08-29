import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";

describe("cart and provider inbox reliability migration", () => {
  it("enforces one active cart per customer", async () => {
    const suffix = crypto.randomUUID();
    const customerId = `cart-invariant-customer-${suffix}`;
    const now = Date.now();
    await env.DB.prepare(
      "INSERT INTO customer (id, auth_user_id, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
    )
      .bind(customerId, `auth-${suffix}`, now, now)
      .run();
    const insert = (id: string) =>
      env.DB.prepare(
        "INSERT INTO cart (id, customer_id, location_id, status, version, created_at, updated_at) VALUES (?, ?, 'location-cebu-central', 'ACTIVE', 1, ?, ?)",
      )
        .bind(id, customerId, now, now)
        .run();

    await insert(`cart-a-${suffix}`);
    await expect(insert(`cart-b-${suffix}`)).rejects.toThrow();
  });

  it("adds durable normalized-observation and lease fields to the provider inbox", async () => {
    const columns = await env.DB.prepare("PRAGMA table_info(payment_provider_event_inbox)").all<{
      name: string;
    }>();
    expect(columns.results.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "provider_reference",
        "event_type",
        "normalized_observation_json",
        "lease_owner",
        "lease_expires_at",
        "available_at",
        "first_failed_at",
      ]),
    );
  });
});
