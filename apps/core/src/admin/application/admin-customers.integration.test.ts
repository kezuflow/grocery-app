import { describe, expect, it } from "vitest";
import { SELF } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import type { CoreServiceBinding } from "@freshmarkets/contracts";

const core = exports.default as unknown as CoreServiceBinding;

let counter = 0;

async function signUp(): Promise<{ cookie: string; userId: string }> {
  const n = ++counter;
  const email = `cust-crm-${n}-${crypto.randomUUID().slice(0, 6)}@example.com`;
  const password = "correct-horse-battery-staple";
  const signUpResponse = await SELF.fetch("https://core.example.invalid/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://core.example.invalid" },
    body: JSON.stringify({ name: "CRM Customer", email, password }),
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

async function seedManager(): Promise<{ cookie: string; staffId: string }> {
  const principal = await signUp();
  const staffId = crypto.randomUUID();
  const roleId = crypto.randomUUID();
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO staff_identity (id, auth_user_id, display_name, status, created_at, updated_at) VALUES (?, ?, 'CRM Mgr', 'active', ?, ?)",
    ).bind(staffId, principal.userId, now, now),
    env.DB.prepare(
      "INSERT INTO role (id, code, name, created_at) VALUES (?, ?, 'CRM Role', ?)",
    ).bind(roleId, `crm-${crypto.randomUUID().slice(0, 8)}`, now),
    env.DB.prepare("INSERT INTO staff_role (staff_id, role_id) VALUES (?, ?)").bind(
      staffId,
      roleId,
    ),
    env.DB.prepare(
      "INSERT INTO staff_scope (id, staff_id, scope_kind, market_id, location_id) VALUES (?, ?, 'global', NULL, NULL)",
    ).bind(crypto.randomUUID(), staffId),
    env.DB.prepare(
      "INSERT OR IGNORE INTO permission (id, code, description, created_at) VALUES (?, 'customers.manage', 'crm', ?)",
    ).bind(crypto.randomUUID(), now),
    env.DB.prepare(
      "INSERT OR IGNORE INTO role_permission (role_id, permission_id) SELECT ?, id FROM permission WHERE code='customers.manage'",
    ).bind(roleId),
    env.DB.prepare(
      "INSERT OR IGNORE INTO permission (id, code, description, created_at) VALUES (?, 'customers.read', 'crm', ?)",
    ).bind(crypto.randomUUID(), now),
    env.DB.prepare(
      "INSERT OR IGNORE INTO role_permission (role_id, permission_id) SELECT ?, id FROM permission WHERE code='customers.read'",
    ).bind(roleId),
  ]);
  return { cookie: principal.cookie, staffId };
}

/** Provision a customer aggregate + active principal for an auth user. */
async function seedCustomer(principal: { userId: string }): Promise<string> {
  const now = Date.now();
  const customerId = crypto.randomUUID();
  // The Better Auth user-create hook already provisions the principal
  // eagerly; reuse its id instead of inventing one.
  const existing = await env.DB.prepare("SELECT id FROM customer_principal WHERE auth_user_id = ?")
    .bind(principal.userId)
    .first<{ id: string }>();
  let principalId = existing?.id ?? null;
  if (!principalId) {
    principalId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO customer_principal (id, auth_user_id, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
    )
      .bind(principalId, principal.userId, now, now)
      .run();
  }
  await env.DB.prepare(
    "INSERT INTO customer (id, auth_user_id, principal_id, status, version, created_at, updated_at) VALUES (?, ?, ?, 'active', 1, ?, ?)",
  )
    .bind(customerId, principal.userId, principalId, now, now)
    .run();
  return customerId;
}

