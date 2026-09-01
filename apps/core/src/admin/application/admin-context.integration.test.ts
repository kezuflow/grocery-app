import { describe, expect, it, vi } from "vitest";
import { SELF } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import type { CoreServiceBinding } from "@freshmarkets/contracts";
import { createAuth } from "../../auth/service";
import { getAdminBootstrap } from "./admin-bootstrap";

const core = exports.default as unknown as CoreServiceBinding;

let counter = 0;

async function signUp(): Promise<{ cookie: string; userId: string }> {
  const n = ++counter;
  const email = `admin-ctx-${n}-${crypto.randomUUID().slice(0, 6)}@example.com`;
  const password = "correct-horse-battery-staple";
  const signUpResponse = await SELF.fetch("https://core.example.invalid/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://core.example.invalid" },
    body: JSON.stringify({ name: "Admin Context", email, password }),
  });
  expect(signUpResponse.status).toBeLessThan(400);
  const body = (await signUpResponse.json()) as { user?: { id?: string } };
  const userId = body.user!.id!;
  await env.DB.prepare("UPDATE user SET email_verified=1 WHERE id=?").bind(userId).run();
  let cookie = (signUpResponse.headers.getSetCookie?.() ?? [])
    .map((c) => c.split(";", 1)[0])
    .join("; ");
  if (!cookie) {
    const signIn = await SELF.fetch("https://core.example.invalid/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://core.example.invalid" },
      body: JSON.stringify({ email, password }),
    });
    cookie = (signIn.headers.getSetCookie?.() ?? []).map((c) => c.split(";", 1)[0]).join("; ");
  }
  return { cookie, userId };
}

async function staffCookie(options: {
  permissionCodes: string[];
  scope?:
    | { kind: "global" }
    | { kind: "location"; locationId: string }
    | { kind: "market"; marketId: string };
}): Promise<{ cookie: string; userId: string }> {
  const user = await signUp();
  const now = Date.now();
  const staffId = crypto.randomUUID();
  const roleId = crypto.randomUUID();
  const statements = [
    env.DB.prepare(
      "INSERT INTO staff_identity (id, auth_user_id, display_name, status, created_at, updated_at) VALUES (?, ?, 'Admin Context', 'active', ?, ?)",
    ).bind(staffId, user.userId, now, now),
    env.DB.prepare(
      "INSERT INTO role (id, code, name, created_at) VALUES (?, ?, 'Ctx Role', ?)",
    ).bind(roleId, `ctx-${crypto.randomUUID().slice(0, 8)}`, now),
    env.DB.prepare("INSERT INTO staff_role (staff_id, role_id) VALUES (?, ?)").bind(
      staffId,
      roleId,
    ),
  ];
  const scope = options.scope ?? { kind: "location", locationId: "location-cebu-central" };
  statements.push(
    env.DB.prepare(
      "INSERT INTO staff_scope (id, staff_id, scope_kind, market_id, location_id) VALUES (?, ?, ?, ?, ?)",
    ).bind(
      crypto.randomUUID(),
      staffId,
      scope.kind,
      scope.kind === "market" ? scope.marketId : null,
      scope.kind === "location" ? scope.locationId : null,
    ),
  );
  for (const code of options.permissionCodes) {
    statements.push(
      env.DB.prepare(
        "INSERT OR IGNORE INTO permission (id, code, description, created_at) VALUES (?, ?, 'ctx', ?)",
      ).bind(crypto.randomUUID(), code, now),
    );
    statements.push(
      env.DB.prepare(
        "INSERT OR IGNORE INTO role_permission (role_id, permission_id) SELECT ?, id FROM permission WHERE code=?",
      ).bind(roleId, code),
    );
  }
  await env.DB.batch(statements);
  return user;
}

