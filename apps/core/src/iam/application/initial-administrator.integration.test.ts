import { beforeEach, describe, expect, it } from "vitest";
import { SELF } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { z } from "@freshmarkets/validation";
import { adminCapabilityCodes } from "@freshmarkets/contracts";
import { createAuth } from "../../auth/service";
import {
  completeInitialAdministratorSetup,
  getInitialAdministratorSetup,
} from "./initial-administrator";

const core = exports.default;
const ownerEmail = "initial-admin@example.com";
const origin = "https://core.example.invalid";
async function account(email = ownerEmail, verified = true) {
  let user = await env.DB.prepare("SELECT id FROM user WHERE email=?")
    .bind(email)
    .first<{ id: string }>();
  if (!user) {
    const response = await SELF.fetch(`${origin}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({
        name: "Setup operator",
        email,
        password: "correct-horse-battery-staple",
      }),
    });
    expect(response.status).toBeLessThan(400);
    user = z.object({ user: z.object({ id: z.string() }) }).parse(await response.json()).user;
  }
  await env.DB.prepare("UPDATE user SET email_verified=? WHERE id=?").bind(1, user.id).run();
  const signed = await SELF.fetch(`${origin}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ email, password: "correct-horse-battery-staple" }),
  });
  expect(signed.status).toBeLessThan(400);
  if (!verified)
    await env.DB.prepare("UPDATE user SET email_verified=0 WHERE id=?").bind(user.id).run();
  const cookie = signed.headers
    .getSetCookie()
    .map((value) => value.split(";", 1)[0])
    .join("; ");
  return { userId: user.id, headers: { cookie }, requestId: crypto.randomUUID() };
}
function command(identity: Awaited<ReturnType<typeof account>>) {
  return { ...identity, expectedVersion: 0 as const, idempotencyKey: crypto.randomUUID() };
}

// Reset only this file's deliberately provisioned setup evidence between scenarios.
// Production commands have no reset or deletion path.
beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DROP TRIGGER initial_administrator_setup_immutable_delete"),
    env.DB.prepare("DELETE FROM initial_administrator_setup"),
    env.DB.prepare(
      "CREATE TRIGGER initial_administrator_setup_immutable_delete BEFORE DELETE ON initial_administrator_setup BEGIN SELECT RAISE(ABORT,'IMMUTABLE_INITIAL_ADMINISTRATOR_SETUP'); END",
    ),
    env.DB.prepare("DELETE FROM audit_event WHERE id='initial-administrator-setup'"),
    env.DB.prepare(
      "DELETE FROM staff_invitation_role WHERE invitation_id IN (SELECT i.id FROM staff_invitation i JOIN staff_identity s ON s.id=i.invited_by_staff_id JOIN user u ON u.id=s.auth_user_id WHERE u.email=?)",
    ).bind(ownerEmail),
    env.DB.prepare(
      "DELETE FROM staff_invitation_scope WHERE invitation_id IN (SELECT i.id FROM staff_invitation i JOIN staff_identity s ON s.id=i.invited_by_staff_id JOIN user u ON u.id=s.auth_user_id WHERE u.email=?)",
    ).bind(ownerEmail),
    env.DB.prepare(
      "DELETE FROM staff_invitation WHERE invited_by_staff_id IN (SELECT s.id FROM staff_identity s JOIN user u ON u.id=s.auth_user_id WHERE u.email=?)",
    ).bind(ownerEmail),
    env.DB.prepare(
      "DELETE FROM staff_identity WHERE auth_user_id IN (SELECT id FROM user WHERE email=?)",
    ).bind(ownerEmail),
  ]);
});