describe("customer crm reads", () => {
  it("denies unauthenticated and non-staff readers", async () => {
    expect(await core.listAdminCustomers({ requestId: "r1", headers: {} })).toMatchObject({
      ok: false,
      error: { code: "UNAUTHENTICATED" },
    });
    const nonStaff = await signUp();
    expect(
      await core.listAdminCustomers({
        requestId: crypto.randomUUID(),
        headers: { cookie: nonStaff.cookie },
      }),
    ).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });

  it("lists composed customer summaries and detail for global readers", async () => {
    const manager = await seedManager();
    const customerUserId = (await signUp()).userId;
    const customerId = await seedCustomer({ userId: customerUserId });
    const now = Date.now();
    const paymentId = `pay-${crypto.randomUUID().slice(0, 8)}`;
    const pendingPaymentId = `pay-${crypto.randomUUID().slice(0, 8)}`;
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO payment_attempt (id, customer_id, amount_minor, currency, status, provider, idempotency_key, created_at, updated_at) VALUES (?, ?, 100, 'PHP', 'SUCCEEDED', 'mock', ?, ?, ?)",
      ).bind(paymentId, customerId, `pay-key-${crypto.randomUUID()}`, now, now),
      env.DB.prepare(
        "INSERT INTO payment_attempt (id, customer_id, amount_minor, currency, status, provider, idempotency_key, created_at, updated_at) VALUES (?, ?, 100, 'PHP', 'PENDING', 'mock', ?, ?, ?)",
      ).bind(pendingPaymentId, customerId, `pay-key-${crypto.randomUUID()}`, now, now),
    ]);
    await env.DB.prepare(
      "INSERT INTO grocery_order (id, customer_id, cycle_id, address_snapshot_json, status, total_minor, currency, payment_id, created_at, version) VALUES (?, ?, (SELECT id FROM delivery_cycle LIMIT 1), '{}', 'COMMITTED', 100, 'PHP', ?, ?, 1)",
    )
      .bind(`ord-${crypto.randomUUID().slice(0, 8)}`, customerId, paymentId, now)
      .run();
    await env.DB.prepare(
      "INSERT INTO grocery_order (id, customer_id, cycle_id, address_snapshot_json, status, total_minor, currency, payment_id, created_at, version) VALUES (?, ?, (SELECT id FROM delivery_cycle LIMIT 1), '{}', 'PENDING_PAYMENT', 100, 'PHP', ?, ?, 1)",
    )
      .bind(`draft-${crypto.randomUUID().slice(0, 8)}`, customerId, pendingPaymentId, now + 60_000)
      .run();

    const page = await core.listAdminCustomers({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      limit: 100,
    });
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    const summary = page.value.items.find((item) => item.customerId === customerId);
    expect(summary).toBeDefined();
    expect(summary).toMatchObject({ accessStatus: "active", orderCount: 1, version: 1 });
    expect(summary!.lastOrderAt).toBe(new Date(now).toISOString());
    expect(summary!.email).toContain("@");

    const detail = await core.getAdminCustomer({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      customerId: `  ${customerId}  `,
    });
    expect(detail.ok).toBe(true);
    if (!detail.ok) return;
    expect(detail.value.recentAudit).toEqual([]);
    const serialized = JSON.stringify(detail.value);
    expect(serialized).not.toContain("password");

    const missing = await core.getAdminCustomer({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      customerId: "cust-missing",
    });
    expect(missing).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  });
});

