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
    ).bind(
      crypto.randomUUID(),
      `invited-${crypto.randomUUID().slice(0, 6)}@example.com`,
      reader.staffId,
      now + 14 * 24 * 60 * 60 * 1000,
      `inv-list-${crypto.randomUUID()}`,
      now,
      now,
    ).run();

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