describe("initial Global administrator setup", () => {
  it("requires the configured verified identity and does not expose its email", async () => {
    expect(
      await core.getInitialAdministratorSetup({ headers: {}, requestId: crypto.randomUUID() }),
    ).toMatchObject({ ok: false, error: { code: "UNAUTHENTICATED" } });
    const other = await account(`other-${crypto.randomUUID()}@example.com`);
    expect(await core.getInitialAdministratorSetup(other)).toMatchObject({
      ok: true,
      value: { state: "UNAVAILABLE" },
    });
    expect(await core.completeInitialAdministratorSetup(command(other))).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    const own = await account(ownerEmail, false);
    expect(await core.getInitialAdministratorSetup(own)).toMatchObject({
      ok: true,
      value: { state: "VERIFY_EMAIL" },
    });
    expect(await core.completeInitialAdministratorSetup(command(own))).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    const deps = { auth: createAuth(env), db: env.DB };
    expect(await getInitialAdministratorSetup(deps, own)).toMatchObject({
      ok: true,
      value: { state: "UNAVAILABLE" },
    });
  });
  it("creates explicit Global capabilities once through Core and reaches staff invitation commands", async () => {
    const own = await account();
    const input = command(own);
    expect(await core.getInitialAdministratorSetup(own)).toMatchObject({
      ok: true,
      value: { state: "READY", expectedVersion: 0 },
    });
    const [first, second] = await Promise.all([
      core.completeInitialAdministratorSetup(input),
      core.completeInitialAdministratorSetup({ ...input, idempotencyKey: crypto.randomUUID() }),
    ]);
    expect([first, second].filter((result) => result.ok)).toHaveLength(1);
    const completed = await core.getInitialAdministratorSetup(own);
    expect(completed).toMatchObject({ ok: true, value: { state: "COMPLETED" } });
    const context = await core.getAdminContext(own);
    expect(context).toMatchObject({ ok: true, value: { scopes: [{ kind: "global" }] } });
    if (!context.ok) throw new Error("Missing setup access");
    expect([...context.value.capabilities].sort()).toEqual(
      adminCapabilityCodes.filter((code) => !code.startsWith("memberships.")).sort(),
    );
    const role = await core.createAdminRole({
      ...own,
      code: `setup-reader-${crypto.randomUUID()}`,
      name: "Local operator",
      description: "Setup journey",
      capabilityCodes: ["inventory.read"],
      idempotencyKey: crypto.randomUUID(),
    });
    if (!role.ok) throw new Error("Setup did not grant role management");
    expect(
      await core.inviteAdminStaff({
        ...own,
        email: `operator-${crypto.randomUUID()}@example.com`,
        displayName: "Local operator",
        roleIds: [role.value.roleId],
        scopes: [{ kind: "location", locationId: "location-cebu-central" }],
        idempotencyKey: crypto.randomUUID(),
      }),
    ).toMatchObject({ ok: true });
    expect(
      await env.DB.prepare("SELECT COUNT(*) count FROM initial_administrator_setup").first(),
    ).toEqual({ count: 1 });
    await expect(env.DB.prepare("DELETE FROM initial_administrator_setup").run()).rejects.toThrow();
    await expect(
      env.DB.prepare("UPDATE initial_administrator_setup SET completed_at=0").run(),
    ).rejects.toThrow();
  });
  it("replays the original receipt after setup configuration is removed without granting again", async () => {
    const own = await account();
    const input = command(own);
    const accepted = await core.completeInitialAdministratorSetup(input);
    expect(accepted).toMatchObject({ ok: true });
    expect(
      await completeInitialAdministratorSetup({ auth: createAuth(env), db: env.DB }, input),
    ).toEqual(accepted);
    expect(
      await core.completeInitialAdministratorSetup({
        ...input,
        idempotencyKey: crypto.randomUUID(),
      }),
    ).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) count FROM audit_event WHERE action='STAFF.INITIAL_ADMINISTRATOR_CREATED'",
      ).first(),
    ).toEqual({ count: 1 });
  });
  it.each(["active", "suspended"])(
    "does not reopen setup around an existing %s Global staff identity",
    async (status) => {
      const own = await account();
      await env.DB.prepare(
        "INSERT INTO staff_identity(id,auth_user_id,display_name,status,version,created_at,updated_at) VALUES (?,?,?, ?,1,0,0)",
      )
        .bind(`existing-${own.userId}`, own.userId, "Existing operator", status)
        .run();
      await env.DB.prepare(
        "INSERT INTO staff_scope(id,staff_id,scope_kind,market_id,location_id) VALUES (?,?,'global',NULL,NULL)",
      )
        .bind(`existing-scope-${own.userId}`, `existing-${own.userId}`)
        .run();
      expect(await core.getInitialAdministratorSetup(own)).toMatchObject({
        ok: true,
        value: { state: "UNAVAILABLE" },
      });
      expect(await core.completeInitialAdministratorSetup(command(own))).toMatchObject({
        ok: false,
        error: { code: "CONFLICT" },
      });
      expect(
        await env.DB.prepare("SELECT COUNT(*) count FROM initial_administrator_setup").first(),
      ).toEqual({ count: 0 });
    },
  );
  it.each([
    "role",
    "staff_identity",
    "staff_role",
    "staff_scope",
    "role_permission",
    "initial_administrator_setup",
    "audit_event",
    "idempotency_records",
  ])("rolls back suppressed %s and retries the same command", async (table) => {
    const own = await account();
    const input = command(own);
    const trigger =
      table === "idempotency_records"
        ? "BEFORE UPDATE ON idempotency_records WHEN NEW.scope='iam.initialAdministrator' AND NEW.status='SUCCEEDED'"
        : `BEFORE INSERT ON ${table}`;
    await env.DB.prepare(
      `CREATE TRIGGER test_ignore_initial_admin ${trigger} BEGIN SELECT RAISE(IGNORE); END`,
    ).run();
    try {
      expect(await core.completeInitialAdministratorSetup(input)).toMatchObject({
        ok: false,
        error: { code: "CONFLICT" },
      });
      expect(
        await env.DB.prepare("SELECT COUNT(*) count FROM initial_administrator_setup").first(),
      ).toEqual({ count: 0 });
      expect(
        await env.DB.prepare("SELECT COUNT(*) count FROM staff_identity WHERE auth_user_id=?")
          .bind(own.userId)
          .first(),
      ).toEqual({ count: 0 });
      expect(
        await env.DB.prepare(
          "SELECT COUNT(*) count FROM idempotency_records WHERE scope='iam.initialAdministrator' AND idempotency_key=?",
        )
          .bind(input.idempotencyKey)
          .first(),
      ).toEqual({ count: 0 });
    } finally {
      await env.DB.prepare("DROP TRIGGER test_ignore_initial_admin").run();
    }
    const completed = await core.completeInitialAdministratorSetup(input);
    expect(completed).toMatchObject({ ok: true });
    expect(await core.completeInitialAdministratorSetup(input)).toEqual(completed);
  });
  it("rejects another account receiving Global scope immediately before setup commits", async () => {
    const own = await account();
    const other = await account(`global-race-${crypto.randomUUID()}@example.com`);
    const otherStaffId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO staff_identity(id,auth_user_id,display_name,status,version,created_at,updated_at) VALUES (?,?,'Other operator','active',1,0,0)",
    )
      .bind(otherStaffId, other.userId)
      .run();
    const scopeId = crypto.randomUUID();
    const database = new Proxy(env.DB, {
      get(target, property) {
        if (property === "batch")
          return async (statements: D1PreparedStatement[]) => {
            await target
              .prepare(
                "INSERT INTO staff_scope(id,staff_id,scope_kind,market_id,location_id) VALUES (?,?,'global',NULL,NULL)",
              )
              .bind(scopeId, otherStaffId)
              .run();
            return target.batch(statements);
          };
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const input = command(own);
    try {
      expect(
        await completeInitialAdministratorSetup(
          { auth: createAuth(env), db: database, configuredEmail: ownerEmail },
          input,
        ),
      ).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
      expect(await core.getInitialAdministratorSetup(own)).toMatchObject({
        ok: true,
        value: { state: "UNAVAILABLE" },
      });
      expect(
        await env.DB.prepare("SELECT COUNT(*) count FROM staff_identity WHERE auth_user_id=?")
          .bind(own.userId)
          .first(),
      ).toEqual({ count: 0 });
      expect(
        await env.DB.prepare(
          "SELECT COUNT(*) count FROM idempotency_records WHERE scope='iam.initialAdministrator' AND idempotency_key=?",
        )
          .bind(input.idempotencyKey)
          .first(),
      ).toEqual({ count: 0 });
    } finally {
      await env.DB.prepare("DELETE FROM staff_identity WHERE id=?").bind(otherStaffId).run();
    }
  });
  it("rejects verification revoked immediately before the transaction", async () => {
    const own = await account();
    const input = command(own);
    const database = new Proxy(env.DB, {
      get(target, property) {
        if (property === "batch")
          return async (statements: D1PreparedStatement[]) => {
            await target
              .prepare("UPDATE user SET email_verified=0 WHERE id=?")
              .bind(own.userId)
              .run();
            return target.batch(statements);
          };
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    expect(
      await completeInitialAdministratorSetup(
        { auth: createAuth(env), db: database, configuredEmail: ownerEmail },
        input,
      ),
    ).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    expect(
      await env.DB.prepare("SELECT COUNT(*) count FROM initial_administrator_setup").first(),
    ).toEqual({ count: 0 });
  });
});
