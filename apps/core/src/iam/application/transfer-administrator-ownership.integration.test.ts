import { describe, expect, it } from "vitest";
import { SELF } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { z } from "@freshmarkets/validation";
import { transferAdministratorOwnership } from "./transfer-administrator-ownership";

const core = exports.default;
const origin = "https://core.example.invalid";

async function createVerifiedAccount(email: string, name: string) {
  const password = "correct-horse-battery-staple";
  const created = await SELF.fetch(`${origin}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ name, email, password }),
  });
  expect(created.status).toBeLessThan(400);
  const user = z.object({ user: z.object({ id: z.string() }) }).parse(await created.json()).user;
  await env.DB.prepare("UPDATE user SET email_verified=1 WHERE id=?").bind(user.id).run();
  const signed = await SELF.fetch(`${origin}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ email, password }),
  });
  expect(signed.status).toBeLessThan(400);
  return {
    userId: user.id,
    headers: {
      cookie: signed.headers
        .getSetCookie()
        .map((value) => value.split(";", 1)[0])
        .join("; "),
    },
    requestId: crypto.randomUUID(),
  };
}

describe("one-time administrator ownership transfer", () => {
  it("retires the synthetic credential and moves the exact Global grant atomically", async () => {
    const unavailable = await SELF.fetch(
      `${origin}/internal/one-time/administrator-ownership-transfer`,
      { method: "POST" },
    );
    expect(unavailable.status).toBe(404);

    const sourceEmail = "initial-admin@example.com";
    const targetEmail = `private-${crypto.randomUUID()}@example.com`;
    const source = await createVerifiedAccount(sourceEmail, "Synthetic administrator");
    const target = await createVerifiedAccount(targetEmail, "Production owner");
    const setup = await core.completeInitialAdministratorSetup({
      ...source,
      expectedVersion: 0,
      idempotencyKey: crypto.randomUUID(),
    });
    expect(setup.ok).toBe(true);
    if (!setup.ok) return;

    const input = {
      sourceEmail,
      targetEmail,
      idempotencyKey: crypto.randomUUID(),
      requestId: crypto.randomUUID(),
    };
    const transferred = await transferAdministratorOwnership(env.DB, input);
    expect(transferred.revokedSessionCount).toBe(1);
    expect(transferred.removedAccountCount).toBe(1);
    await expect(transferAdministratorOwnership(env.DB, input)).resolves.toEqual(transferred);

    expect(
      await env.DB.prepare("SELECT COUNT(*) count FROM user WHERE lower(email)=?")
        .bind(sourceEmail)
        .first(),
    ).toMatchObject({ count: 0 });
    expect(
      await env.DB.prepare("SELECT COUNT(*) count FROM account WHERE user_id=?")
        .bind(source.userId)
        .first(),
    ).toMatchObject({ count: 0 });
    expect(
      await env.DB.prepare("SELECT COUNT(*) count FROM session WHERE user_id=?")
        .bind(source.userId)
        .first(),
    ).toMatchObject({ count: 0 });
    expect(
      await env.DB.prepare(`SELECT s.status,s.version,
        (SELECT COUNT(*) FROM staff_role WHERE staff_id=s.id) roleCount,
        (SELECT COUNT(*) FROM staff_scope WHERE staff_id=s.id) scopeCount
        FROM staff_identity s WHERE s.auth_user_id=?`)
        .bind(source.userId)
        .first(),
    ).toMatchObject({ status: "suspended", version: 2, roleCount: 0, scopeCount: 0 });
    expect(
      await env.DB.prepare(`SELECT s.status,sc.scope_kind,r.id roleId
        FROM staff_identity s JOIN staff_scope sc ON sc.staff_id=s.id
        JOIN staff_role sr ON sr.staff_id=s.id JOIN role r ON r.id=sr.role_id
        WHERE s.auth_user_id=?`)
        .bind(target.userId)
        .first(),
    ).toMatchObject({ status: "active", scope_kind: "global" });
    expect(
      await env.DB.prepare("SELECT COUNT(*) count FROM administrator_ownership_transfer").first(),
    ).toMatchObject({ count: 1 });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) count FROM audit_event WHERE action='STAFF.ADMINISTRATOR_OWNERSHIP_TRANSFERRED'",
      ).first(),
    ).toMatchObject({ count: 1 });
    await expect(
      env.DB.prepare(
        "UPDATE administrator_ownership_transfer SET completed_at=completed_at+1 WHERE id=1",
      ).run(),
    ).rejects.toThrow("IMMUTABLE_ADMINISTRATOR_OWNERSHIP_TRANSFER");
  });
});
