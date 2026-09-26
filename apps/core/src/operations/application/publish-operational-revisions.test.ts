import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { SELF } from "cloudflare:test";
import { seedTestInstantOrder } from "../../test-commerce-fixtures";
import { locationManager } from "../../test-location-fixtures";
import { publishOperationalRevisions } from "./publish-operational-revisions";

describe("operational revisions", () => {
  it("requires current location-scoped staff access for the stream", async () => {
    const unauthenticated = await SELF.fetch(
      "https://core.example.invalid/api/admin/operational-stream?locationId=location-cebu-central",
      { headers: { upgrade: "websocket" } },
    );
    expect(unauthenticated.status).toBe(401);
    const manager = await locationManager("location");
    await env.DB.prepare(
      "INSERT INTO role_permission(role_id,permission_id) SELECT ?,id FROM permission WHERE code='fulfillment.read'",
    )
      .bind(manager.id)
      .run();
    const scoped = await SELF.fetch(
      "https://core.example.invalid/api/admin/operational-stream?locationId=location-cebu-central",
      { headers: { ...manager.headers, upgrade: "websocket" } },
    );
    expect(scoped.status).toBe(101);
    scoped.webSocket?.accept();
    scoped.webSocket?.close();
  });

  it("commits a location revision with paid work and recovers a failed publication", async () => {
    const orderId = crypto.randomUUID();
    await seedTestInstantOrder(env.DB, orderId);
    await env.DB.prepare("UPDATE grocery_order SET status='COMMITTED' WHERE id=?")
      .bind(orderId)
      .run();
    await env.DB.prepare(
      "INSERT INTO fulfillment_record(id,order_id,location_id,status,updated_at) VALUES (?,?,'location-cebu-central','NOT_STARTED',1)",
    )
      .bind(crypto.randomUUID(), orderId)
      .run();
    const before = await env.DB.prepare(
      "SELECT revision,published_revision FROM operational_revision WHERE location_id='location-cebu-central'",
    ).first<{ revision: number; published_revision: number }>();
    expect(before).toEqual({ revision: 1, published_revision: 0 });

    const unavailable = {
      getByName: () => ({
        publish: async () => {
          throw new Error("hub unavailable");
        },
      }),
    } as unknown as Env["OPERATIONAL_HUB"];
    await expect(publishOperationalRevisions(env.DB, unavailable)).rejects.toThrow(
      "Some operational revisions remain unpublished",
    );
    expect(
      await env.DB.prepare(
        "SELECT published_revision FROM operational_revision WHERE location_id='location-cebu-central'",
      ).first(),
    ).toEqual({ published_revision: 0 });

    expect(await publishOperationalRevisions(env.DB, env.OPERATIONAL_HUB)).toBe(1);
    expect(
      await env.DB.prepare(
        "SELECT revision,published_revision FROM operational_revision WHERE location_id='location-cebu-central'",
      ).first(),
    ).toEqual({ revision: 1, published_revision: 1 });

    const connection = await env.OPERATIONAL_HUB.getByName("location-cebu-central").fetch(
      new Request("https://core.example.invalid/socket", { headers: { upgrade: "websocket" } }),
    );
    expect(connection.status).toBe(101);
    const client = connection.webSocket!;
    client.accept();
    const broadcast = new Promise<string>((resolve, reject) => {
      client.addEventListener("message", (event) => resolve(String(event.data)), { once: true });
      setTimeout(() => reject(new Error("No operational revision broadcast")), 2_000);
    });
    await env.DB.prepare(
      "UPDATE fulfillment_record SET status='PICKING',version=2 WHERE order_id=?",
    )
      .bind(orderId)
      .run();
    expect(
      await env.DB.prepare(
        "SELECT revision,published_revision FROM operational_revision WHERE location_id='location-cebu-central'",
      ).first(),
    ).toEqual({ revision: 2, published_revision: 1 });
    expect(await publishOperationalRevisions(env.DB, env.OPERATIONAL_HUB)).toBe(1);
    expect(JSON.parse(await broadcast)).toEqual({ revision: 2 });
    client.close();
    expect(await publishOperationalRevisions(env.DB, env.OPERATIONAL_HUB)).toBe(0);
  });
});
