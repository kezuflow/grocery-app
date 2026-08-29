import { describe, expect, it } from "vitest";
import { SELF } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import type { CoreServiceBinding } from "@freshmarkets/contracts";

const core = exports.default as unknown as CoreServiceBinding;

let counter = 0;

async function signUp(): Promise<{ cookie: string; userId: string; email: string }> {
  const n = ++counter;
  const email = `staff-admin-${n}-${crypto.randomUUID().slice(0, 6)}@example.com`;
  const password = "correct-horse-battery-staple";
  const signUpResponse = await SELF.fetch("https://core.example.invalid/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://core.example.invalid" },
    body: JSON.stringify({ name: "Staff Admin", email, password }),
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
  return { cookie, userId, email };
}

async function seedStaff(options: {
  principal: { cookie: string; userId: string; email: string };
  permissionCodes: string[];
  scope: { kind: "global" } | { kind: "location"; locationId: string };
  roleCode?: string;
  withCapability?: { code: string };
  displayName?: string;
}): Promise<{ cookie: string; userId: string; staffId: string }> {
  const now = Date.now();
  const staffId = crypto.randomUUID();
  const roleId = crypto.randomUUID();
  const statements = [
    env.DB.prepare(
      "INSERT INTO staff_identity (id, auth_user_id, display_name, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?)",
    ).bind(staffId, options.principal.userId, options.displayName ?? "Staff Member", now, now),
    env.DB.prepare("INSERT INTO role (id, code, name, created_at) VALUES (?, ?, 'Role', ?)").bind(
      roleId,
      options.roleCode ?? `role-${crypto.randomUUID().slice(0, 8)}`,
      now,
    ),
    env.DB.prepare("INSERT INTO staff_role (staff_id, role_id) VALUES (?, ?)").bind(
      staffId,
      roleId,
    ),
    env.DB.prepare(
      "INSERT INTO staff_scope (id, staff_id, scope_kind, market_id, location_id) VALUES (?, ?, ?, NULL, ?)",
    ).bind(
      crypto.randomUUID(),
      staffId,
      options.scope.kind,
      options.scope.kind === "location" ? options.scope.locationId : null,
    ),
  ];
  for (const code of options.permissionCodes) {
    statements.push(
      env.DB.prepare(
        "INSERT OR IGNORE INTO permission (id, code, description, created_at) VALUES (?, ?, 'staff-admin', ?)",
      ).bind(crypto.randomUUID(), code, now),
    );
    statements.push(
      env.DB.prepare(
        "INSERT OR IGNORE INTO role_permission (role_id, permission_id) SELECT ?, id FROM permission WHERE code=?",
      ).bind(roleId, code),
    );
  }
  await env.DB.batch(statements);
  return { ...options.principal, staffId };
}

