import { describe, expect, it } from "vitest";
import { SELF } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import type {
  AnalyticsOverviewView,
  MetricDefinitionView,
  MetricSeriesView,
  RpcResult,
} from "@freshmarkets/contracts";

type AnalyticsCore = {
  listMetricDefinitions(input: {
    requestId: string;
    headers: Readonly<Record<string, string>>;
    category?: string;
    status?: string;
  }): Promise<RpcResult<ReadonlyArray<MetricDefinitionView>>>;
  getAnalyticsOverview(input: {
    requestId: string;
    headers: Readonly<Record<string, string>>;
    window: { startAt: string; endAt: string; timezone: string };
    scope?:
      | { kind: "GLOBAL" }
      | { kind: "MARKET"; marketId: string }
      | { kind: "LOCATION"; marketId: string; locationId: string };
    dimensions?: ReadonlyArray<{ key: string; value: string }>;
  }): Promise<RpcResult<AnalyticsOverviewView>>;
  getMetricSeries(input: {
    requestId: string;
    headers: Readonly<Record<string, string>>;
    metricCode: string;
    definitionVersion?: number;
    window: { startAt: string; endAt: string; timezone: string };
    scope?:
      | { kind: "GLOBAL" }
      | { kind: "MARKET"; marketId: string }
      | { kind: "LOCATION"; marketId: string; locationId: string };
    dimensions?: ReadonlyArray<{ key: string; value: string }>;
  }): Promise<RpcResult<MetricSeriesView>>;
};

const core = exports.default as unknown as AnalyticsCore;
let counter = 0;

async function signUp(): Promise<{ cookie: string; userId: string }> {
  const email = `analytics-${++counter}-${crypto.randomUUID().slice(0, 6)}@example.com`;
  const password = "correct-horse-battery-staple";
  const response = await SELF.fetch("https://core.example.invalid/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://core.example.invalid" },
    body: JSON.stringify({ name: "Analytics reader", email, password }),
  });
  expect(response.status).toBeLessThan(400);
  const body = (await response.json()) as { user: { id: string } };
  await env.DB.prepare("UPDATE user SET email_verified=1 WHERE id=?").bind(body.user.id).run();
  let cookie = (response.headers.getSetCookie?.() ?? [])
    .map((value) => value.split(";", 1)[0])
    .join("; ");
  if (!cookie) {
    const signIn = await SELF.fetch("https://core.example.invalid/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://core.example.invalid" },
      body: JSON.stringify({ email, password }),
    });
    cookie = (signIn.headers.getSetCookie?.() ?? [])
      .map((value) => value.split(";", 1)[0])
      .join("; ");
  }
  return {
    userId: body.user.id,
    cookie,
  };
}

async function seedAnalyticsReader(
  options: {
    capability?: boolean;
    scope?: "global" | "market" | "location";
    marketId?: string;
    locationId?: string;
  } = {},
): Promise<{ cookie: string; staffId: string }> {
  const principal = await signUp();
  const staffId = crypto.randomUUID();
  const roleId = crypto.randomUUID();
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO staff_identity (id, auth_user_id, display_name, status, created_at, updated_at) VALUES (?, ?, 'Analytics reader', 'active', ?, ?)",
    ).bind(staffId, principal.userId, now, now),
    env.DB.prepare(
      "INSERT INTO role (id, code, name, created_at) VALUES (?, ?, 'Analytics', ?)",
    ).bind(roleId, `analytics-${crypto.randomUUID().slice(0, 8)}`, now),
    env.DB.prepare("INSERT INTO staff_role (staff_id, role_id) VALUES (?, ?)").bind(
      staffId,
      roleId,
    ),
    env.DB.prepare(
      "INSERT INTO staff_scope (id, staff_id, scope_kind, market_id, location_id) VALUES (?, ?, ?, ?, ?)",
    ).bind(
      crypto.randomUUID(),
      staffId,
      options.scope ?? "global",
      options.scope === "market" ? (options.marketId ?? "market-metro-cebu") : null,
      options.scope === "location" ? (options.locationId ?? "location-cebu-central") : null,
    ),
  ]);
  if (options.capability !== false) {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT OR IGNORE INTO permission (id, code, description, created_at) VALUES (?, 'analytics.read', 'analytics', ?)",
      ).bind(crypto.randomUUID(), now),
      env.DB.prepare(
        "INSERT INTO role_permission (role_id, permission_id) SELECT ?, id FROM permission WHERE code='analytics.read'",
      ).bind(roleId),
    ]);
  }
  return { cookie: principal.cookie, staffId };
}

