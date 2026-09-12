import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { expect, it, vi } from "vitest";
import { resolveServiceability } from "./serviceability";

it("resolves the global areas and current fulfillment pins with one database batch", async () => {
  const database = drizzle(env.DB);
  const batch = vi.spyOn(database, "batch");
  const result = await resolveServiceability(database, {
    requestId: "batched-geography",
    latitude: 10.32,
    longitude: 123.9,
  });
  expect(result).toMatchObject({
    ok: true,
    value: { serviceable: true, fulfillmentLocation: { id: "location-cebu-central" } },
  });
  expect(batch).toHaveBeenCalledTimes(1);
  expect(batch.mock.calls[0][0]).toHaveLength(4);
});

it("does not borrow geography from another market when the requested market is missing", async () => {
  const result = await resolveServiceability(drizzle(env.DB), {
    requestId: "missing-market",
    latitude: 10.32,
    longitude: 123.9,
    marketCode: "MISSING_MARKET",
  });
  expect(result).toMatchObject({ ok: true, value: { serviceable: false } });
});