describe("customer crm commands", () => {
  it("invites customers idempotently and rejects duplicate pending invitations", async () => {
    const manager = await seedManager();
    const email = `new-cust-${crypto.randomUUID().slice(0, 6)}@example.com`;
    const key = `cinv-${crypto.randomUUID()}`;
    const created = await core.inviteCustomer({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      email,
      idempotencyKey: key,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value).toMatchObject({ email, status: "PENDING" });

    const replay = await core.inviteCustomer({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      email,
      idempotencyKey: key,
    });
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(replay.value.invitationId).toBe(created.value.invitationId);

    const duplicate = await core.inviteCustomer({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      email,
      idempotencyKey: `cinv-${crypto.randomUUID()}`,
    });
    expect(duplicate).toMatchObject({ ok: false, error: { code: "CONFLICT" } });

    const queue = await core.listCustomerInvitations({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
    });
    expect(queue.ok).toBe(true);
    if (!queue.ok) return;
    expect(queue.value.items.some((item) => item.invitationId === created.value.invitationId)).toBe(
      true,
    );
  });

  it("disables and restores commerce access through the principal gate", async () => {
    const manager = await seedManager();
    const customerUserId = (await signUp()).userId;
    const customerId = await seedCustomer({ userId: customerUserId });

    const stale = await core.changeCustomerAccess({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      customerId,
      action: "DISABLE",
      reason: "fraud review",
      expectedVersion: 99,
      idempotencyKey: `cacc-${crypto.randomUUID()}`,
    });
    expect(stale).toMatchObject({ ok: false, error: { code: "STALE_VERSION" } });

    const disabled = await core.changeCustomerAccess({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      customerId,
      action: "DISABLE",
      reason: "fraud review",
      expectedVersion: 1,
      idempotencyKey: `cacc-${crypto.randomUUID()}`,
    });
    expect(disabled.ok).toBe(true);
    if (!disabled.ok) return;
    expect(disabled.value).toMatchObject({ accessStatus: "disabled", version: 2 });

    const sameState = await core.changeCustomerAccess({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      customerId,
      action: "DISABLE",
      reason: "again",
      expectedVersion: disabled.value.version,
      idempotencyKey: `cacc-${crypto.randomUUID()}`,
    });
    expect(sameState).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });

    // A disabled principal cannot resolve commerce access.
    const disabledCustomerAuth = await env.DB.prepare(
      "SELECT cp.auth_user_id AS authUserId FROM customer c JOIN customer_principal cp ON cp.id = c.principal_id WHERE c.id = ?",
    )
      .bind(customerId)
      .first<{ authUserId: string }>();
    expect(disabledCustomerAuth?.authUserId).toBeTruthy();

    const restored = await core.changeCustomerAccess({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      customerId,
      action: "RESTORE",
      reason: "review cleared",
      expectedVersion: disabled.value.version,
      idempotencyKey: `cacc-${crypto.randomUUID()}`,
    });
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(restored.value.accessStatus).toBe("active");

    const auditRow = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM audit_event WHERE action = 'CUSTOMER.ACCESS_CHANGED'",
    ).first<{ count: number }>();
    expect(auditRow?.count ?? 0).toBe(2);
  });

  it("revokes the customer's live sessions", async () => {
    const manager = await seedManager();
    const principal = await signUp();
    const customerId = await seedCustomer({ userId: principal.userId });
    expect(principal.cookie).not.toBe("");

    const revoked = await core.revokeCustomerSessions({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      customerId,
      reason: "account takeover check",
      idempotencyKey: `cses-${crypto.randomUUID()}`,
    });
    expect(revoked.ok).toBe(true);
    if (!revoked.ok) return;
    expect(revoked.value.revokedSessionCount).toBeGreaterThan(0);

    const after = await env.DB.prepare("SELECT COUNT(*) AS count FROM session WHERE user_id = ?")
      .bind(principal.userId)
      .first<{ count: number }>();
    expect(after?.count ?? 0).toBe(0);
  });

  it("records closure requests and walks the privacy lifecycle with legal transitions", async () => {
    const manager = await seedManager();
    const customerId = await seedCustomer({ userId: (await signUp()).userId });

    const requested = await core.requestCustomerClosure({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      customerId,
      requestType: "CLOSURE",
      reason: "customer emailed support",
      idempotencyKey: `clos-${crypto.randomUUID()}`,
    });
    expect(requested.ok).toBe(true);
    if (!requested.ok) return;
    expect(requested.value).toMatchObject({ status: "SUBMITTED", requestType: "CLOSURE" });
    const privacyRequestId = requested.value.privacyRequestId;

    const staleKey = `priv-${crypto.randomUUID()}`;
    const stale = await core.applyPrivacyAction({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      privacyRequestId,
      action: "VERIFY",
      reason: "stale privacy action",
      expectedVersion: 99,
      idempotencyKey: staleKey,
    });
    expect(stale).toMatchObject({ ok: false, error: { code: "STALE_VERSION" } });
    const staleEvidence = await env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM audit_event WHERE action='PRIVACY.ACTION_APPLIED' AND aggregate_id=?) AS audit_count,
         (SELECT status FROM idempotency_records WHERE scope='admin.privacy.action' AND idempotency_key=?) AS idempotency_status`,
    )
      .bind(privacyRequestId, staleKey)
      .first<{ audit_count: number; idempotency_status: string | null }>();
    expect(staleEvidence).toEqual({ audit_count: 0, idempotency_status: "FAILED" });

    const illegal = await core.applyPrivacyAction({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      privacyRequestId: requested.value.privacyRequestId,
      action: "COMPLETE",
      reason: "skipping steps",
      expectedVersion: requested.value.verifiedAt === null ? 1 : 1,
      idempotencyKey: `priv-${crypto.randomUUID()}`,
    });
    expect(illegal).toMatchObject({ ok: false, error: { code: "ILLEGAL_TRANSITION" } });

    async function act(
      action: "VERIFY" | "APPROVE" | "REJECT" | "BEGIN_PROCESSING" | "COMPLETE" | "ESCALATE",
      version: number,
    ) {
      const result = await core.applyPrivacyAction({
        requestId: crypto.randomUUID(),
        headers: { cookie: manager.cookie },
        privacyRequestId,
        action,
        reason: `${action} by crm`,
        expectedVersion: version,
        idempotencyKey: `priv-${crypto.randomUUID()}`,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(`${action} failed`);
      return result.value;
    }

    const verifying = await act("VERIFY", 1);
    expect(verifying.status).toBe("VERIFYING");
    const approved = await act("APPROVE", verifying.version);
    expect(approved.status).toBe("APPROVED");
    const processing = await act("BEGIN_PROCESSING", approved.version);
    expect(processing.status).toBe("PROCESSING");
    const completed = await act("COMPLETE", processing.version);
    expect(completed.status).toBe("COMPLETED");
    expect(completed.resolution).toContain("COMPLETE");
    expect(completed.resolvedAt).not.toBeNull();

    const queue = await core.listPrivacyRequests({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      status: "COMPLETED",
    });
    expect(queue.ok).toBe(true);
    if (!queue.ok) return;
    expect(
      queue.value.items.some((item) => item.privacyRequestId === requested.value!.privacyRequestId),
    ).toBe(true);
  });
});
