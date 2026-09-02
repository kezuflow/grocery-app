import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { buildRouteDistancePort } from "../../geography/infrastructure/runtime-route-distance";
import { listFulfillmentOptions } from "./list-fulfillment-options";

describe("listFulfillmentOptions", () => {
  it("binds options to confirmed address/cart versions and hides routing", async () => {
    const suffix = crypto.randomUUID();
    const customerId = `options-customer-${suffix}`;
    const addressId = `options-address-${suffix}`;
    const cartId = `options-cart-${suffix}`;
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE global_fulfillment_mode SET active_mode='SCHEDULED',cadence='WEEKLY',version=version+1,updated_at=? WHERE id='global'",
      ).bind(now),
      env.DB.prepare(
        "INSERT INTO customer (id,auth_user_id,status,created_at,updated_at) VALUES (?,?,'active',?,?)",
      ).bind(customerId, `auth-${customerId}`, now, now),
      env.DB.prepare(
        "INSERT INTO customer_address (id,customer_id,label,recipient,phone,address_json,latitude,longitude,delivery_zone_code,serviceable,status,version,user_confirmed_at,created_at,updated_at) VALUES (?,?,'Home','Customer','09','{}',10.32,123.9,'CEBU_CITY_CORE',1,'active',2,?,?,?)",
      ).bind(addressId, customerId, now, now, now),
      env.DB.prepare(
        "INSERT INTO cart (id,customer_id,location_id,status,version,created_at,updated_at) VALUES (?,?,'location-cebu-central','ACTIVE',3,?,?)",
      ).bind(cartId, customerId, now, now),
      env.DB.prepare(
        "INSERT INTO cart_item (cart_id,sku_id,quantity) VALUES (?,'sku-red-onion-500g',1)",
      ).bind(cartId),
    ]);
    const query = {
      customerId,
      addressId,
      addressVersion: 2,
      cartId,
      cartVersion: 3,
      requestId: "options",
    };
    const result = await listFulfillmentOptions(
      env.DB,
      buildRouteDistancePort({ ENVIRONMENT: "test", ROUTE_DISTANCE_PROVIDER: "mock" }),
      query,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((option) => option.mode)).toEqual(["SCHEDULED"]);
    expect(JSON.stringify(result.value)).not.toMatch(/location-cebu|zone-cebu|hub/i);
    expect(result.value.every((option) => option.optionId.startsWith("fulfillment_"))).toBe(true);
    const stale = await listFulfillmentOptions(
      env.DB,
      buildRouteDistancePort({ ENVIRONMENT: "test", ROUTE_DISTANCE_PROVIDER: "mock" }),
      { ...query, addressVersion: 1 },
    );
    expect(stale).toMatchObject({ ok: false, error: { code: "STALE_VERSION" } });
  });
});
