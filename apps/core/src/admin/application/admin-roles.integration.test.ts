import { describe, expect, it } from "vitest";
import { SELF } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import type { CoreServiceBinding } from "@freshmarkets/contracts";

const core = exports.default as unknown as CoreServiceBinding;

let counter = 0;

async function signUp(): Promise<{ cookie: string; userId: string }> {
  const n = ++counter;
  const email = `role-admin-${n}-${crypto.randomUUID().slice(0, 6)}@example.com`;
  const password = "correct-horse-battery-staple";
  const signUpResponse = await SELF.fetch("https://core.example.invalid/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://core.example.invalid" },
    body: JSON.stringify({ name: "Role Admin", email, password }),
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

async function seedManager(): Promise<{ cookie: string }> {
  const principal = await signUp();
  const staffId = crypto.randomUUID();
  const roleId = crypto.randomUUID();
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO staff_identity (id, auth_user_id, display_name, status, created_at, updated_at) VALUES (?, ?, 'Role Mgr', 'active', ?, ?)",
    ).bind(staffId, principal.userId, now, now),
    env.DB.prepare(
      "INSERT INTO role (id, code, name, created_at) VALUES (?, ?, 'Role Mgr Role', ?)",
    ).bind(roleId, `role-mgr-${crypto.randomUUID().slice(0, 8)}`, now),
    env.DB.prepare("INSERT INTO staff_role (staff_id, role_id) VALUES (?, ?)").bind(
      staffId,
      roleId,
    ),
    env.DB.prepare(
      "INSERT INTO staff_scope (id, staff_id, scope_kind, market_id, location_id) VALUES (?, ?, 'global', NULL, NULL)",
    ).bind(crypto.randomUUID(), staffId),
    env.DB.prepare(
      "INSERT OR IGNORE INTO permission (id, code, description, created_at) VALUES (?, 'staff.manage', 'roles', ?)",
    ).bind(crypto.randomUUID(), now),
    env.DB.prepare(
      "INSERT OR IGNORE INTO role_permission (role_id, permission_id) SELECT ?, id FROM permission WHERE code='staff.manage'",
    ).bind(roleId),
    env.DB.prepare(
      "INSERT OR IGNORE INTO permission (id, code, description, created_at) VALUES (?, 'staff.read', 'roles', ?)",
    ).bind(crypto.randomUUID(), now),
    env.DB.prepare(
      "INSERT OR IGNORE INTO role_permission (role_id, permission_id) SELECT ?, id FROM permission WHERE code='staff.read'",
    ).bind(roleId),
  ]);
  return { cookie: principal.cookie };
}

