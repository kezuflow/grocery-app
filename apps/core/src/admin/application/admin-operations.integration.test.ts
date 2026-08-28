import { describe, expect, it } from "vitest";
import { SELF } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import type { CoreServiceBinding } from "@freshmarkets/contracts";

const core = exports.default as unknown as CoreServiceBinding;
let counter = 0;

async function signUp(): Promise<{ cookie: string; userId: string }> {
  const email = `operations-${++counter}-${crypto.randomUUID().slice(0, 8)}@example.com`;
  const password = "correct-horse-battery-staple";
  const response = await SELF.fetch("https://core.example.invalid/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://core.example.invalid" },
    body: JSON.stringify({ name: "Operations staff", email, password }),
  });
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
  return { cookie, userId: body.user.id };
}

async function seedStaff(capability: string, scope: "global" | "location") {
  const principal = await signUp();
  const now = Date.now();
  const staffId = crypto.randomUUID();
  const roleId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO staff_identity (id, auth_user_id, display_name, status, created_at, updated_at) VALUES (?, ?, 'Ops', 'active', ?, ?)",
    ).bind(staffId, principal.userId, now, now),
    env.DB.prepare(
      "INSERT INTO role (id, code, name, created_at) VALUES (?, ?, 'Ops role', ?)",
    ).bind(roleId, `ops-${crypto.randomUUID().slice(0, 8)}`, now),
    env.DB.prepare("INSERT INTO staff_role (staff_id, role_id) VALUES (?, ?)").bind(
      staffId,
      roleId,
    ),
    env.DB.prepare(
      "INSERT INTO staff_scope (id, staff_id, scope_kind, market_id, location_id) VALUES (?, ?, ?, NULL, ?)",
    ).bind(
      crypto.randomUUID(),
      staffId,
      scope,
      scope === "location" ? "location-cebu-central" : null,
    ),
    env.DB.prepare(
      "INSERT OR IGNORE INTO permission (id, code, description, created_at) VALUES (?, ?, 'operations', ?)",
    ).bind(crypto.randomUUID(), capability, now),
    env.DB.prepare(
      "INSERT OR IGNORE INTO role_permission (role_id, permission_id) SELECT ?, id FROM permission WHERE code=?",
    ).bind(roleId, capability),
  ]);
  return principal.cookie;
}

describe("admin operations reads", () => {
  it("requires the named capability and operational scope instead of global scope", async () => {
    expect(
      await core.listProcurementRequirements({
        requestId: "r1",
        headers: {},
        locationId: "location-cebu-central",
      }),
    ).toMatchObject({ ok: false, error: { code: "UNAUTHENTICATED" } });
    const scopedReader = await seedStaff("procurement.read", "location");
    expect(
      await core.listProcurementRequirements({
        requestId: crypto.randomUUID(),
        headers: { cookie: scopedReader },
        locationId: "location-cebu-central",
      }),
    ).toMatchObject({ ok: true });
    expect(
      await core.listProcurementRequirements({
        requestId: crypto.randomUUID(),
        headers: { cookie: scopedReader },
        locationId: "location-not-allowed",
      }),
    ).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });
});
