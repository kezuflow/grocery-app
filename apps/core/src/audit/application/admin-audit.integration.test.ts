import { describe, expect, it } from "vitest";
import { SELF } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import type { CoreServiceBinding } from "@freshmarkets/contracts";

const core = exports.default as unknown as CoreServiceBinding;

let counter = 0;

async function signUp(): Promise<{ cookie: string; userId: string }> {
  const n = ++counter;
  const email = `audit-${n}-${crypto.randomUUID().slice(0, 6)}@example.com`;
  const password = "correct-horse-battery-staple";
  const signUpResponse = await SELF.fetch("https://core.example.invalid/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://core.example.invalid" },
    body: JSON.stringify({ name: "Audit Reader", email, password }),
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
  scope: { kind: "global" } | { kind: "location"; locationId: string };
}): Promise<{ cookie: string; userId: string }> {
  const user = await signUp();
  const now = Date.now();
  const staffId = crypto.randomUUID();
  const roleId = crypto.randomUUID();
  const statements = [
    env.DB.prepare(
      "INSERT INTO staff_identity (id, auth_user_id, display_name, status, created_at, updated_at) VALUES (?, ?, 'Audit Reader', 'active', ?, ?)",
    ).bind(staffId, user.userId, now, now),
    env.DB.prepare("INSERT INTO role (id, code, name, created_at) VALUES (?, ?, 'Audit Role', ?)").bind(
      roleId,
      `audit-${crypto.randomUUID().slice(0, 8)}`,
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
        "INSERT OR IGNORE INTO permission (id, code, description, created_at) VALUES (?, ?, 'audit', ?)",
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

let auditCounter = 0;
async function insertAuditRow(options: {
  id?: string;
  occurredAt: number;
  locationId?: string | null;
  action?: string;
  details?: unknown;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
}): Promise<string> {
  const id = options.id ?? `audit-${++auditCounter}-${crypto.randomUUID().slice(0, 8)}`;
  await env.DB.prepare(
    "INSERT INTO audit_event (id, actor_user_id, action, aggregate_type, aggregate_id, details_json, before_json, after_json, reason, market_id, location_id, correlation_id, occurred_at) VALUES (?, NULL, ?, 'order', 'order-1', ?, ?, ?, ?, NULL, ?, 'corr-1', ?)",
  ).bind(
    id,
    options.action ?? "ORDER.ADJUSTED",
    JSON.stringify(options.details ?? {}),
    options.before === undefined ? null : JSON.stringify(options.before),
    options.after === undefined ? null : JSON.stringify(options.after),
    options.reason ?? null,
    options.locationId ?? null,
    options.occurredAt,
  ).run();
  return id;
}

describe("admin audit reads", () => {
  it("denies unauthenticated list and detail requests", async () => {
    expect(
      await core.listAdminAuditEvents({ requestId: "r1", headers: {} }),
    ).toMatchObject({ ok: false, error: { code: "UNAUTHENTICATED" } });
    expect(
      await core.getAdminAuditEvent({ requestId: "r2", headers: {}, auditEventId: "missing" }),
    ).toMatchObject({ ok: false, error: { code: "UNAUTHENTICATED" } });
  });

  it("requires the audit.read capability", async () => {
    const staff = await staffCookie({
      permissionCodes: ["orders.read"],
      scope: { kind: "location", locationId: "location-cebu-central" },
    });
    const headers = { cookie: staff.cookie };
    expect(
      await core.listAdminAuditEvents({ requestId: crypto.randomUUID(), headers }),
    ).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(
      await core.getAdminAuditEvent({
        requestId: crypto.randomUUID(),
        headers,
        auditEventId: "whatever",
      }),
    ).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });

  it("isolates location-scoped principals from other locations and global rows", async () => {
    const now = Date.now();
    const centralId = await insertAuditRow({ occurredAt: now - 1_000, locationId: "location-cebu-central" });
    await insertAuditRow({ occurredAt: now - 2_000, locationId: "location-other-empty" });
    await insertAuditRow({ occurredAt: now - 3_000 });

    const staff = await staffCookie({
      permissionCodes: ["audit.read"],
      scope: { kind: "location", locationId: "location-cebu-central" },
    });
    const page = await core.listAdminAuditEvents({
      requestId: crypto.randomUUID(),
      headers: { cookie: staff.cookie },
    });
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    expect(page.value.items.map((item) => item.auditEventId)).toEqual([centralId]);
    expect(page.value.nextCursor).toBeNull();

    const detail = await core.getAdminAuditEvent({
      requestId: crypto.randomUUID(),
      headers: { cookie: staff.cookie },
      auditEventId: centralId,
    });
    expect(detail.ok).toBe(true);

    const outOfScope = await core.getAdminAuditEvent({
      requestId: crypto.randomUUID(),
      headers: { cookie: staff.cookie },
      auditEventId: "audit-not-visible",
    });
    expect(outOfScope).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  });

  it("lets a global-scoped principal see global rows and returns descending order", async () => {
    const now = Date.now();
    await insertAuditRow({ occurredAt: now - 1_000, locationId: "location-cebu-central" });
    await insertAuditRow({ occurredAt: now - 2_000, locationId: "location-other-empty" });
    const globalId = await insertAuditRow({ occurredAt: now - 3_000 });

    const staff = await staffCookie({
      permissionCodes: ["audit.read"],
      scope: { kind: "global" },
    });
    const page = await core.listAdminAuditEvents({
      requestId: crypto.randomUUID(),
      headers: { cookie: staff.cookie },
    });
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    const ids = page.value.items.map((item) => item.auditEventId);
    expect(ids).toContain(globalId);
    const times = page.value.items.map((item) => new Date(item.occurredAt).getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it("paginates by descending (occurred_at, id) with an opaque cursor", async () => {
    const at = Date.now() - 10_000;
    await insertAuditRow({
      id: "ev-a",
      occurredAt: at,
      locationId: "location-cebu-central",
      action: "PAGINATION.PROBE",
    });
    await insertAuditRow({
      id: "ev-b",
      occurredAt: at,
      locationId: "location-cebu-central",
      action: "PAGINATION.PROBE",
    });

    const staff = await staffCookie({
      permissionCodes: ["audit.read"],
      scope: { kind: "location", locationId: "location-cebu-central" },
    });
    const headers = { cookie: staff.cookie };
    const firstPage = await core.listAdminAuditEvents({
      requestId: crypto.randomUUID(),
      headers,
      action: "PAGINATION.PROBE",
      limit: 1,
    });
    expect(firstPage.ok).toBe(true);
    if (!firstPage.ok) return;
    expect(firstPage.value.items.map((item) => item.auditEventId)).toEqual(["ev-b"]);
    expect(firstPage.value.nextCursor).toBeTruthy();

    const secondPage = await core.listAdminAuditEvents({
      requestId: crypto.randomUUID(),
      headers,
      action: "PAGINATION.PROBE",
      limit: 1,
      cursor: firstPage.value.nextCursor!,
    });
    expect(secondPage.ok).toBe(true);
    if (!secondPage.ok) return;
    expect(secondPage.value.items.map((item) => item.auditEventId)).toEqual(["ev-a"]);
    expect(secondPage.value.nextCursor).toBeNull();

    const malformed = await core.listAdminAuditEvents({
      requestId: crypto.randomUUID(),
      headers,
      cursor: "not-a-cursor",
    });
    expect(malformed).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
  });

  it("returns sanitized detail with redacted secrets and visible safe values", async () => {
    const eventId = await insertAuditRow({
      occurredAt: Date.now() - 5_000,
      locationId: "location-cebu-central",
      details: {
        password: "hunter2",
        authorization: "Bearer secret-token",
        accessToken: "leaky",
        reasonCode: "STOCK_ADJUSTMENT",
        nested: { token: "nested-secret", safe: 1 },
      },
      before: { totalMinor: 100 },
      after: { totalMinor: 90 },
      reason: "inventory correction",
    });

    const staff = await staffCookie({
      permissionCodes: ["audit.read"],
      scope: { kind: "location", locationId: "location-cebu-central" },
    });
    const detail = await core.getAdminAuditEvent({
      requestId: crypto.randomUUID(),
      headers: { cookie: staff.cookie },
      auditEventId: eventId,
    });
    expect(detail.ok).toBe(true);
    if (!detail.ok) return;
    expect(detail.value.metadata).toEqual({
      password: "[REDACTED]",
      authorization: "[REDACTED]",
      accessToken: "[REDACTED]",
      reasonCode: "STOCK_ADJUSTMENT",
      nested: { token: "[REDACTED]", safe: 1 },
    });
    expect(detail.value.before).toEqual({ totalMinor: 100 });
    expect(detail.value.after).toEqual({ totalMinor: 90 });
    expect(detail.value.reason).toBe("inventory correction");
    expect(detail.value.correlationId).toBe("corr-1");

    const listPage = await core.listAdminAuditEvents({
      requestId: crypto.randomUUID(),
      headers: { cookie: staff.cookie },
    });
    expect(listPage.ok).toBe(true);
    if (!listPage.ok) return;
    for (const item of listPage.value.items) {
      expect(item).not.toHaveProperty("metadata");
      expect(item).not.toHaveProperty("before");
      expect(item).not.toHaveProperty("after");
    }
  });
});
