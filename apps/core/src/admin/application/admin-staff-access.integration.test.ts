import { describe, expect, it } from "vitest";
import { SELF } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import type { CoreServiceBinding } from "@freshmarkets/contracts";
import { acceptStaffInvitation } from "../../iam/application/accept-staff-invitation";
import { createAuth } from "../../auth/service";
import { requestHash } from "../../idempotency";
import { inviteAdminStaff, revokeAdminStaffInvitation } from "./invite-admin-staff";
import { createAdminRole } from "./create-admin-role";
import { updateAdminStaff, changeAdminStaffAccess } from "./update-admin-staff";

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
  it.each(["rename", "access"] as const)(
    "rejects %s after current manager scope is revoked",
    async (kind) => {
      const manager = await seedManager();
      const target = await seedStaff({
        principal: await signUp(),
        permissionCodes: [],
        scope: { kind: "global" },
      });
      const own = {
        headers: { cookie: manager.cookie },
        requestId: crypto.randomUUID(),
        idempotencyKey: crypto.randomUUID(),
        staffId: target.staffId,
        expectedVersion: 1,
      };
      const db = new Proxy(env.DB, {
        get(database, property) {
          if (property === "batch")
            return async (statements: D1PreparedStatement[]) => {
              await database
                .prepare("DELETE FROM staff_scope WHERE staff_id=?")
                .bind(manager.staffId)
                .run();
              return database.batch(statements);
            };
          const value = Reflect.get(database, property, database);
          return typeof value === "function" ? value.bind(database) : value;
        },
      });
      const deps = { auth: createAuth(env), db };
      const result =
        kind === "rename"
          ? await updateAdminStaff(deps, { ...own, displayName: "Unauthorized" })
          : await changeAdminStaffAccess(deps, {
              ...own,
              action: "SUSPEND",
              reason: "Unauthorized",
            });
      expect(result).toMatchObject({ ok: false });
      expect(
        await env.DB.prepare("SELECT status,version,display_name FROM staff_identity WHERE id=?")
          .bind(target.staffId)
          .first(),
      ).toEqual({ status: "active", version: 1, display_name: "Staff Member" });
      expect(
        await env.DB.prepare(
          "SELECT COUNT(*) count FROM idempotency_records WHERE idempotency_key=?",
        )
          .bind(own.idempotencyKey)
          .first(),
      ).toEqual({ count: 0 });
    },
  );
  it.each(["transition", "audit", "receipt"] as const)(
    "rolls back ignored staff %s and retries the same access command",
    async (effect) => {
      const manager = await seedManager();
      const target = await seedStaff({
        principal: await signUp(),
        permissionCodes: [],
        scope: { kind: "global" },
      });
      const command = {
        headers: { cookie: manager.cookie },
        requestId: crypto.randomUUID(),
        idempotencyKey: crypto.randomUUID(),
        staffId: target.staffId,
        expectedVersion: 1,
        action: "SUSPEND" as const,
        reason: "Required effects",
      };
      const trigger =
        effect === "transition"
          ? "BEFORE UPDATE ON staff_identity WHEN NEW.status='suspended'"
          : effect === "audit"
            ? "BEFORE INSERT ON audit_event WHEN NEW.action='STAFF.ACCESS_CHANGED'"
            : "BEFORE UPDATE ON idempotency_records WHEN NEW.scope='admin.staff.access' AND NEW.status='SUCCEEDED'";
      await env.DB.prepare(
        `CREATE TRIGGER test_ignore_staff_change ${trigger} BEGIN SELECT RAISE(IGNORE); END`,
      ).run();
      try {
        expect(await core.changeAdminStaffAccess(command)).toMatchObject({ ok: false });
        expect(
          await env.DB.prepare("SELECT status,version FROM staff_identity WHERE id=?")
            .bind(target.staffId)
            .first(),
        ).toEqual({ status: "active", version: 1 });
        expect(
          await env.DB.prepare(
            "SELECT COUNT(*) count FROM idempotency_records WHERE idempotency_key=?",
          )
            .bind(command.idempotencyKey)
            .first(),
        ).toEqual({ count: 0 });
        expect(
          await env.DB.prepare("SELECT COUNT(*) count FROM audit_event WHERE aggregate_id=?")
            .bind(target.staffId)
            .first(),
        ).toEqual({ count: 0 });
      } finally {
        await env.DB.prepare("DROP TRIGGER test_ignore_staff_change").run();
      }
      const result = await core.changeAdminStaffAccess(command);
      expect(result).toMatchObject({ ok: true, value: { status: "suspended", version: 2 } });
      expect(await core.changeAdminStaffAccess(command)).toEqual(result);
    },
  );
  it("keeps original staff receipts after subsequent changes and serializes competing edits", async () => {
    const fixture = await revocable();
    const accepted = await core.acceptStaffInvitation({
      headers: { cookie: fixture.invitee.cookie },
      requestId: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
      invitationId: fixture.created.invitationId,
      expectedVersion: fixture.created.version,
    });
    if (!accepted.ok) throw new Error("Invitation acceptance failed");
    const own = {
      headers: { cookie: fixture.manager.cookie },
      requestId: crypto.randomUUID(),
      staffId: accepted.value.staffId,
    };
    const rename = {
      ...own,
      displayName: "Reviewed name",
      expectedVersion: 1,
      idempotencyKey: crypto.randomUUID(),
    };
    const renamed = await core.updateAdminStaff(rename);
    expect(renamed).toMatchObject({
      ok: true,
      value: { displayName: "Reviewed name", version: 2, roleCodes: ["operations_viewer"] },
    });
    const suspend = {
      ...own,
      action: "SUSPEND" as const,
      reason: "Leave",
      expectedVersion: 2,
      idempotencyKey: crypto.randomUUID(),
    };
    const suspended = await core.changeAdminStaffAccess(suspend);
    expect(suspended).toMatchObject({ ok: true, value: { status: "suspended", version: 3 } });
    expect(await core.changeAdminStaffAccess(suspend)).toEqual(suspended);
    expect(await core.updateAdminStaff(rename)).toEqual(renamed);
    expect(await core.updateAdminStaff({ ...rename, displayName: "Changed intent" })).toMatchObject(
      { ok: false, error: { code: "IDEMPOTENCY_CONFLICT" } },
    );
    const outcomes = await Promise.all(
      ["First", "Second"].map((displayName) =>
        core.updateAdminStaff({
          ...own,
          displayName,
          expectedVersion: 3,
          idempotencyKey: crypto.randomUUID(),
        }),
      ),
    );
    expect(outcomes.filter((result) => result.ok)).toHaveLength(1);
    expect(
      await env.DB.prepare("SELECT version FROM staff_identity WHERE id=?")
        .bind(accepted.value.staffId)
        .first(),
    ).toEqual({ version: 4 });
  });
  async function revocable() {
    const manager = await seedManager();
    const invitee = await signUp();
    const created = await core.inviteAdminStaff({
      headers: { cookie: manager.cookie },
      requestId: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
      email: invitee.email,
      displayName: "Revocation target",
      roleIds: ["role_operations_viewer"],
      scopes: [{ kind: "location", locationId: "location-cebu-central" }],
    });
    if (!created.ok) throw new Error("Invitation missing");
    const command = {
      headers: { cookie: manager.cookie },
      requestId: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
      invitationId: created.value.invitationId,
      expectedVersion: created.value.version,
      reason: "Invitation withdrawn",
    };
    return { manager, invitee, created: created.value, command };
  }
  it("replays retained success evidence without repeating creation or revocation", async () => {
    const fixture = await revocable();
    const revoked = await core.revokeAdminStaffInvitation(fixture.command);
    expect(revoked).toMatchObject({ ok: true });
    const legacyHash = await requestHash({
      invitationId: fixture.command.invitationId,
      reason: fixture.command.reason,
    });
    await env.DB.prepare(
      "UPDATE idempotency_records SET result_type='admin.staff.invitation.revoke',request_hash=?,result_reference=? WHERE scope='admin.staff.invitation.revoke' AND idempotency_key=?",
    )
      .bind(legacyHash, fixture.command.invitationId, fixture.command.idempotencyKey)
      .run();
    expect(await core.revokeAdminStaffInvitation(fixture.command)).toEqual(revoked);
    expect(
      await core.revokeAdminStaffInvitation({ ...fixture.command, reason: "Different intent" }),
    ).toMatchObject({ ok: false, error: { code: "IDEMPOTENCY_CONFLICT" } });
    expect(
      await env.DB.prepare("SELECT COUNT(*) count FROM audit_event WHERE correlation_id=?")
        .bind(fixture.command.requestId)
        .first(),
    ).toEqual({ count: 1 });
  });
  it.each(["transition", "audit", "receipt"])(
    "rolls back an ignored revocation %s and replays recovery",
    async (effect) => {
      const fixture = await revocable();
      const trigger =
        effect === "transition"
          ? "BEFORE UPDATE ON staff_invitation WHEN NEW.status='REVOKED'"
          : effect === "audit"
            ? "BEFORE INSERT ON audit_event WHEN NEW.action='STAFF.INVITATION_REVOKED'"
            : "BEFORE UPDATE ON idempotency_records WHEN NEW.scope='admin.staff.invitation.revoke' AND NEW.status='SUCCEEDED'";
      await env.DB.prepare(
        `CREATE TRIGGER test_ignore_staff_revoke ${trigger} BEGIN SELECT RAISE(IGNORE); END`,
      ).run();
      try {
        expect(await core.revokeAdminStaffInvitation(fixture.command)).toMatchObject({
          ok: false,
          error: { code: "CONFLICT" },
        });
        expect(
          await env.DB.prepare("SELECT status,version FROM staff_invitation WHERE id=?")
            .bind(fixture.created.invitationId)
            .first(),
        ).toEqual({ status: "PENDING", version: 1 });
        expect(
          await env.DB.prepare(
            "SELECT COUNT(*) count FROM idempotency_records WHERE idempotency_key=?",
          )
            .bind(fixture.command.idempotencyKey)
            .first(),
        ).toEqual({ count: 0 });
        expect(
          await env.DB.prepare("SELECT COUNT(*) count FROM audit_event WHERE correlation_id=?")
            .bind(fixture.command.requestId)
            .first(),
        ).toEqual({ count: 0 });
      } finally {
        await env.DB.prepare("DROP TRIGGER test_ignore_staff_revoke").run();
      }
      const revoked = await core.revokeAdminStaffInvitation(fixture.command);
      expect(revoked).toMatchObject({ ok: true, value: { status: "REVOKED", version: 2 } });
      expect(await core.revokeAdminStaffInvitation(fixture.command)).toEqual(revoked);
    },
  );
  it("rejects stale revocation and coordinates concurrent invitee acceptance", async () => {
    const fixture = await revocable();
    expect(
      await core.revokeAdminStaffInvitation({ ...fixture.command, expectedVersion: 2 }),
    ).toMatchObject({ ok: false, error: { code: "STALE_VERSION" } });
    const accepted = {
      headers: { cookie: fixture.invitee.cookie },
      requestId: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
      invitationId: fixture.created.invitationId,
      expectedVersion: 1,
    };
    const [revoke, accept] = await Promise.all([
      core.revokeAdminStaffInvitation(fixture.command),
      core.acceptStaffInvitation(accepted),
    ]);
    expect([revoke, accept].filter((result) => result.ok)).toHaveLength(1);
    expect(
      await env.DB.prepare("SELECT status,version FROM staff_invitation WHERE id=?")
        .bind(fixture.created.invitationId)
        .first(),
    ).toEqual({ status: revoke.ok ? "REVOKED" : "ACCEPTED", version: 2 });
    expect(
      await env.DB.prepare("SELECT COUNT(*) count FROM staff_identity WHERE auth_user_id=?")
        .bind(fixture.invitee.userId)
        .first(),
    ).toEqual({ count: accept.ok ? 1 : 0 });
  });
  it("rejects revocation if the manager loses Global scope before its transaction", async () => {
    const fixture = await revocable();
    const database = new Proxy(env.DB, {
      get(target, property) {
        if (property === "batch")
          return async (statements: D1PreparedStatement[]) => {
            await target
              .prepare("DELETE FROM staff_scope WHERE staff_id=?")
              .bind(fixture.manager.staffId)
              .run();
            return target.batch(statements);
          };
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    expect(
      await revokeAdminStaffInvitation({ auth: createAuth(env), db: database }, fixture.command),
    ).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    expect(
      await env.DB.prepare("SELECT status,version FROM staff_invitation WHERE id=?")
        .bind(fixture.created.invitationId)
        .first(),
    ).toEqual({ status: "PENDING", version: 1 });
    expect(
      await env.DB.prepare("SELECT COUNT(*) count FROM idempotency_records WHERE idempotency_key=?")
        .bind(fixture.command.idempotencyKey)
        .first(),
    ).toEqual({ count: 0 });
  });
  it.each(["role", "grant", "invitation", "audit", "receipt"])(
    "rolls back suppressed %s creation effects and safely retries",
    async (effect) => {
      const manager = await seedManager();
      const roleCommand = {
        headers: { cookie: manager.cookie },
        requestId: crypto.randomUUID(),
        idempotencyKey: crypto.randomUUID(),
        code: `guarded-${crypto.randomUUID()}`,
        name: "Guarded role",
        description: "Required effects",
        capabilityCodes: ["inventory.read", "orders.read"] as const,
      };
      const inviteCommand = {
        headers: { cookie: manager.cookie },
        requestId: crypto.randomUUID(),
        idempotencyKey: crypto.randomUUID(),
        email: `guarded-${crypto.randomUUID()}@example.com`,
        displayName: "Guarded invitation",
        roleIds: ["role_operations_viewer"],
        scopes: [{ kind: "location", locationId: "location-cebu-central" }] as const,
      };
      const roleEffect = effect === "role" || effect === "grant";
      const command = roleEffect ? roleCommand : inviteCommand;
      const trigger =
        effect === "role"
          ? "BEFORE INSERT ON role"
          : effect === "grant"
            ? "BEFORE INSERT ON role_permission WHEN NEW.permission_id IN (SELECT id FROM permission WHERE code='orders.read')"
            : effect === "invitation"
              ? "BEFORE INSERT ON staff_invitation"
              : effect === "audit"
                ? "BEFORE INSERT ON audit_event WHEN NEW.action='STAFF.INVITED'"
                : "BEFORE UPDATE ON idempotency_records WHEN NEW.scope='admin.staff.invite' AND NEW.status='SUCCEEDED'";
      await env.DB.prepare(
        `CREATE TRIGGER test_ignore_staff_creation ${trigger} BEGIN SELECT RAISE(IGNORE); END`,
      ).run();
      try {
        expect(
          roleEffect
            ? await core.createAdminRole(roleCommand)
            : await core.inviteAdminStaff(inviteCommand),
        ).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
        expect(
          await env.DB.prepare("SELECT COUNT(*) count FROM role WHERE code=?")
            .bind(roleCommand.code)
            .first(),
        ).toEqual({ count: 0 });
        expect(
          await env.DB.prepare(
            "SELECT COUNT(*) count FROM staff_invitation WHERE email_normalized=?",
          )
            .bind(inviteCommand.email)
            .first(),
        ).toEqual({ count: 0 });
        expect(
          await env.DB.prepare("SELECT COUNT(*) count FROM audit_event WHERE correlation_id=?")
            .bind(command.requestId)
            .first(),
        ).toEqual({ count: 0 });
        expect(
          await env.DB.prepare(
            "SELECT COUNT(*) count FROM idempotency_records WHERE idempotency_key=?",
          )
            .bind(command.idempotencyKey)
            .first(),
        ).toEqual({ count: 0 });
      } finally {
        await env.DB.prepare("DROP TRIGGER test_ignore_staff_creation").run();
      }
      const result = roleEffect
        ? await core.createAdminRole(roleCommand)
        : await core.inviteAdminStaff(inviteCommand);
      expect(result).toMatchObject({ ok: true });
      expect(
        roleEffect
          ? await core.createAdminRole(roleCommand)
          : await core.inviteAdminStaff(inviteCommand),
      ).toEqual(result);
    },
  );
  it("preserves the original creation receipts after later role and invitation changes", async () => {
    const manager = await seedManager();
    const own = { headers: { cookie: manager.cookie }, requestId: crypto.randomUUID() };
    const roleCommand = {
      ...own,
      idempotencyKey: crypto.randomUUID(),
      code: `snapshot-${crypto.randomUUID()}`,
      name: "Original role",
      description: "Original",
      capabilityCodes: ["inventory.read"] as const,
    };
    const created = await core.createAdminRole(roleCommand);
    if (!created.ok) throw new Error("Missing created role");
    expect(
      await core.updateAdminRole({
        ...own,
        roleId: created.value.roleId,
        expectedVersion: created.value.version,
        name: "Renamed role",
        description: "Changed",
        idempotencyKey: crypto.randomUUID(),
      }),
    ).toMatchObject({ ok: true });
    expect(await core.createAdminRole(roleCommand)).toEqual(created);
    const inviteCommand = {
      ...own,
      idempotencyKey: crypto.randomUUID(),
      email: `snapshot-${crypto.randomUUID()}@example.com`,
      displayName: "Original invitation",
      roleIds: [created.value.roleId],
      scopes: [{ kind: "location", locationId: "location-cebu-central" }] as const,
    };
    const invited = await core.inviteAdminStaff(inviteCommand);
    if (!invited.ok) throw new Error("Missing invitation");
    expect(
      await core.revokeAdminStaffInvitation({
        ...own,
        invitationId: invited.value.invitationId,
        expectedVersion: invited.value.version,
        reason: "Superseded",
        idempotencyKey: crypto.randomUUID(),
      }),
    ).toMatchObject({ ok: true });
    expect(await core.inviteAdminStaff(inviteCommand)).toEqual(invited);
  });
  it.each(["role", "invitation"])(
    "rejects %s creation when the manager loses Global scope before the batch",
    async (kind) => {
      const manager = await seedManager();
      const key = crypto.randomUUID();
      const requestId = crypto.randomUUID();
      const code = `revoked-${crypto.randomUUID()}`;
      const email = `revoked-${crypto.randomUUID()}@example.com`;
      const database = new Proxy(env.DB, {
        get(target, property) {
          if (property === "batch")
            return async (statements: D1PreparedStatement[]) => {
              await target
                .prepare("DELETE FROM staff_scope WHERE staff_id=?")
                .bind(manager.staffId)
                .run();
              return target.batch(statements);
            };
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      const deps = { auth: createAuth(env), db: database };
      const own = { headers: { cookie: manager.cookie }, idempotencyKey: key, requestId };
      const result =
        kind === "role"
          ? await createAdminRole(deps, {
              ...own,
              code,
              name: "Revoked creator",
              description: "Guard test",
              capabilityCodes: ["inventory.read"],
            })
          : await inviteAdminStaff(deps, {
              ...own,
              email,
              displayName: "Revoked invitation",
              roleIds: ["role_operations_viewer"],
              scopes: [{ kind: "location", locationId: "location-cebu-central" }],
            });
      expect(result).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
      expect(
        await env.DB.prepare("SELECT COUNT(*) count FROM role WHERE code=?").bind(code).first(),
      ).toEqual({ count: 0 });
      expect(
        await env.DB.prepare("SELECT COUNT(*) count FROM staff_invitation WHERE email_normalized=?")
          .bind(email)
          .first(),
      ).toEqual({ count: 0 });
      expect(
        await env.DB.prepare(
          "SELECT COUNT(*) count FROM idempotency_records WHERE idempotency_key=?",
        )
          .bind(key)
          .first(),
      ).toEqual({ count: 0 });
      expect(
        await env.DB.prepare("SELECT COUNT(*) count FROM audit_event WHERE correlation_id=?")
          .bind(requestId)
          .first(),
      ).toEqual({ count: 0 });
    },
  );
  it("requires staff.manage with a global scope for invitations", async () => {
    const reader = await seedStaff({
      principal: await signUp(),
      permissionCodes: ["staff.read"],
      scope: { kind: "global" },
    });
    const denied = await core.inviteAdminStaff({
      roleIds: ["role_operations_viewer"],
      scopes: [{ kind: "location", locationId: "location-cebu-central" }],
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
      roleIds: ["role_operations_viewer"],
      scopes: [{ kind: "location", locationId: "location-cebu-central" }],
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
      roleIds: ["role_operations_viewer"],
      scopes: [{ kind: "location", locationId: "location-cebu-central" }],
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
      roleIds: ["role_operations_viewer"],
      scopes: [{ kind: "location", locationId: "location-cebu-central" }],
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      email: `other-${crypto.randomUUID().slice(0, 6)}@example.com`,
      displayName: "Other Staff",
      idempotencyKey: key,
    });
    expect(conflict).toMatchObject({ ok: false, error: { code: "IDEMPOTENCY_CONFLICT" } });

    const duplicate = await core.inviteAdminStaff({
      roleIds: ["role_operations_viewer"],
      scopes: [{ kind: "location", locationId: "location-cebu-central" }],
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
      roleIds: ["role_operations_viewer"],
      scopes: [{ kind: "location", locationId: "location-cebu-central" }],
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      email: `revoke-${crypto.randomUUID().slice(0, 6)}@example.com`,
      displayName: "Revoke Me",
      idempotencyKey: `inv-${crypto.randomUUID()}`,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const revokeKey = `rvk-${crypto.randomUUID()}`;
    const revoked = await core.revokeAdminStaffInvitation({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      invitationId: created.value.invitationId,
      expectedVersion: created.value.version,
      reason: "no longer required",
      idempotencyKey: revokeKey,
    });
    expect(revoked.ok).toBe(true);
    if (!revoked.ok) return;
    expect(revoked.value.status).toBe("REVOKED");

    const replay = await core.revokeAdminStaffInvitation({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      invitationId: created.value.invitationId,
      expectedVersion: created.value.version,
      reason: "no longer required",
      idempotencyKey: revokeKey,
    });
    expect(replay.ok).toBe(true);

    const conflict = await core.revokeAdminStaffInvitation({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      invitationId: created.value.invitationId,
      expectedVersion: created.value.version,
      reason: "different reason",
      idempotencyKey: revokeKey,
    });
    expect(conflict).toMatchObject({ ok: false, error: { code: "IDEMPOTENCY_CONFLICT" } });

    const again = await core.revokeAdminStaffInvitation({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      invitationId: created.value.invitationId,
      expectedVersion: created.value.version,
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

  it("rejects unknown, inactive, and cross-market geography scopes", async () => {
    const manager = await seedManager();
    const target = await seedStaff({
      principal: await signUp(),
      permissionCodes: [],
      scope: { kind: "global" },
    });
    const now = Date.now();
    const inactiveMarketId = `market-${crypto.randomUUID()}`;
    const activeMarketId = `market-${crypto.randomUUID()}`;
    const inactiveLocationId = `location-${crypto.randomUUID()}`;
    const otherLocationId = `location-${crypto.randomUUID()}`;
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO market (id, organization_id, code, name, currency, timezone, status, created_at, updated_at) VALUES (?, (SELECT id FROM organization LIMIT 1), ?, 'Inactive', 'PHP', 'Asia/Manila', 'inactive', ?, ?)",
      ).bind(inactiveMarketId, `inactive-${crypto.randomUUID()}`, now, now),
      env.DB.prepare(
        "INSERT INTO market (id, organization_id, code, name, currency, timezone, status, created_at, updated_at) VALUES (?, (SELECT id FROM organization LIMIT 1), ?, 'Other', 'PHP', 'Asia/Manila', 'active', ?, ?)",
      ).bind(activeMarketId, `other-${crypto.randomUUID()}`, now, now),
      env.DB.prepare(
        "INSERT INTO fulfillment_location (id, market_id, code, name, type, latitude, longitude, status, created_at, updated_at) VALUES (?, 'market-metro-cebu', ?, 'Inactive location', 'FULFILLMENT_CENTER', 10.3, 123.9, 'inactive', ?, ?)",
      ).bind(inactiveLocationId, `inactive-${crypto.randomUUID()}`, now, now),
      env.DB.prepare(
        "INSERT INTO fulfillment_location (id, market_id, code, name, type, latitude, longitude, status, created_at, updated_at) VALUES (?, ?, ?, 'Other location', 'FULFILLMENT_CENTER', 10.3, 123.9, 'active', ?, ?)",
      ).bind(otherLocationId, activeMarketId, `other-${crypto.randomUUID()}`, now, now),
    ]);

    for (const scopes of [
      [{ kind: "market", marketId: "market-missing" }],
      [{ kind: "market", marketId: inactiveMarketId }],
      [{ kind: "location", locationId: "location-missing" }],
      [{ kind: "location", locationId: inactiveLocationId }],
      [
        { kind: "market", marketId: "market-metro-cebu" },
        { kind: "location", locationId: otherLocationId },
      ],
    ] as const) {
      const result = await core.setAdminStaffScopes({
        requestId: crypto.randomUUID(),
        headers: { cookie: manager.cookie },
        staffId: target.staffId,
        scopes,
        expectedVersion: 1,
        idempotencyKey: `scope-${crypto.randomUUID()}`,
      });
      expect(result).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
    }
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

describe("staff invitation acceptance", () => {
  async function offered() {
    const manager = await seedManager();
    const principal = await signUp();
    const role = await core.createAdminRole({
      headers: { cookie: manager.cookie },
      requestId: crypto.randomUUID(),
      code: `onboarding-${crypto.randomUUID()}`,
      name: "Local inventory reader",
      description: "Onboarding test",
      capabilityCodes: ["inventory.read"],
      idempotencyKey: crypto.randomUUID(),
    });
    if (!role.ok) throw new Error("Role creation failed");
    const invitation = await core.inviteAdminStaff({
      headers: { cookie: manager.cookie },
      requestId: crypto.randomUUID(),
      email: principal.email,
      displayName: "Invited operator",
      roleIds: [role.value.roleId],
      scopes: [{ kind: "location", locationId: "location-cebu-central" }],
      idempotencyKey: crypto.randomUUID(),
    });
    if (!invitation.ok) throw new Error("Invitation creation failed");
    return { manager, principal, invitation: invitation.value, role: role.value };
  }
  it.each(["PROCESSING", "FAILED"])(
    "recovers a retained %s acceptance claim without widening its intent",
    async (status) => {
      const fixture = await offered();
      const offer = await core.getMyStaffInvitation({
        headers: { cookie: fixture.principal.cookie },
        requestId: crypto.randomUUID(),
      });
      if (!offer.ok || !offer.value) throw new Error("Offer missing");
      const command = {
        headers: { cookie: fixture.principal.cookie },
        requestId: crypto.randomUUID(),
        invitationId: fixture.invitation.invitationId,
        expectedVersion: offer.value.version,
        idempotencyKey: crypto.randomUUID(),
      };
      const hash = await requestHash({
        invitationId: command.invitationId,
        expectedVersion: command.expectedVersion,
        userId: fixture.principal.userId,
      });
      await env.DB.prepare(
        "INSERT INTO idempotency_records(scope,idempotency_key,request_hash,status,result_type,created_at,updated_at) VALUES ('iam.acceptInvitation',?,?,?,'iam.acceptInvitation',?,?)",
      )
        .bind(command.idempotencyKey, hash, status, Date.now(), Date.now())
        .run();
      expect(
        await core.acceptStaffInvitation({
          ...command,
          expectedVersion: command.expectedVersion + 1,
        }),
      ).toMatchObject({ ok: false, error: { code: "IDEMPOTENCY_CONFLICT" } });
      const accepted = await core.acceptStaffInvitation(command);
      expect(accepted).toMatchObject({ ok: true });
      expect(await core.acceptStaffInvitation(command)).toEqual(accepted);
      expect(
        await env.DB.prepare("SELECT COUNT(*) AS count FROM staff_identity WHERE auth_user_id=?")
          .bind(fixture.principal.userId)
          .first(),
      ).toEqual({ count: 1 });
    },
  );
  it("accepts the saved grants once through Core and cannot escalate or cross identities", async () => {
    const fixture = await offered();
    const own = { headers: { cookie: fixture.principal.cookie }, requestId: crypto.randomUUID() };
    const offer = await core.getMyStaffInvitation(own);
    expect(offer).toMatchObject({
      ok: true,
      value: {
        invitationId: fixture.invitation.invitationId,
        roles: [{ roleId: fixture.role.roleId }],
        scopes: [{ scope: { kind: "location", locationId: "location-cebu-central" } }],
      },
    });
    if (!offer.ok || !offer.value) throw new Error("Offer missing");
    const command = {
      ...own,
      invitationId: offer.value.invitationId,
      expectedVersion: offer.value.version,
      idempotencyKey: crypto.randomUUID(),
    };
    const other = await signUp();
    expect(
      await core.acceptStaffInvitation({ ...command, headers: { cookie: other.cookie } }),
    ).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(await core.acceptStaffInvitation({ ...command, headers: {} })).toMatchObject({
      ok: false,
      error: { code: "UNAUTHENTICATED" },
    });
    const second = { ...command, idempotencyKey: crypto.randomUUID() };
    const results = await Promise.all([
      core.acceptStaffInvitation(command),
      core.acceptStaffInvitation(second),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    const winning = results[0]?.ok ? command : second;
    expect(await core.acceptStaffInvitation(winning)).toMatchObject({ ok: true });
    expect(
      await core.acceptStaffInvitation({
        ...winning,
        expectedVersion: winning.expectedVersion + 1,
      }),
    ).toMatchObject({ ok: false, error: { code: "IDEMPOTENCY_CONFLICT" } });
    const context = await core.getAdminContext(own);
    expect(context).toMatchObject({
      ok: true,
      value: {
        capabilities: ["inventory.read"],
        scopes: [{ kind: "location", locationId: "location-cebu-central" }],
      },
    });
    expect(await core.listAdminStaff(own)).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS count FROM staff_identity WHERE auth_user_id=?")
        .bind(fixture.principal.userId)
        .first(),
    ).toEqual({ count: 1 });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM audit_event WHERE action='STAFF.INVITATION_ACCEPTED' AND actor_user_id=?",
      )
        .bind(fixture.principal.userId)
        .first(),
    ).toEqual({ count: 1 });
  });
  it("rolls back every access effect when acceptance audit fails, then safely retries", async () => {
    const fixture = await offered();
    const command = {
      headers: { cookie: fixture.principal.cookie },
      requestId: crypto.randomUUID(),
      invitationId: fixture.invitation.invitationId,
      expectedVersion: 1,
      idempotencyKey: crypto.randomUUID(),
    };
    await env.DB.prepare(`CREATE TRIGGER reject_staff_acceptance BEFORE INSERT ON audit_event
      WHEN NEW.action='STAFF.INVITATION_ACCEPTED' BEGIN SELECT RAISE(ABORT,'test audit rejection'); END`).run();
    try {
      expect(await core.acceptStaffInvitation(command)).toMatchObject({ ok: false });
      expect(
        await env.DB.prepare("SELECT status,version FROM staff_invitation WHERE id=?")
          .bind(command.invitationId)
          .first(),
      ).toEqual({ status: "PENDING", version: 1 });
      expect(
        await env.DB.prepare("SELECT COUNT(*) AS count FROM staff_identity WHERE auth_user_id=?")
          .bind(fixture.principal.userId)
          .first(),
      ).toEqual({ count: 0 });
    } finally {
      await env.DB.exec("DROP TRIGGER reject_staff_acceptance");
    }
    expect(await core.acceptStaffInvitation(command)).toMatchObject({ ok: true });
  });
  it.each(["staff", "role", "scope", "audit", "receipt"] as const)(
    "rejects an ignored required %s without granting partial access or success",
    async (effect) => {
      const fixture = await offered();
      const command = {
        headers: { cookie: fixture.principal.cookie },
        requestId: crypto.randomUUID(),
        invitationId: fixture.invitation.invitationId,
        expectedVersion: 1,
        idempotencyKey: crypto.randomUUID(),
      };
      const target =
        effect === "staff"
          ? "BEFORE INSERT ON staff_identity"
          : effect === "role"
            ? "BEFORE INSERT ON staff_role"
            : effect === "scope"
              ? "BEFORE INSERT ON staff_scope"
              : effect === "audit"
                ? "BEFORE INSERT ON audit_event WHEN NEW.action='STAFF.INVITATION_ACCEPTED'"
                : "BEFORE UPDATE ON idempotency_records WHEN NEW.scope='iam.acceptInvitation' AND NEW.status='SUCCEEDED'";
      await env.DB.exec(
        `CREATE TRIGGER ignore_invitation_effect ${target} BEGIN SELECT RAISE(IGNORE); END`,
      );
      try {
        expect(await core.acceptStaffInvitation(command)).toMatchObject({
          ok: false,
          error: { code: "CONFLICT" },
        });
        expect(
          await env.DB.prepare("SELECT status,version FROM staff_invitation WHERE id=?")
            .bind(command.invitationId)
            .first(),
        ).toEqual({ status: "PENDING", version: 1 });
        expect(
          await env.DB.prepare("SELECT COUNT(*) n FROM staff_identity WHERE auth_user_id=?")
            .bind(fixture.principal.userId)
            .first(),
        ).toEqual({ n: 0 });
        expect(
          await env.DB.prepare(
            "SELECT COUNT(*) n FROM idempotency_records WHERE scope='iam.acceptInvitation' AND idempotency_key=?",
          )
            .bind(command.idempotencyKey)
            .first(),
        ).toEqual({ n: 0 });
      } finally {
        await env.DB.exec("DROP TRIGGER ignore_invitation_effect");
      }
      const accepted = await core.acceptStaffInvitation(command);
      expect(accepted.ok).toBe(true);
      expect(await core.acceptStaffInvitation(command)).toEqual(accepted);
    },
  );
  it.each(["email", "verification"] as const)(
    "rechecks current %s after authentication before accepting access",
    async (change) => {
      const fixture = await offered();
      const command = {
        headers: { cookie: fixture.principal.cookie },
        requestId: crypto.randomUUID(),
        invitationId: fixture.invitation.invitationId,
        expectedVersion: 1,
        idempotencyKey: crypto.randomUUID(),
      };
      const db = new Proxy(env.DB, {
        get(target, key) {
          if (key === "batch")
            return async (statements: D1PreparedStatement[]) => {
              await target
                .prepare(
                  change === "email"
                    ? "UPDATE user SET email=? WHERE id=?"
                    : "UPDATE user SET email_verified=? WHERE id=?",
                )
                .bind(
                  change === "email" ? `${crypto.randomUUID()}@example.com` : 0,
                  fixture.principal.userId,
                )
                .run();
              return target.batch(statements);
            };
          const value: unknown = Reflect.get(target, key, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      expect(await acceptStaffInvitation({ auth: createAuth(env), db }, command)).toMatchObject({
        ok: false,
        error: { code: "CONFLICT" },
      });
      expect(
        await env.DB.prepare("SELECT COUNT(*) n FROM staff_identity WHERE auth_user_id=?")
          .bind(fixture.principal.userId)
          .first(),
      ).toEqual({ n: 0 });
      expect(
        await env.DB.prepare("SELECT status,version FROM staff_invitation WHERE id=?")
          .bind(command.invitationId)
          .first(),
      ).toEqual({ status: "PENDING", version: 1 });
    },
  );
  it("rejects unverified identity, expired invitations and archived roles without access", async () => {
    const fixture = await offered();
    const command = {
      headers: { cookie: fixture.principal.cookie },
      requestId: crypto.randomUUID(),
      invitationId: fixture.invitation.invitationId,
      expectedVersion: 1,
      idempotencyKey: crypto.randomUUID(),
    };
    await env.DB.prepare("UPDATE user SET email_verified=0 WHERE id=?")
      .bind(fixture.principal.userId)
      .run();
    expect(await core.acceptStaffInvitation(command)).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    await env.DB.prepare("UPDATE user SET email_verified=1 WHERE id=?")
      .bind(fixture.principal.userId)
      .run();
    await env.DB.prepare("UPDATE staff_invitation SET expires_at=? WHERE id=?")
      .bind(Date.now() - 1, command.invitationId)
      .run();
    expect(await core.acceptStaffInvitation(command)).toMatchObject({ ok: false });
    await env.DB.prepare("UPDATE staff_invitation SET expires_at=? WHERE id=?")
      .bind(Date.now() + 60_000, command.invitationId)
      .run();
    await env.DB.prepare("UPDATE role SET status='ARCHIVED' WHERE id=?")
      .bind(fixture.role.roleId)
      .run();
    expect(
      await core.acceptStaffInvitation({ ...command, idempotencyKey: crypto.randomUUID() }),
    ).toMatchObject({ ok: false });
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS count FROM staff_identity WHERE auth_user_id=?")
        .bind(fixture.principal.userId)
        .first(),
    ).toEqual({ count: 0 });
  });
});