describe("staff administration reads", () => {
  it("denies unauthenticated list, detail, and invitation reads", async () => {
    expect(await core.listAdminStaff({ requestId: "r1", headers: {} })).toMatchObject({
      ok: false,
      error: { code: "UNAUTHENTICATED" },
    });
    expect(
      await core.getAdminStaff({ requestId: "r2", headers: {}, staffId: "missing" }),
    ).toMatchObject({ ok: false, error: { code: "UNAUTHENTICATED" } });
    expect(await core.listAdminStaffInvitations({ requestId: "r3", headers: {} })).toMatchObject({
      ok: false,
      error: { code: "UNAUTHENTICATED" },
    });
  });

  it("denies non-staff and location-scoped principals even with the capability", async () => {
    const nonStaff = await signUp();
    expect(
      await core.listAdminStaff({
        requestId: crypto.randomUUID(),
        headers: { cookie: nonStaff.cookie },
      }),
    ).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });

    const locationScoped = await seedStaff({
      principal: await signUp(),
      permissionCodes: ["staff.read"],
      scope: { kind: "location", locationId: "location-cebu-central" },
    });
    expect(
      await core.listAdminStaff({
        requestId: crypto.randomUUID(),
        headers: { cookie: locationScoped.cookie },
      }),
    ).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });

  it("lists staff with roles, capabilities, scopes, and display email for global staff readers", async () => {
    const reader = await seedStaff({
      principal: await signUp(),
      permissionCodes: ["staff.read"],
      scope: { kind: "global" },
      roleCode: "reader-role",
    });
    const managed = await seedStaff({
      principal: await signUp(),
      permissionCodes: [],
      scope: { kind: "global" },
      roleCode: "managed-role",
      withCapability: undefined,
      displayName: "Managed Staff",
    });

    const page = await core.listAdminStaff({
      requestId: crypto.randomUUID(),
      headers: { cookie: reader.cookie },
      limit: 1,
    });
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    expect(page.value.items).toHaveLength(1);
    const first = page.value.items[0]!;
    expect(first).toMatchObject({
      displayName: "Managed Staff",
      status: "active",
      roleCodes: ["managed-role"],
      version: 1,
    });
    expect(first.email).toContain("@");
    expect(first.scopes).toEqual([{ kind: "global" }]);
    expect(page.value.nextCursor).toBeTruthy();

    const secondPage = await core.listAdminStaff({
      requestId: crypto.randomUUID(),
      headers: { cookie: reader.cookie },
      limit: 1,
      cursor: page.value.nextCursor!,
    });
    expect(secondPage.ok).toBe(true);
    if (!secondPage.ok) return;
    expect(secondPage.value.items.map((item) => item.staffId)).toContain(reader.staffId);

    const detail = await core.getAdminStaff({
      requestId: crypto.randomUUID(),
      headers: { cookie: reader.cookie },
      staffId: managed.staffId,
    });
    expect(detail.ok).toBe(true);
    if (!detail.ok) return;
    expect(detail.value.staffId).toBe(managed.staffId);
    expect(JSON.stringify(detail.value)).not.toContain("password");

    const missing = await core.getAdminStaff({
      requestId: crypto.randomUUID(),
      headers: { cookie: reader.cookie },
      staffId: "staff-does-not-exist",
    });
    expect(missing).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  });

  it("lists pending invitations for global staff readers", async () => {
    const reader = await seedStaff({
      principal: await signUp(),
      permissionCodes: ["staff.read"],
      scope: { kind: "global" },
    });
    const now = Date.now();
    await env.DB.prepare(
      "INSERT INTO staff_invitation (id, email_normalized, display_name, status, invited_by_staff_id, expires_at, version, idempotency_key, created_at, updated_at) VALUES (?, ?, 'Invited Staff', 'PENDING', ?, ?, 1, ?, ?, ?)",
    )
      .bind(
        crypto.randomUUID(),
        `invited-${crypto.randomUUID().slice(0, 6)}@example.com`,
        reader.staffId,
        now + 14 * 24 * 60 * 60 * 1000,
        `inv-list-${crypto.randomUUID()}`,
        now,
        now,
      )
      .run();

    const page = await core.listAdminStaffInvitations({
      requestId: crypto.randomUUID(),
      headers: { cookie: reader.cookie },
    });
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    expect(page.value.items.length).toBeGreaterThan(0);
    expect(page.value.items[0]).toMatchObject({ status: "PENDING", displayName: "Invited Staff" });
  });
});

async function seedManager(): Promise<{ cookie: string; staffId: string }> {
  const manager = await seedStaff({
    principal: await signUp(),
    permissionCodes: ["staff.manage"],
    scope: { kind: "global" },
    roleCode: `manager-${crypto.randomUUID().slice(0, 8)}`,
  });
  return manager;
}

