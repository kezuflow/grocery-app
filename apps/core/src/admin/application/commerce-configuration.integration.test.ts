import { describe, expect, it } from "vitest";
import { SELF } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import type { CoreServiceBinding } from "@freshmarkets/contracts";

const core = exports.default as unknown as CoreServiceBinding;
let counter = 0;

async function seedStaff(capability: string, scope: "global" | "location" = "global") {
  const email = `commerce-config-${++counter}-${crypto.randomUUID().slice(0, 6)}@example.com`;
  const password = "correct-horse-battery-staple";
  const response = await SELF.fetch("https://core.example.invalid/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://core.example.invalid" },
    body: JSON.stringify({ name: "Commerce Config Admin", email, password }),
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
  const now = Date.now();
  const staffId = crypto.randomUUID();
  const roleId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO staff_identity (id, auth_user_id, display_name, status, created_at, updated_at) VALUES (?, ?, 'Config Admin', 'active', ?, ?)",
    ).bind(staffId, body.user.id, now, now),
    env.DB.prepare(
      "INSERT INTO role (id, code, name, created_at) VALUES (?, ?, 'Config Role', ?)",
    ).bind(roleId, `config-${crypto.randomUUID().slice(0, 8)}`, now),
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
      "INSERT OR IGNORE INTO permission (id, code, description, created_at) VALUES (?, ?, 'commerce config', ?)",
    ).bind(crypto.randomUUID(), capability, now),
    env.DB.prepare(
      "INSERT INTO role_permission (role_id, permission_id) SELECT ?, id FROM permission WHERE code=?",
    ).bind(roleId, capability),
  ]);
  return { cookie, staffId };
}

describe("commerce pricing configuration", () => {
  it("requires memberships.read plus global scope for membership pricing", async () => {
    const scoped = await seedStaff("memberships.read", "location");
    expect(
      await core.getMembershipPriceConfiguration({
        requestId: crypto.randomUUID(),
        headers: { cookie: scoped.cookie },
      }),
    ).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });

    const reader = await seedStaff("memberships.read");
    const result = await core.getMembershipPriceConfiguration({
      requestId: crypto.randomUUID(),
      headers: { cookie: reader.cookie },
    });
    expect(result).toMatchObject({ ok: true, value: { amountMinor: 29_900, version: 1 } });
  });

  it("requires payments.manage and writes an audited idempotent Service Fee version", async () => {
    const reader = await seedStaff("payments.read");
    const denied = await core.updateServiceFeeConfiguration({
      requestId: crypto.randomUUID(),
      headers: { cookie: reader.cookie },
      expectedVersion: 0,
      feeType: "MIXED",
      flatMinor: 1_500,
      percentageBasisPoints: 300,
      currency: "PHP",
      effectiveFrom: new Date(Date.now() + 60_000).toISOString(),
      reason: "Initial Instant fee",
      idempotencyKey: crypto.randomUUID(),
    });
    expect(denied).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });

    const manager = await seedStaff("payments.manage");
    const idempotencyKey = crypto.randomUUID();
    const request = {
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      expectedVersion: 0,
      feeType: "MIXED" as const,
      flatMinor: 1_500,
      percentageBasisPoints: 300,
      currency: "PHP",
      effectiveFrom: new Date(Date.now() + 120_000).toISOString(),
      reason: "Initial Instant fee",
      idempotencyKey,
    };
    const first = await core.updateServiceFeeConfiguration(request);
    expect(first).toMatchObject({ ok: true, value: { version: 1, feeType: "MIXED" } });
    expect(await core.updateServiceFeeConfiguration(request)).toEqual(first);
    const audit = await env.DB.prepare(
      "SELECT reason FROM audit_event WHERE action='SERVICE_FEE_CONFIGURATION.UPDATED' AND idempotency_key=?",
    )
      .bind(idempotencyKey)
      .first<{ reason: string }>();
    expect(audit?.reason).toBe("Initial Instant fee");
  });
});