describe("scoped admin context", () => {
  it("denies context and scopes for an unauthenticated request", async () => {
    expect(await core.getAdminContext({ requestId: "r1", headers: {} })).toMatchObject({
      ok: false,
      error: { code: "UNAUTHENTICATED" },
    });
    expect(await core.listAdminScopes({ requestId: "r2", headers: {} })).toMatchObject({
      ok: false,
      error: { code: "UNAUTHENTICATED" },
    });
    expect(
      await core.getAdminBootstrap({
        requestId: "r3",
        headers: {},
        timezone: "Asia/Manila",
      }),
    ).toMatchObject({ ok: false, error: { code: "UNAUTHENTICATED" } });
  });

  it("returns FORBIDDEN for an authenticated non-staff user", async () => {
    const user = await signUp();
    const headers = { cookie: user.cookie };
    expect(await core.getAdminContext({ requestId: crypto.randomUUID(), headers })).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    expect(await core.listAdminScopes({ requestId: crypto.randomUUID(), headers })).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
  });

  it("treats a revoked or expired Better Auth session as unauthenticated", async () => {
    const user = await signUp();
    await env.DB.prepare("DELETE FROM session WHERE user_id=?").bind(user.userId).run();

    expect(
      await core.getAdminBootstrap({
        requestId: crypto.randomUUID(),
        headers: { cookie: user.cookie },
        timezone: "Asia/Manila",
      }),
    ).toMatchObject({ ok: false, error: { code: "UNAUTHENTICATED" } });
  });

  it("derives staff identity, canonical capabilities, scopes, and capability-filtered navigation", async () => {
    const staff = await staffCookie({ permissionCodes: ["audit.read"] });
    const context = await core.getAdminContext({
      requestId: crypto.randomUUID(),
      headers: { cookie: staff.cookie },
    });
    expect(context.ok).toBe(true);
    if (!context.ok) return;
    expect(context.value.capabilities).toEqual(["audit.read"]);
    expect(context.value.scopes).toEqual([
      { kind: "location", locationId: "location-cebu-central" },
    ]);
    expect(context.value.navigation.map((item) => item.code)).toEqual(["overview", "audit"]);
    expect(context.value.navigation).toContainEqual({
      code: "audit",
      label: "Audit log",
      href: "/admin/audit",
      section: "administration",
      scopeKinds: ["GLOBAL", "MARKET", "LOCATION"],
      parentCode: null,
      kind: "workspace",
    });
  });

  it("publishes capability-filtered parent and child destinations with canonical sections", async () => {
    const staff = await staffCookie({ permissionCodes: ["catalog.read", "payments.read"] });
    const context = await core.getAdminContext({
      requestId: crypto.randomUUID(),
      headers: { cookie: staff.cookie },
    });
    expect(context.ok).toBe(true);
    if (!context.ok) return;

    expect(context.value.navigation).toContainEqual({
      code: "products",
      label: "Products",
      href: "/admin/catalog/products",
      section: "commerce",
      scopeKinds: ["GLOBAL"],
      parentCode: null,
      kind: "workspace",
    });
    expect(context.value.navigation).toContainEqual({
      code: "products-list",
      label: "Product list",
      href: "/admin/catalog/products",
      section: "commerce",
      scopeKinds: ["GLOBAL"],
      parentCode: "products",
      kind: "destination",
    });
    expect(context.value.navigation).toContainEqual({
      code: "categories",
      label: "Categories",
      href: "/admin/catalog/categories",
      section: "commerce",
      scopeKinds: ["GLOBAL"],
      parentCode: "products",
      kind: "destination",
    });
    expect(context.value.navigation).not.toContainEqual(
      expect.objectContaining({ code: "categories-list" }),
    );
    expect(context.value.navigation).not.toContainEqual(
      expect.objectContaining({ code: "products-create" }),
    );
    expect(context.value.navigation).toContainEqual({
      code: "payments-transactions",
      label: "Transactions",
      href: "/admin/payments/transactions",
      section: "finance",
      scopeKinds: ["GLOBAL"],
      parentCode: "payments",
      kind: "destination",
    });
    expect(context.value.navigation).toContainEqual({
      code: "commerce-configuration",
      label: "Pricing & fees",
      href: "/admin/commerce-configuration",
      section: "finance",
      scopeKinds: ["GLOBAL"],
      parentCode: null,
      kind: "workspace",
    });
    expect(context.value.navigation).not.toContainEqual(
      expect.objectContaining({ section: "operations" }),
    );
  });

  it("marks Inventory as location-only even for a globally scoped Staff principal", async () => {
    const staff = await staffCookie({
      permissionCodes: ["inventory.read"],
      scope: { kind: "global" },
    });
    const context = await core.getAdminContext({
      requestId: crypto.randomUUID(),
      headers: { cookie: staff.cookie },
    });
    expect(context.ok).toBe(true);
    if (!context.ok) return;

    expect(context.value.navigation).toContainEqual(
      expect.objectContaining({ code: "inventory", scopeKinds: ["LOCATION"] }),
    );
  });

  it("returns only active markets and locations reachable by the assigned scope", async () => {
    const staff = await staffCookie({ permissionCodes: ["audit.read"] });
    const scopes = await core.listAdminScopes({
      requestId: crypto.randomUUID(),
      headers: { cookie: staff.cookie },
    });
    expect(scopes.ok).toBe(true);
    if (!scopes.ok) return;
    expect(scopes.value).toEqual([
      {
        kind: "location",
        marketId: "market-metro-cebu",
        marketCode: "METRO_CEBU",
        locationId: "location-cebu-central",
        locationCode: "CEBU_CENTRAL",
        locationName: "Cebu Central",
        currency: "PHP",
        timezone: "Asia/Manila",
      },
    ]);
    expect(JSON.stringify(scopes.value)).not.toContain("location-other-empty");
    expect(JSON.stringify(scopes.value)).not.toContain("polygon");
  });

  it("returns one authoritative bootstrap result and derives the only assigned scope", async () => {
    const staff = await staffCookie({ permissionCodes: ["audit.read"] });
    const result = await core.getAdminBootstrap({
      requestId: crypto.randomUUID(),
      headers: { cookie: staff.cookie },
      timezone: "UTC",
    });
    if (!result.ok) throw new Error(JSON.stringify(result.error));

    expect(result.value.context.capabilities).toEqual(["audit.read"]);
    expect(result.value.scopes).toHaveLength(1);
    expect(result.value.selection).toEqual({
      selectedScope: {
        kind: "LOCATION",
        marketId: "market-metro-cebu",
        locationId: "location-cebu-central",
      },
      source: "SINGLE_ASSIGNMENT",
      requestedScopeAccepted: null,
      timezone: "Asia/Manila",
    });
    expect(result.value.overview?.selectedScope).toEqual(result.value.selection.selectedScope);
  });

  it("rejects stale browser scope evidence without granting it or locking out Staff", async () => {
    const staff = await staffCookie({ permissionCodes: ["audit.read"] });
    const result = await core.getAdminBootstrap({
      requestId: crypto.randomUUID(),
      headers: { cookie: staff.cookie },
      selectedScope: { kind: "GLOBAL" },
      timezone: "Asia/Manila",
    });
    if (!result.ok) throw new Error(JSON.stringify(result.error));

    expect(result.value.selection.requestedScopeAccepted).toBe(false);
    expect(result.value.selection.source).toBe("SINGLE_ASSIGNMENT");
    expect(result.value.selection.selectedScope).toMatchObject({ kind: "LOCATION" });
  });

  it("resolves Better Auth and IAM once across bootstrap context, scopes, overview, and audit", async () => {
    const staff = await staffCookie({ permissionCodes: ["audit.read"] });
    const auth = createAuth(env);
    const session = vi.spyOn(auth.api, "getSession");

    const result = await getAdminBootstrap(
      { auth, db: env.DB, environment: "test" },
      {
        requestId: crypto.randomUUID(),
        headers: { cookie: staff.cookie },
        timezone: "Asia/Manila",
      },
    );

    expect(result.ok).toBe(true);
    expect(session).toHaveBeenCalledTimes(1);
  });
});