describe("staff administration commands", () => {
  it("requires staff.manage with a global scope for invitations", async () => {
    const reader = await seedStaff({
      principal: await signUp(),
      permissionCodes: ["staff.read"],
      scope: { kind: "global" },
    });
    const denied = await core.inviteAdminStaff({
      requestId: crypto.randomUUID(),
      headers: { cookie: reader.cookie },
      email: `new-${crypto.randomUUID().slice(0, 6)}@example.com`,
      displayName: "New Staff",
      idempotencyKey: `inv-${crypto.randomUUID()}`,
    });
    expect(denied).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });

  it("creates a pending invitation idempotently and audits it", async () => {
    const manager = await seedManager();
    const email = `invited-${crypto.randomUUID().slice(0, 6)}@example.com`;
    const key = `inv-${crypto.randomUUID()}`;
    const created = await core.inviteAdminStaff({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      email,
      displayName: "Invited Staff",
      idempotencyKey: key,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value).toMatchObject({ email, displayName: "Invited Staff", status: "PENDING" });

    const replay = await core.inviteAdminStaff({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      email,
      displayName: "Invited Staff",
      idempotencyKey: key,
    });
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(replay.value.invitationId).toBe(created.value.invitationId);

    const conflict = await core.inviteAdminStaff({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      email: `other-${crypto.randomUUID().slice(0, 6)}@example.com`,
      displayName: "Other Staff",
      idempotencyKey: key,
    });
    expect(conflict).toMatchObject({ ok: false, error: { code: "IDEMPOTENCY_CONFLICT" } });

    const duplicate = await core.inviteAdminStaff({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      email,
      displayName: "Invited Staff",
      idempotencyKey: `inv-${crypto.randomUUID()}`,
    });
    expect(duplicate).toMatchObject({ ok: false, error: { code: "CONFLICT" } });

    const auditRow = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM audit_event WHERE action = 'STAFF.INVITED'",
    ).first<{ count: number }>();
    expect(auditRow?.count ?? 0).toBeGreaterThan(0);
  });

  it("revokes a pending invitation once", async () => {
    const manager = await seedManager();
    const created = await core.inviteAdminStaff({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      email: `revoke-${crypto.randomUUID().slice(0, 6)}@example.com`,
      displayName: "Revoke Me",
      idempotencyKey: `inv-${crypto.randomUUID()}`,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const revoked = await core.revokeAdminStaffInvitation({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      invitationId: created.value.invitationId,
      reason: "no longer required",
      idempotencyKey: `rvk-${crypto.randomUUID()}`,
    });
    expect(revoked.ok).toBe(true);
    if (!revoked.ok) return;
    expect(revoked.value.status).toBe("REVOKED");

    const again = await core.revokeAdminStaffInvitation({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      invitationId: created.value.invitationId,
      reason: "no longer required",
      idempotencyKey: `rvk-${crypto.randomUUID()}`,
    });
    expect(again).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
  });

  it("renames staff with version guard and audit", async () => {
    const manager = await seedManager();
    const target = await seedStaff({
      principal: await signUp(),
      permissionCodes: [],
      scope: { kind: "global" },
      displayName: "Before Name",
    });

    const stale = await core.updateAdminStaff({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      staffId: target.staffId,
      displayName: "After Name",
      expectedVersion: 99,
      idempotencyKey: `upd-${crypto.randomUUID()}`,
    });
    expect(stale).toMatchObject({ ok: false, error: { code: "STALE_VERSION" } });

    const updated = await core.updateAdminStaff({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      staffId: target.staffId,
      displayName: "After Name",
      expectedVersion: 1,
      idempotencyKey: `upd-${crypto.randomUUID()}`,
    });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.value).toMatchObject({ displayName: "After Name", version: 2 });

    const auditRow = await env.DB.prepare(
      "SELECT before_json, after_json FROM audit_event WHERE action = 'STAFF.UPDATED' ORDER BY occurred_at DESC LIMIT 1",
    ).first<{ before_json: string; after_json: string }>();
    expect(JSON.parse(auditRow!.before_json)).toEqual({ displayName: "Before Name" });
    expect(JSON.parse(auditRow!.after_json)).toEqual({ displayName: "After Name" });
  });

  it("rolls back a staff rename when its required audit cannot be recorded", async () => {
    const manager = await seedManager();
    const target = await seedStaff({
      principal: await signUp(),
      permissionCodes: [],
      scope: { kind: "global" },
      displayName: "Atomic Before",
    });
    await env.DB.prepare(
      `CREATE TRIGGER fail_staff_update_audit
       BEFORE INSERT ON audit_event
       WHEN NEW.action = 'STAFF.UPDATED'
       BEGIN SELECT RAISE(ABORT, 'forced audit failure'); END`,
    ).run();

    try {
      await core.updateAdminStaff({
        requestId: crypto.randomUUID(),
        headers: { cookie: manager.cookie },
        staffId: target.staffId,
        displayName: "Atomic After",
        expectedVersion: 1,
        idempotencyKey: `upd-${crypto.randomUUID()}`,
      });
    } catch {
      // The observable invariant is rollback, independent of RPC error transport.
    }

    const row = await env.DB.prepare("SELECT display_name, version FROM staff_identity WHERE id=?")
      .bind(target.staffId)
      .first<{ display_name: string; version: number }>();
    expect(row).toEqual({ display_name: "Atomic Before", version: 1 });
  });

  it("changes access both directions with reasons and rejects same-state changes", async () => {
    const manager = await seedManager();
    const target = await seedStaff({
      principal: await signUp(),
      permissionCodes: [],
      scope: { kind: "global" },
    });

    const suspended = await core.changeAdminStaffAccess({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      staffId: target.staffId,
      action: "SUSPEND",
      reason: "leave of absence",
      expectedVersion: 1,
      idempotencyKey: `acc-${crypto.randomUUID()}`,
    });
    expect(suspended.ok).toBe(true);
    if (!suspended.ok) return;
    expect(suspended.value.status).toBe("suspended");

    const sameState = await core.changeAdminStaffAccess({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      staffId: target.staffId,
      action: "SUSPEND",
      reason: "already suspended",
      expectedVersion: suspended.value.version,
      idempotencyKey: `acc-${crypto.randomUUID()}`,
    });
    expect(sameState).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });

    const activated = await core.changeAdminStaffAccess({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      staffId: target.staffId,
      action: "ACTIVATE",
      reason: "returned to work",
      expectedVersion: suspended.value.version,
      idempotencyKey: `acc-${crypto.randomUUID()}`,
    });
    expect(activated.ok).toBe(true);
    if (!activated.ok) return;
    expect(activated.value.status).toBe("active");
  });

  it("rolls back staff access changes when required audit evidence fails", async () => {
    const manager = await seedManager();
    const target = await seedStaff({
      principal: await signUp(),
      permissionCodes: [],
      scope: { kind: "global" },
    });
    await env.DB.prepare(
      `CREATE TRIGGER fail_staff_access_audit
       BEFORE INSERT ON audit_event
       WHEN NEW.action = 'STAFF.ACCESS_CHANGED'
       BEGIN SELECT RAISE(ABORT, 'forced audit failure'); END`,
    ).run();

    try {
      await core.changeAdminStaffAccess({
        requestId: crypto.randomUUID(),
        headers: { cookie: manager.cookie },
        staffId: target.staffId,
        action: "SUSPEND",
        reason: "atomic access",
        expectedVersion: 1,
        idempotencyKey: `acc-${crypto.randomUUID()}`,
      });
    } catch {
      // The observable invariant is rollback, independent of RPC error transport.
    }

    const row = await env.DB.prepare("SELECT status, version FROM staff_identity WHERE id=?")
      .bind(target.staffId)
      .first<{ status: string; version: number }>();
    expect(row).toEqual({ status: "active", version: 1 });
  });

  it("replaces roles atomically, rejects unknown and archived roles, and audits", async () => {
    const manager = await seedManager();
    const target = await seedStaff({
      principal: await signUp(),
      permissionCodes: [],
      scope: { kind: "global" },
      roleCode: "initial-role",
    });
    const now = Date.now();
    const activeRole = crypto.randomUUID();
    const archivedRole = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO role (id, code, name, created_at) VALUES (?, ?, 'Active', ?)",
      ).bind(activeRole, `active-${crypto.randomUUID().slice(0, 8)}`, now),
      env.DB.prepare(
        "INSERT INTO role (id, code, name, status, created_at) VALUES (?, ?, 'Archived', 'ARCHIVED', ?)",
      ).bind(archivedRole, `archived-${crypto.randomUUID().slice(0, 8)}`, now),
    ]);

    const archived = await core.setAdminStaffRoles({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      staffId: target.staffId,
      roleIds: [archivedRole],
      expectedVersion: 1,
      idempotencyKey: `roles-${crypto.randomUUID()}`,
    });
    expect(archived).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });

    const unknown = await core.setAdminStaffRoles({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      staffId: target.staffId,
      roleIds: ["role-does-not-exist"],
      expectedVersion: 1,
      idempotencyKey: `roles-${crypto.randomUUID()}`,
    });
    expect(unknown).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });

    const stale = await core.setAdminStaffRoles({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      staffId: target.staffId,
      roleIds: [activeRole],
      expectedVersion: 42,
      idempotencyKey: `roles-${crypto.randomUUID()}`,
    });
    expect(stale).toMatchObject({ ok: false, error: { code: "STALE_VERSION" } });

    const replaced = await core.setAdminStaffRoles({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      staffId: target.staffId,
      roleIds: [activeRole],
      expectedVersion: 1,
      idempotencyKey: `roles-${crypto.randomUUID()}`,
    });
    expect(replaced.ok).toBe(true);
    if (!replaced.ok) return;
    expect(replaced.value.roleCodes).not.toContain("initial-role");
    expect(replaced.value.version).toBe(2);

    const auditRow = await env.DB.prepare(
      "SELECT after_json FROM audit_event WHERE action = 'STAFF.ROLES_SET' ORDER BY occurred_at DESC LIMIT 1",
    ).first<{ after_json: string }>();
    expect(JSON.parse(auditRow!.after_json).roleCodes).toEqual(replaced.value.roleCodes);
  });

  it("replaces scopes atomically and rejects malformed inputs at the boundary", async () => {
    const manager = await seedManager();
    const target = await seedStaff({
      principal: await signUp(),
      permissionCodes: [],
      scope: { kind: "global" },
    });

    const replaced = await core.setAdminStaffScopes({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      staffId: target.staffId,
      scopes: [
        { kind: "location", locationId: "location-cebu-central" },
        { kind: "market", marketId: "market-metro-cebu" },
      ],
      expectedVersion: 1,
      idempotencyKey: `scope-${crypto.randomUUID()}`,
    });
    expect(replaced.ok).toBe(true);
    if (!replaced.ok) return;
    expect(replaced.value.scopes).toEqual(
      expect.arrayContaining([
        { kind: "location", locationId: "location-cebu-central" },
        { kind: "market", marketId: "market-metro-cebu" },
      ]),
    );

    const malformed = await core.setAdminStaffScopes({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      staffId: target.staffId,
      scopes: [
        { kind: "location", locationId: "location-cebu-central" },
        { kind: "bogus" } as never,
      ],
      expectedVersion: replaced.value.version,
      idempotencyKey: `scope-${crypto.randomUUID()}`,
    });
    expect(malformed).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });

    const stale = await core.setAdminStaffScopes({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      staffId: target.staffId,
      scopes: [{ kind: "global" }],
      expectedVersion: 99,
      idempotencyKey: `scope-${crypto.randomUUID()}`,
    });
    expect(stale).toMatchObject({ ok: false, error: { code: "STALE_VERSION" } });
  });

  it("revokes live Better Auth sessions for the target staff user", async () => {
    const manager = await seedManager();
    const targetPrincipal = await signUp();
    const target = await seedStaff({
      principal: targetPrincipal,
      permissionCodes: ["audit.read"],
      scope: { kind: "global" },
    });
    expect(targetPrincipal.cookie).not.toBe("");

    const before = await env.DB.prepare("SELECT COUNT(*) AS count FROM session WHERE user_id = ?")
      .bind(targetPrincipal.userId)
      .first<{ count: number }>();
    expect(before?.count ?? 0).toBeGreaterThan(0);

    const revoked = await core.revokeAdminStaffSessions({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      staffId: target.staffId,
      reason: "offboarding check",
      idempotencyKey: `ses-${crypto.randomUUID()}`,
    });
    expect(revoked.ok).toBe(true);
    if (!revoked.ok) return;
    expect(revoked.value.revokedSessionCount).toBe(before?.count ?? 0);

    const after = await env.DB.prepare("SELECT COUNT(*) AS count FROM session WHERE user_id = ?")
      .bind(targetPrincipal.userId)
      .first<{ count: number }>();
    expect(after?.count ?? 0).toBe(0);

    const auditRow = await env.DB.prepare(
      "SELECT reason FROM audit_event WHERE action = 'STAFF.SESSIONS_REVOKED' ORDER BY occurred_at DESC LIMIT 1",
    ).first<{ reason: string | null }>();
    expect(auditRow?.reason).toBe("offboarding check");
  });

  it("keeps staff sessions when revocation audit cannot be recorded", async () => {
    const manager = await seedManager();
    const targetPrincipal = await signUp();
    const target = await seedStaff({
      principal: targetPrincipal,
      permissionCodes: [],
      scope: { kind: "global" },
    });
    const before = await env.DB.prepare("SELECT COUNT(*) AS count FROM session WHERE user_id=?")
      .bind(targetPrincipal.userId)
      .first<{ count: number }>();
    await env.DB.prepare(
      `CREATE TRIGGER fail_staff_session_audit
       BEFORE INSERT ON audit_event
       WHEN NEW.action = 'STAFF.SESSIONS_REVOKED'
       BEGIN SELECT RAISE(ABORT, 'forced audit failure'); END`,
    ).run();

    try {
      await core.revokeAdminStaffSessions({
        requestId: crypto.randomUUID(),
        headers: { cookie: manager.cookie },
        staffId: target.staffId,
        reason: "atomic revocation",
        idempotencyKey: `ses-${crypto.randomUUID()}`,
      });
    } catch {
      // The observable invariant is rollback, independent of RPC error transport.
    }

    const after = await env.DB.prepare("SELECT COUNT(*) AS count FROM session WHERE user_id=?")
      .bind(targetPrincipal.userId)
      .first<{ count: number }>();
    expect(after?.count).toBe(before?.count);
  });
});