const window = {
  startAt: "2026-08-01T00:00:00.000Z",
  endAt: "2026-09-01T00:00:00.000Z",
  timezone: "Asia/Manila",
};

describe("Core Analytics reads", () => {
  it("requires authentication and analytics.read before reading metric sources", async () => {
    await expect(
      core.getMetricSeries({
        requestId: "anonymous",
        headers: {},
        metricCode: "order_count",
        window,
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: "UNAUTHENTICATED" } });

    const staffWithoutCapability = await seedAnalyticsReader({ capability: false });
    await expect(
      core.getMetricSeries({
        requestId: crypto.randomUUID(),
        headers: { cookie: staffWithoutCapability.cookie },
        metricCode: "order_count",
        window,
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });

  it("returns a canonical typed unavailable result for a blocked metric", async () => {
    const staff = await seedAnalyticsReader();
    await expect(
      core.getMetricSeries({
        requestId: crypto.randomUUID(),
        headers: { cookie: staff.cookie },
        metricCode: "gmv",
        window,
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        metricCode: "gmv",
        definitionVersion: 1,
        availability: "UNAVAILABLE",
        points: [],
        unavailableReason:
          "Requires an approved accounting definition of gross/net components, cancellations, refunds, fees, tax, and event-time recognition.",
      },
    });
  });

  it("rejects invalid source windows, zones, dimensions, and unknown metric versions", async () => {
    const staff = await seedAnalyticsReader();
    for (const input of [
      { metricCode: "order_count", window: { ...window, timezone: "PHT" } },
      { metricCode: "order_count", window: { ...window, endAt: window.startAt } },
      { metricCode: "not_a_metric", window },
      { metricCode: "order_count", definitionVersion: 99, window },
      { metricCode: "order_count", window, dimensions: [{ key: "unknown", value: "x" }] },
    ]) {
      await expect(
        core.getMetricSeries({
          requestId: crypto.randomUUID(),
          headers: { cookie: staff.cookie },
          ...input,
        }),
      ).resolves.toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
    }
  });

  it("enforces global, market, and location scope without consulting source rows first", async () => {
    const globalReader = await seedAnalyticsReader({ scope: "global" });
    await expect(
      core.getMetricSeries({
        requestId: crypto.randomUUID(),
        headers: { cookie: globalReader.cookie },
        metricCode: "gmv",
        window,
        scope: { kind: "GLOBAL" },
      }),
    ).resolves.toMatchObject({ ok: true, value: { availability: "UNAVAILABLE" } });

    const marketReader = await seedAnalyticsReader({ scope: "market" });
    await expect(
      core.getMetricSeries({
        requestId: crypto.randomUUID(),
        headers: { cookie: marketReader.cookie },
        metricCode: "gmv",
        window,
        scope: { kind: "MARKET", marketId: "market-metro-cebu" },
      }),
    ).resolves.toMatchObject({ ok: true, value: { availability: "UNAVAILABLE" } });

    const locationReader = await seedAnalyticsReader({ scope: "location" });
    await expect(
      core.getMetricSeries({
        requestId: crypto.randomUUID(),
        headers: { cookie: locationReader.cookie },
        metricCode: "gmv",
        window,
        scope: {
          kind: "LOCATION",
          marketId: "market-metro-cebu",
          locationId: "location-cebu-central",
        },
      }),
    ).resolves.toMatchObject({ ok: true, value: { availability: "UNAVAILABLE" } });
    await env.DB.prepare(
      "INSERT INTO fulfillment_location (id, market_id, code, name, type, latitude, longitude, status, version, created_at, updated_at) VALUES ('location-analytics-forbidden', 'market-metro-cebu', 'ANALYTICS_FORBIDDEN', 'Analytics forbidden', 'FULFILLMENT_CENTER', 10.31, 123.88, 'active', 1, 0, 0)",
    ).run();
    await expect(
      core.getMetricSeries({
        requestId: crypto.randomUUID(),
        headers: { cookie: locationReader.cookie },
        metricCode: "gmv",
        window,
        scope: {
          kind: "LOCATION",
          marketId: "market-metro-cebu",
          locationId: "location-analytics-forbidden",
        },
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });

  it("requires an explicit assigned scope when more than one scope is available", async () => {
    const reader = await seedAnalyticsReader({ scope: "location" });
    const secondLocationId = `location-${crypto.randomUUID()}`;
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO fulfillment_location (id, market_id, code, name, type, latitude, longitude, status, version, created_at, updated_at) VALUES (?, 'market-metro-cebu', ?, 'Second analytics location', 'FULFILLMENT_CENTER', 10.31, 123.88, 'active', 1, 0, 0)",
      ).bind(secondLocationId, `SECOND_${crypto.randomUUID().slice(0, 8)}`),
      env.DB.prepare(
        "INSERT INTO staff_scope (id, staff_id, scope_kind, market_id, location_id) VALUES (?, ?, 'location', NULL, ?)",
      ).bind(crypto.randomUUID(), reader.staffId, secondLocationId),
    ]);

    const base = {
      requestId: crypto.randomUUID(),
      headers: { cookie: reader.cookie },
      metricCode: "gmv",
      window,
    };
    await expect(core.getMetricSeries(base)).resolves.toMatchObject({
      ok: false,
      error: { code: "VALIDATION_FAILED" },
    });
    for (const locationId of ["location-cebu-central", secondLocationId]) {
      await expect(
        core.getMetricSeries({
          ...base,
          scope: { kind: "LOCATION", marketId: "market-metro-cebu", locationId },
        }),
      ).resolves.toMatchObject({ ok: true });
    }
    await expect(
      core.getMetricSeries({
        ...base,
        scope: {
          kind: "LOCATION",
          marketId: "market-metro-cebu",
          locationId: "location-analytics-unassigned",
        },
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  });

  it("preserves empty denominators, freshness metadata, and overview-series definition parity", async () => {
    const reader = await seedAnalyticsReader();
    const series = await core.getMetricSeries({
      requestId: crypto.randomUUID(),
      headers: { cookie: reader.cookie },
      metricCode: "orders_per_customer",
      window,
    });
    expect(series).toMatchObject({
      ok: true,
      value: {
        definitionVersion: 1,
        availability: "AVAILABLE",
        points: [{ occurredAt: window.endAt, value: null }],
        freshness: { sourceWatermark: null },
      },
    });

    const overview = await core.getAnalyticsOverview({
      requestId: crypto.randomUUID(),
      headers: { cookie: reader.cookie },
      window,
    });
    expect(overview).toMatchObject({ ok: true });
    if (!overview.ok) return;
    const overviewGmv = overview.value.metrics.find((metric) => metric.metricCode === "gmv");
    const directGmv = await core.getMetricSeries({
      requestId: crypto.randomUUID(),
      headers: { cookie: reader.cookie },
      metricCode: "gmv",
      window,
    });
    expect(overviewGmv).toMatchObject({
      definitionVersion: 1,
      availability: "UNAVAILABLE",
      value: null,
    });
    expect(directGmv).toMatchObject({
      ok: true,
      value: { definitionVersion: 1, availability: "UNAVAILABLE" },
    });
  });

  it("fails closed when a metric lacks its canonical event timestamp", async () => {
    const reader = await seedAnalyticsReader();
    await expect(
      core.getMetricSeries({
        requestId: crypto.randomUUID(),
        headers: { cookie: reader.cookie },
        metricCode: "refund_amount",
        window,
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        availability: "UNAVAILABLE",
        points: [],
        unavailableReason:
          "Select a currency because Refund amounts cannot be combined across currencies.",
      },
    });
  });

  it("applies an Overview currency only to metrics that support it", async () => {
    const reader = await seedAnalyticsReader();
    const result = await core.getAnalyticsOverview({
      requestId: crypto.randomUUID(),
      headers: { cookie: reader.cookie },
      window,
      dimensions: [{ key: "currency", value: "PHP" }],
    });
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.value.metrics).toHaveLength(30);
    expect(
      result.value.metrics.find((metric) => metric.metricCode === "order_count")?.dimensions,
    ).toEqual([]);
    expect(
      result.value.metrics.find((metric) => metric.metricCode === "refund_amount")?.dimensions,
    ).toEqual([{ key: "currency", value: "PHP" }]);
  });

  it("does not infer refund success from payment_refund.updated_at", async () => {
    const reader = await seedAnalyticsReader();
    await expect(
      core.getMetricSeries({
        requestId: crypto.randomUUID(),
        headers: { cookie: reader.cookie },
        metricCode: "refund_amount",
        window,
        dimensions: [{ key: "currency", value: "PHP" }],
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        availability: "UNAVAILABLE",
        points: [],
        unavailableReason:
          "Unavailable because canonical refund success timestamps are not yet instrumented.",
      },
    });
  });

  it("never combines incompatible inventory base units and returns the effective unit", async () => {
    const reader = await seedAnalyticsReader();
    const now = Date.parse("2026-08-15T12:00:00.000Z");
    const categoryId = crypto.randomUUID();
    const seeds = [
      { suffix: "gram", dimension: "MASS", baseUnit: "GRAM", quantity: 100 },
      {
        suffix: "milliliter",
        dimension: "VOLUME",
        baseUnit: "MILLILITER",
        quantity: 200,
      },
      { suffix: "piece", dimension: "COUNT", baseUnit: "PIECE", quantity: 3 },
    ] as const;
    await env.DB.prepare(
      "INSERT INTO category (id, code, name, slug, status, sort_order, created_at, updated_at) VALUES (?, ?, 'Analytics units', ?, 'active', 99, ?, ?)",
    )
      .bind(
        categoryId,
        `AN_${crypto.randomUUID().slice(0, 8)}`,
        `an-${crypto.randomUUID()}`,
        now,
        now,
      )
      .run();
    for (const seed of seeds) {
      const unitId = crypto.randomUUID();
      const poolId = crypto.randomUUID();
      const productId = crypto.randomUUID();
      await env.DB.batch([
        env.DB.prepare(
          "INSERT INTO unit (id, code, name, dimension, symbol, created_at, canonical_base_code, conversion_numerator, conversion_denominator, status, version, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, 'active', 1, ?)",
        ).bind(
          unitId,
          `AN_${seed.suffix.toUpperCase()}_${crypto.randomUUID().slice(0, 6)}`,
          seed.suffix,
          seed.dimension,
          seed.suffix,
          now,
          seed.baseUnit,
          now,
        ),
        env.DB.prepare(
          "INSERT INTO inventory_pool (id, product_id, base_unit_id, sourcing_mode, canonical_sourcing_mode, created_at, updated_at) VALUES (?, ?, ?, 'STOCKED', 'STOCKED', ?, ?)",
        ).bind(poolId, productId, unitId, now, now),
        env.DB.prepare(
          "INSERT INTO product (id, category_id, inventory_pool_id, slug, name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)",
        ).bind(
          productId,
          categoryId,
          poolId,
          `analytics-${seed.suffix}-${crypto.randomUUID()}`,
          seed.suffix,
          now,
          now,
        ),
        env.DB.prepare(
          "INSERT INTO inventory_ledger_entries (id, inventory_pool_id, location_id, movement_type, quantity_delta_base, reservation_delta_base, reference_type, reference_id, actor_type, reason_code, metadata_json, created_at) VALUES (?, ?, 'location-cebu-central', 'ADJUSTMENT', ?, 0, 'analytics-test', ?, 'staff', 'COUNT', '{}', ?)",
        ).bind(crypto.randomUUID(), poolId, seed.quantity, crypto.randomUUID(), now),
      ]);
    }

    const common = {
      requestId: crypto.randomUUID(),
      headers: { cookie: reader.cookie },
      metricCode: "inventory_adjustments_shrinkage",
      window,
    };
    await expect(core.getMetricSeries(common)).resolves.toMatchObject({
      ok: true,
      value: {
        definitionVersion: 2,
        availability: "UNAVAILABLE",
        unavailableReason: "Select a base unit because this result contains multiple base units.",
        dimensions: [],
        points: [],
      },
    });
    await expect(
      core.getMetricSeries({
        ...common,
        dimensions: [{ key: "baseUnit", value: "GRAM" }],
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        availability: "AVAILABLE",
        dimensions: [{ key: "baseUnit", value: "GRAM" }],
        points: [{ value: 100 }],
      },
    });
  });

  it("adds a single discovered inventory base unit to result metadata", async () => {
    const reader = await seedAnalyticsReader();
    const now = Date.parse("2026-08-16T12:00:00.000Z");
    await env.DB.prepare(
      "INSERT INTO inventory_ledger_entries (id, inventory_pool_id, location_id, movement_type, quantity_delta_base, reservation_delta_base, reference_type, reference_id, actor_type, reason_code, metadata_json, created_at) VALUES (?, 'pool-red-onion', 'location-cebu-central', 'ADJUSTMENT', 25, 0, 'analytics-test', ?, 'staff', 'COUNT', '{}', ?)",
    )
      .bind(crypto.randomUUID(), crypto.randomUUID(), now)
      .run();

    await expect(
      core.getMetricSeries({
        requestId: crypto.randomUUID(),
        headers: { cookie: reader.cookie },
        metricCode: "inventory_adjustments_shrinkage",
        window: {
          startAt: "2026-08-16T00:00:00.000Z",
          endAt: "2026-08-17T00:00:00.000Z",
          timezone: "Asia/Manila",
        },
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        availability: "AVAILABLE",
        dimensions: [{ key: "baseUnit", value: "GRAM" }],
        points: [{ value: 25 }],
      },
    });
  });

  it("filters promotion redemptions by the requested promotion", async () => {
    const reader = await seedAnalyticsReader();
    const customerPrincipal = await signUp();
    const customerId = crypto.randomUUID();
    const now = Date.parse("2026-08-15T00:00:00.000Z");
    const firstPromotionId = crypto.randomUUID();
    const secondPromotionId = crypto.randomUUID();
    const firstCode = `ANALYTICS_${crypto.randomUUID().slice(0, 8)}`;
    const secondCode = `ANALYTICS_${crypto.randomUUID().slice(0, 8)}`;
    const firstGrantId = crypto.randomUUID();
    const secondGrantId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO customer (id, auth_user_id, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
      ).bind(customerId, customerPrincipal.userId, now, now),
      env.DB.prepare(
        "INSERT INTO promotion (id, code, name, description, status, benefit_type, discount_minor, percent, minimum_minor, starts_at, ends_at, global_usage_limit, per_customer_usage_limit, automatic, priority, version, created_at, updated_at) VALUES (?, ?, 'First', '', 'ACTIVE', 'ORDER_FIXED_DISCOUNT', 100, NULL, 0, ?, NULL, NULL, NULL, 0, 0, 1, ?, ?)",
      ).bind(firstPromotionId, firstCode, now, now, now),
      env.DB.prepare(
        "INSERT INTO promotion (id, code, name, description, status, benefit_type, discount_minor, percent, minimum_minor, starts_at, ends_at, global_usage_limit, per_customer_usage_limit, automatic, priority, version, created_at, updated_at) VALUES (?, ?, 'Second', '', 'ACTIVE', 'ORDER_FIXED_DISCOUNT', 100, NULL, 0, ?, NULL, NULL, NULL, 0, 0, 1, ?, ?)",
      ).bind(secondPromotionId, secondCode, now, now, now),
      env.DB.prepare(
        "INSERT INTO promotion_grant (id, benefit_code, benefit_type, max_redemptions, status, parameters_json, created_at, updated_at) VALUES (?, ?, 'ORDER_FIXED_DISCOUNT', 1, 'ACTIVE', '{}', ?, ?)",
      ).bind(firstGrantId, firstCode, now, now),
      env.DB.prepare(
        "INSERT INTO promotion_grant (id, benefit_code, benefit_type, max_redemptions, status, parameters_json, created_at, updated_at) VALUES (?, ?, 'ORDER_FIXED_DISCOUNT', 1, 'ACTIVE', '{}', ?, ?)",
      ).bind(secondGrantId, secondCode, now, now),
      env.DB.prepare(
        "INSERT INTO promotion_redemption (id, grant_id, benefit_code, benefit_type, customer_id, redeemed_at) VALUES (?, ?, ?, 'ORDER_FIXED_DISCOUNT', ?, ?)",
      ).bind(crypto.randomUUID(), firstGrantId, firstCode, customerId, now),
      env.DB.prepare(
        "INSERT INTO promotion_redemption (id, grant_id, benefit_code, benefit_type, customer_id, redeemed_at) VALUES (?, ?, ?, 'ORDER_FIXED_DISCOUNT', ?, ?)",
      ).bind(crypto.randomUUID(), secondGrantId, secondCode, customerId, now),
    ]);

    await expect(
      core.getMetricSeries({
        requestId: crypto.randomUUID(),
        headers: { cookie: reader.cookie },
        metricCode: "promotion_redemptions",
        window,
        dimensions: [{ key: "promotionId", value: firstPromotionId }],
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: { availability: "AVAILABLE", points: [{ value: 1 }] },
    });
  });

  it("applies an Overview promotion filter without omitting unrelated metrics", async () => {
    const reader = await seedAnalyticsReader();
    const result = await core.getAnalyticsOverview({
      requestId: crypto.randomUUID(),
      headers: { cookie: reader.cookie },
      window,
      dimensions: [{ key: "promotionId", value: "promotion-1" }],
    });
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.value.metrics).toHaveLength(30);
    expect(
      result.value.metrics.find((metric) => metric.metricCode === "promotion_redemptions")
        ?.dimensions,
    ).toEqual([{ key: "promotionId", value: "promotion-1" }]);
    expect(
      result.value.metrics.find((metric) => metric.metricCode === "order_count")?.dimensions,
    ).toEqual([]);
  });

  it("keeps every blocked catalog metric explicitly unavailable with a stable reason", async () => {
    const reader = await seedAnalyticsReader();
    const definitions = await core.listMetricDefinitions({
      requestId: crypto.randomUUID(),
      headers: { cookie: reader.cookie },
      status: "BLOCKED",
    });
    expect(definitions.ok).toBe(true);
    if (!definitions.ok) return;
    expect(definitions.value).toHaveLength(10);
    for (const definition of definitions.value) {
      expect(definition.availability).toBe("UNAVAILABLE");
      expect(definition.unavailableReason).toBeTruthy();
      await expect(
        core.getMetricSeries({
          requestId: crypto.randomUUID(),
          headers: { cookie: reader.cookie },
          metricCode: definition.code,
          definitionVersion: definition.version,
          window,
        }),
      ).resolves.toMatchObject({
        ok: true,
        value: {
          metricCode: definition.code,
          definitionVersion: definition.version,
          availability: "UNAVAILABLE",
          points: [],
          unavailableReason: definition.unavailableReason,
        },
      });
    }
  });

  it("keeps source state read-only across Analytics requests", async () => {
    const reader = await seedAnalyticsReader();
    const before = await env.DB.prepare("SELECT COUNT(*) AS count FROM grocery_order").first<{
      count: number;
    }>();
    await core.listMetricDefinitions({
      requestId: crypto.randomUUID(),
      headers: { cookie: reader.cookie },
    });
    await core.getAnalyticsOverview({
      requestId: crypto.randomUUID(),
      headers: { cookie: reader.cookie },
      window,
    });
    const after = await env.DB.prepare("SELECT COUNT(*) AS count FROM grocery_order").first<{
      count: number;
    }>();
    expect(after?.count).toBe(before?.count);
  });
});