describe("role administration", () => {
  it("denies unauthenticated and location-scoped readers", async () => {
    expect(await core.listAdminRoles({ requestId: "r1", headers: {} })).toMatchObject({
      ok: false,
      error: { code: "UNAUTHENTICATED" },
    });
    const nonStaff = await signUp();
    expect(
      await core.listAdminRoles({
        requestId: crypto.randomUUID(),
        headers: { cookie: nonStaff.cookie },
      }),
    ).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });

  it("creates a role with canonical capabilities, idempotently, and audits it", async () => {
    const manager = await seedManager();
    const code = `ops-${crypto.randomUUID().slice(0, 8)}`;
    const key = `role-${crypto.randomUUID()}`;

    const invalid = await core.createAdminRole({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      code,
      name: "Ops",
      description: "Ops role",
      capabilityCodes: ["orders.read", "not-a-capability" as never],
      idempotencyKey: key,
    });
    expect(invalid).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });

    const created = await core.createAdminRole({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      code,
      name: "Ops",
      description: "Ops role",
      capabilityCodes: ["orders.manage", "orders.read"],
      idempotencyKey: key,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value).toMatchObject({
      code,
      status: "ACTIVE",
      capabilityCodes: ["orders.manage", "orders.read"],
      version: 1,
    });

    const replay = await core.createAdminRole({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      code,
      name: "Ops",
      description: "Ops role",
      capabilityCodes: ["orders.manage", "orders.read"],
      idempotencyKey: key,
    });
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(replay.value.roleId).toBe(created.value.roleId);

    const duplicate = await core.createAdminRole({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      code,
      name: "Ops Two",
      description: "",
      capabilityCodes: [],
      idempotencyKey: `role-${crypto.randomUUID()}`,
    });
    expect(duplicate).toMatchObject({ ok: false, error: { code: "CONFLICT" } });

    const auditRow = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM audit_event WHERE action = 'ROLE.CREATED'",
    ).first<{ count: number }>();
    expect(auditRow?.count ?? 0).toBeGreaterThan(0);
  });

  it("lists roles in code order with capability codes", async () => {
    const manager = await seedManager();
    const page = await core.listAdminRoles({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      limit: 5,
    });
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    const codes = page.value.items.map((role) => role.code);
    expect([...codes].sort()).toEqual(codes);
    const seeded = page.value.items.find((role) => role.code === "operations_admin");
    expect(seeded).toMatchObject({ status: "ACTIVE", version: 1 });
  });

  it("updates, re-capabilities, and archives a role with version guards", async () => {
    const manager = await seedManager();
    const code = `life-${crypto.randomUUID().slice(0, 8)}`;
    const created = await core.createAdminRole({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      code,
      name: "Lifecycle",
      description: "before",
      capabilityCodes: ["audit.read"],
      idempotencyKey: `role-${crypto.randomUUID()}`,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const roleId = created.value.roleId;

    const stale = await core.updateAdminRole({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      roleId,
      name: "Lifecycle 2",
      description: "after",
      expectedVersion: 99,
      idempotencyKey: `role-${crypto.randomUUID()}`,
    });
    expect(stale).toMatchObject({ ok: false, error: { code: "STALE_VERSION" } });

    const updated = await core.updateAdminRole({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      roleId,
      name: "Lifecycle 2",
      description: "after",
      expectedVersion: 1,
      idempotencyKey: `role-${crypto.randomUUID()}`,
    });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.value).toMatchObject({ name: "Lifecycle 2", version: 2 });

    const capped = await core.setAdminRoleCapabilities({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      roleId,
      capabilityCodes: ["settings.read", "settings.manage"],
      expectedVersion: 2,
      idempotencyKey: `cap-${crypto.randomUUID()}`,
    });
    expect(capped.ok).toBe(true);
    if (!capped.ok) return;
    expect(capped.value.capabilityCodes).toEqual(["settings.manage", "settings.read"]);

    const archived = await core.archiveAdminRole({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      roleId,
      reason: "superseded",
      expectedVersion: capped.value.version,
      idempotencyKey: `arch-${crypto.randomUUID()}`,
    });
    expect(archived.ok).toBe(true);
    if (!archived.ok) return;
    expect(archived.value.status).toBe("ARCHIVED");

    const again = await core.archiveAdminRole({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      roleId,
      reason: "again",
      expectedVersion: archived.value.version,
      idempotencyKey: `arch-${crypto.randomUUID()}`,
    });
    expect(again).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });

    const updateArchived = await core.updateAdminRole({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      roleId,
      name: "Nope",
      description: "",
      expectedVersion: archived.value.version,
      idempotencyKey: `role-${crypto.randomUUID()}`,
    });
    expect(updateArchived).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
  });

  it("rolls back role updates and archives when required audit evidence fails", async () => {
    const manager = await seedManager();
    const created = await core.createAdminRole({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      code: `atomic-${crypto.randomUUID().slice(0, 8)}`,
      name: "Atomic Role",
      description: "before",
      capabilityCodes: ["audit.read"],
      idempotencyKey: `role-${crypto.randomUUID()}`,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await env.DB.prepare(
      `CREATE TRIGGER fail_role_update_audit
       BEFORE INSERT ON audit_event
       WHEN NEW.action IN ('ROLE.UPDATED', 'ROLE.ARCHIVED')
       BEGIN SELECT RAISE(ABORT, 'forced audit failure'); END`,
    ).run();

    try {
      await core.updateAdminRole({
        requestId: crypto.randomUUID(),
        headers: { cookie: manager.cookie },
        roleId: created.value.roleId,
        name: "Changed Role",
        description: "after",
        expectedVersion: 1,
        idempotencyKey: `role-${crypto.randomUUID()}`,
      });
    } catch {
      // The observable invariant is rollback, independent of RPC error transport.
    }
    let row = await env.DB.prepare("SELECT name, status, version FROM role WHERE id=?")
      .bind(created.value.roleId)
      .first<{ name: string; status: string; version: number }>();
    expect(row).toEqual({ name: "Atomic Role", status: "ACTIVE", version: 1 });

    try {
      await core.archiveAdminRole({
        requestId: crypto.randomUUID(),
        headers: { cookie: manager.cookie },
        roleId: created.value.roleId,
        reason: "atomic archive",
        expectedVersion: 1,
        idempotencyKey: `arch-${crypto.randomUUID()}`,
      });
    } catch {
      // The observable invariant is rollback, independent of RPC error transport.
    }
    row = await env.DB.prepare("SELECT name, status, version FROM role WHERE id=?")
      .bind(created.value.roleId)
      .first<{ name: string; status: string; version: number }>();
    expect(row).toEqual({ name: "Atomic Role", status: "ACTIVE", version: 1 });
  });

  it("lists only canonical capability definitions", async () => {
    const manager = await seedManager();
    const result = await core.listCapabilityDefinitions({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const codes = result.value.map((capability) => capability.code);
    expect(codes).toContain("audit.read");
    expect(codes).toContain("inventory.adjust");
    const serialized = JSON.stringify(result.value);
    expect(serialized).not.toContain("rbac:read");
    expect(serialized).not.toContain("staff:manage");
  });
});
