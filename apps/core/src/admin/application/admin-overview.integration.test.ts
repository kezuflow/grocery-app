import { describe, expect, it } from "vitest";
import { SELF } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import type { Capability, CoreServiceBinding } from "@freshmarkets/contracts";

const core = exports.default as unknown as CoreServiceBinding;

async function signUp() {
  const email = `overview-${crypto.randomUUID().slice(0, 12)}@example.com`;
  const password = "correct-horse-battery-staple";
  const response = await SELF.fetch("https://core.example.invalid/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://core.example.invalid" },
    body: JSON.stringify({ name: "Overview Admin", email, password }),
  });
  expect(response.status).toBeLessThan(400);
  const body = (await response.json()) as { user: { id: string } };
  await env.DB.prepare("UPDATE user SET email_verified=1 WHERE id=?").bind(body.user.id).run();
  let cookie = (response.headers.getSetCookie?.() ?? [])
    .map((item) => item.split(";", 1)[0])
    .join("; ");
  if (!cookie) {
    const signIn = await SELF.fetch("https://core.example.invalid/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://core.example.invalid" },
      body: JSON.stringify({ email, password }),
    });
    cookie = (signIn.headers.getSetCookie?.() ?? [])
      .map((item) => item.split(";", 1)[0])
      .join("; ");
  }
  return { cookie, userId: body.user.id };
}

async function seedStaff(options: {
  capabilities: ReadonlyArray<Capability>;
  scope: "global" | "location";
}) {
  const principal = await signUp();
  const now = Date.now();
  const staffId = crypto.randomUUID();
  const roleId = crypto.randomUUID();
  const statements = [
    env.DB.prepare(
      "INSERT INTO staff_identity (id, auth_user_id, display_name, status, created_at, updated_at) VALUES (?, ?, 'Overview Admin', 'active', ?, ?)",
    ).bind(staffId, principal.userId, now, now),
    env.DB.prepare(
      "INSERT INTO role (id, code, name, created_at) VALUES (?, ?, 'Overview', ?)",
    ).bind(roleId, `overview-${crypto.randomUUID().slice(0, 8)}`, now),
    env.DB.prepare("INSERT INTO staff_role (staff_id, role_id) VALUES (?, ?)").bind(
      staffId,
      roleId,
    ),
    env.DB.prepare(
      "INSERT INTO staff_scope (id, staff_id, scope_kind, market_id, location_id) VALUES (?, ?, ?, NULL, ?)",
    ).bind(
      crypto.randomUUID(),
      staffId,
      options.scope,
      options.scope === "location" ? "location-cebu-central" : null,
    ),
  ];
  for (const capability of options.capabilities) {
    statements.push(
      env.DB.prepare(
        "INSERT OR IGNORE INTO permission (id, code, description, created_at) VALUES (?, ?, 'overview', ?)",
      ).bind(crypto.randomUUID(), capability, now),
      env.DB.prepare(
        "INSERT OR IGNORE INTO role_permission (role_id, permission_id) SELECT ?, id FROM permission WHERE code=?",
      ).bind(roleId, capability),
    );
  }
  await env.DB.batch(statements);
  return principal.cookie;
}

describe("Admin operational overview", () => {
  it("requires authentication and a valid timezone", async () => {
    expect(
      await core.getAdminOverview({
        requestId: "overview-anonymous",
        headers: {},
        selectedScope: { kind: "GLOBAL" },
        timezone: "Asia/Manila",
      }),
    ).toMatchObject({ ok: false, error: { code: "UNAUTHENTICATED" } });
    const cookie = await seedStaff({ capabilities: [], scope: "global" });
    expect(
      await core.getAdminOverview({
        requestId: crypto.randomUUID(),
        headers: { cookie },
        selectedScope: { kind: "GLOBAL" },
        timezone: "not-a-timezone",
      }),
    ).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
  });

  it("returns authoritative global counts to a fully capable reader", async () => {
    const cookie = await seedStaff({
      capabilities: [
        "orders.read",
        "payments.read",
        "catalog.read",
        "fulfillment.read",
        "fulfillment.manage",
        "audit.read",
      ],
      scope: "global",
    });
    const result = await core.getAdminOverview({
      requestId: crypto.randomUUID(),
      headers: { cookie },
      selectedScope: { kind: "GLOBAL" },
      timezone: "Asia/Manila",
    });
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    const active = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM product WHERE status='active'",
    ).first<{ count: number }>();
    expect(result.value.cards.find((card) => card.code === "ACTIVE_PRODUCTS")?.value).toBe(
      active?.count ?? 0,
    );
    expect(result.value.deniedSections).toEqual([]);
    expect(result.value.exceptions.length).toBeLessThanOrEqual(12);
  });

  it("keeps location-scoped operations visible while denying global sections", async () => {
    const cookie = await seedStaff({
      capabilities: ["fulfillment.read", "fulfillment.manage"],
      scope: "location",
    });
    const result = await core.getAdminOverview({
      requestId: crypto.randomUUID(),
      headers: { cookie },
      selectedScope: {
        kind: "LOCATION",
        marketId: "market-metro-cebu",
        locationId: "location-cebu-central",
      },
      timezone: "Asia/Manila",
    });
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(result.value.deniedSections).toEqual(
      expect.arrayContaining(["orders", "payments", "catalog", "audit"]),
    );
    expect(result.value.deniedSections).not.toContain("operations");
    expect(result.value.cards.find((card) => card.code === "OPEN_ORDERS")).toMatchObject({
      value: null,
    });
  });
});
