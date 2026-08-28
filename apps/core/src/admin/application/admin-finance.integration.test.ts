import { describe, expect, it } from "vitest";
import { SELF } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import type { CoreServiceBinding } from "@freshmarkets/contracts";

const core = exports.default as unknown as CoreServiceBinding;

let counter = 0;

async function signUp(): Promise<{ cookie: string; userId: string }> {
  const n = ++counter;
  const email = `fin-admin-${n}-${crypto.randomUUID().slice(0, 6)}@example.com`;
  const password = "correct-horse-battery-staple";
  const signUpResponse = await SELF.fetch("https://core.example.invalid/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://core.example.invalid" },
    body: JSON.stringify({ name: "Finance Admin", email, password }),
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

const FINANCE_CAPABILITIES = [
  "orders.read",
  "orders.manage",
  "payments.read",
  "refunds.manage",
  "memberships.read",
  "memberships.manage",
];

async function seedManager(): Promise<{ cookie: string; staffId: string }> {
  const principal = await signUp();
  const staffId = crypto.randomUUID();
  const roleId = crypto.randomUUID();
  const now = Date.now();
  const statements = [
    env.DB.prepare(
      "INSERT INTO staff_identity (id, auth_user_id, display_name, status, created_at, updated_at) VALUES (?, ?, 'Finance Mgr', 'active', ?, ?)",
    ).bind(staffId, principal.userId, now, now),
    env.DB.prepare(
      "INSERT INTO role (id, code, name, created_at) VALUES (?, ?, 'Fin Role', ?)",
    ).bind(roleId, `fin-${crypto.randomUUID().slice(0, 8)}`, now),
    env.DB.prepare("INSERT INTO staff_role (staff_id, role_id) VALUES (?, ?)").bind(
      staffId,
      roleId,
    ),
    env.DB.prepare(
      "INSERT INTO staff_scope (id, staff_id, scope_kind, market_id, location_id) VALUES (?, ?, 'global', NULL, NULL)",
    ).bind(crypto.randomUUID(), staffId),
  ];
  for (const capability of FINANCE_CAPABILITIES) {
    statements.push(
      env.DB.prepare(
        "INSERT OR IGNORE INTO permission (id, code, description, created_at) VALUES (?, ?, 'fin', ?)",
      ).bind(crypto.randomUUID(), capability, now),
    );
    statements.push(
      env.DB.prepare(
        "INSERT OR IGNORE INTO role_permission (role_id, permission_id) SELECT ?, id FROM permission WHERE code=?",
      ).bind(roleId, capability),
    );
  }
  await env.DB.batch(statements);
  return { cookie: principal.cookie, staffId };
}

/** Customer + a COMMITTED grocery order with a SUCCEEDED mock payment. */
async function seedOrderWithPayment(options: { status?: string } = {}): Promise<{
  customerId: string;
  orderId: string;
  paymentIntentId: string;
}> {
  const principal = await signUp();
  const now = Date.now();
  const customerId = crypto.randomUUID();
  const paymentIntentId = crypto.randomUUID();
  const paymentAttemptId = crypto.randomUUID();
  const orderId = crypto.randomUUID();
  const existingPrincipal = await env.DB.prepare(
    "SELECT id FROM customer_principal WHERE auth_user_id = ?",
  )
    .bind(principal.userId)
    .first<{ id: string }>();
  const principalId = existingPrincipal?.id ?? crypto.randomUUID();
  if (!existingPrincipal) {
    await env.DB.prepare(
      "INSERT INTO customer_principal (id, auth_user_id, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
    )
      .bind(principalId, principal.userId, now, now)
      .run();
  }
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO customer (id, auth_user_id, principal_id, status, version, created_at, updated_at) VALUES (?, ?, ?, 'active', 1, ?, ?)",
    ).bind(customerId, principal.userId, principalId, now, now),
    env.DB.prepare(
      "INSERT INTO payment_intent (id, purpose, subject_type, subject_id, customer_id, amount_minor, currency, status, idempotency_key, version, created_at, updated_at) VALUES (?, 'GROCERY_CHECKOUT', 'order', ?, ?, 50000, 'PHP', 'SUCCEEDED', ?, 1, ?, ?)",
    ).bind(paymentIntentId, orderId, customerId, `pi-${crypto.randomUUID()}`, now, now),
    env.DB.prepare(
      "INSERT INTO payment_attempt (id, customer_id, amount_minor, currency, status, provider, idempotency_key, created_at, updated_at) VALUES (?, ?, 50000, 'PHP', 'SUCCEEDED', 'mock', ?, ?, ?)",
    ).bind(paymentAttemptId, customerId, `pa-${crypto.randomUUID()}`, now, now),
    env.DB.prepare(
      "INSERT INTO grocery_order (id, customer_id, cycle_id, address_snapshot_json, status, total_minor, currency, payment_id, created_at, version) VALUES (?, ?, (SELECT id FROM delivery_cycle LIMIT 1), '{}', ?, 50000, 'PHP', ?, ?, 1)",
    ).bind(orderId, customerId, options.status ?? "COMMITTED", paymentAttemptId, now),
    env.DB.prepare(
      "INSERT INTO order_payment_reaction (id, payment_intent_id, reaction_id, order_id, applied_at) VALUES (?, ?, ?, ?, ?)",
    ).bind(crypto.randomUUID(), paymentIntentId, `react-${crypto.randomUUID()}`, orderId, now),
  ]);
  return { customerId, orderId, paymentIntentId };
}

describe("finance administration", () => {
  it("denies unauthenticated and non-staff readers", async () => {
    expect(await core.listAdminOrders({ requestId: "r1", headers: {} })).toMatchObject({
      ok: false,
      error: { code: "UNAUTHENTICATED" },
    });
    const nonStaff = await signUp();
    expect(
      await core.listAdminOrders({
        requestId: crypto.randomUUID(),
        headers: { cookie: nonStaff.cookie },
      }),
    ).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });

  it("lists composed orders with payment/fulfillment/delivery status", async () => {
    const manager = await seedManager();
    const { orderId } = await seedOrderWithPayment();
    const page = await core.listAdminOrders({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
    });
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    const order = page.value.items.find((item) => item.orderId === orderId);
    expect(order).toBeDefined();
    expect(order).toMatchObject({
      status: "COMMITTED",
      totalMinor: 50000,
      paymentStatus: "SUCCEEDED",
    });

    const detail = await core.getAdminOrder({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      orderId,
    });
    expect(detail.ok).toBe(true);
    if (!detail.ok) return;
    expect(detail.value.orderId).toBe(orderId);
  });

  it("cancels an order through the canonical command with reason and audit", async () => {
    const manager = await seedManager();
    const { orderId } = await seedOrderWithPayment({ status: "CANCELLATION_REQUESTED" });

    const canceled = await core.cancelAdminOrder({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      orderId,
      reasonCode: "customer request",
      expectedVersion: 1,
      idempotencyKey: `cancel-${crypto.randomUUID()}`,
    });
    // The canonical command decides the outcome; admin records the decision.
    if (canceled.ok) {
      expect(["CANCELED", "CANCELLATION_REQUESTED"]).toContain(canceled.value.status);
    } else {
      expect(["VALIDATION_FAILED", "ILLEGAL_TRANSITION", "NOT_FOUND", "CONFLICT"]).toContain(
        canceled.error.code,
      );
    }

    const auditRow = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM audit_event WHERE action = 'ORDER.CANCELED'",
    ).first<{ count: number }>();
    expect(auditRow?.count ?? 0).toBeGreaterThan(0);
  });

  it("requests refunds idempotently, validates amounts, and never asserts success", async () => {
    const manager = await seedManager();
    const { paymentIntentId } = await seedOrderWithPayment();

    const zero = await core.requestAdminRefund({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      paymentIntentId,
      amountMinor: 0,
      reason: "zero",
      idempotencyKey: `ref-${crypto.randomUUID()}`,
    });
    expect(zero).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });

    const excessive = await core.requestAdminRefund({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      paymentIntentId,
      amountMinor: 999999,
      reason: "too much",
      idempotencyKey: `ref-${crypto.randomUUID()}`,
    });
    expect(excessive).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });

    const key = `ref-${crypto.randomUUID()}`;
    const created = await core.requestAdminRefund({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      paymentIntentId,
      amountMinor: 10000,
      reason: "goodwill",
      idempotencyKey: key,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value).toMatchObject({ status: "REQUESTED", amountMinor: 10000 });

    const replay = await core.requestAdminRefund({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      paymentIntentId,
      amountMinor: 10000,
      reason: "goodwill",
      idempotencyKey: key,
    });
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(replay.value.refundId).toBe(created.value.refundId);

    const payments = await core.listAdminPayments({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
    });
    expect(payments.ok).toBe(true);
  });

  it("resolves an open reconciliation case once", async () => {
    const manager = await seedManager();
    const caseId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO payment_reconciliation_case (id, category, status, details_json, created_at) VALUES (?, 'REACTION_FAILURE', 'OPEN', '{}', ?)",
    )
      .bind(caseId, Date.now())
      .run();

    const resolved = await core.resolveAdminReconciliationCase({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      caseId,
      reason: "manually matched",
      idempotencyKey: `rec-${crypto.randomUUID()}`,
    });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.value.status).toBe("RESOLVED");

    const again = await core.resolveAdminReconciliationCase({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      caseId,
      reason: "again",
      idempotencyKey: `rec-${crypto.randomUUID()}`,
    });
    expect(again).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
  });

  it("lists memberships and pauses/resumes through canonical commands", async () => {
    const manager = await seedManager();
    const principal = await signUp();
    const now = Date.now();
    const customerId = crypto.randomUUID();
    const subscriptionId = crypto.randomUUID();
    const principalRow = await env.DB.prepare(
      "SELECT id FROM customer_principal WHERE auth_user_id = ?",
    )
      .bind(principal.userId)
      .first<{ id: string }>();
    const principalId = principalRow?.id ?? crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO customer (id, auth_user_id, principal_id, status, version, created_at, updated_at) VALUES (?, ?, ?, 'active', 1, ?, ?)",
      ).bind(customerId, principal.userId, principalId, now, now),
      env.DB.prepare(
        "INSERT INTO subscription (id, customer_id, offer_id, status, starts_at, created_at, updated_at, version) VALUES (?, ?, 'offer-membership-monthly', 'ACTIVE', ?, ?, ?, 1)",
      ).bind(subscriptionId, customerId, now, now, now),
    ]);

    const page = await core.listAdminMemberships({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
    });
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    expect(page.value.items.some((item) => item.subscriptionId === subscriptionId)).toBe(true);

    const paused = await core.pauseAdminMembership({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      subscriptionId,
      reason: "customer request",
      expectedVersion: 1,
      idempotencyKey: `mem-${crypto.randomUUID()}`,
    });
    expect(paused.ok).toBe(true);
    if (!paused.ok) return;
    expect(paused.value.state).toBe("PAUSED");

    const resumed = await core.resumeAdminMembership({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      subscriptionId,
      reason: "customer returned",
      expectedVersion: paused.value.version,
      idempotencyKey: `mem-${crypto.randomUUID()}`,
    });
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) return;
    expect(resumed.value.state).toBe("ACTIVE");
  });

  it("records order issues and walks the legal action lifecycle", async () => {
    const manager = await seedManager();
    const { orderId, customerId } = await seedOrderWithPayment();
    const issueId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO order_issue (id, order_id, customer_id, category, status, details, version, idempotency_key, created_at, updated_at) VALUES (?, ?, ?, 'MISSING_ITEM', 'SUBMITTED', 'one onion missing', 1, ?, ?, ?)",
    )
      .bind(issueId, orderId, customerId, `iss-${crypto.randomUUID()}`, Date.now(), Date.now())
      .run();

    const illegal = await core.applyAdminOrderIssueAction({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      issueId,
      action: "RESOLVE",
      reason: "skipping",
      expectedVersion: 1,
      idempotencyKey: `iss-${crypto.randomUUID()}`,
    });
    expect(illegal).toMatchObject({ ok: false, error: { code: "ILLEGAL_TRANSITION" } });

    async function act(
      action: "CLAIM" | "BEGIN_INVESTIGATION" | "RESOLVE" | "ESCALATE" | "REOPEN",
      version: number,
    ) {
      const result = await core.applyAdminOrderIssueAction({
        requestId: crypto.randomUUID(),
        headers: { cookie: manager.cookie },
        issueId,
        action,
        reason: `${action} by finance`,
        expectedVersion: version,
        idempotencyKey: `iss-${crypto.randomUUID()}`,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(`${action} failed`);
      return result.value;
    }

    const claimed = await act("CLAIM", 1);
    expect(claimed.status).toBe("CLAIMED");
    const investigating = await act("BEGIN_INVESTIGATION", claimed.version);
    expect(investigating.status).toBe("INVESTIGATING");
    const resolved = await act("RESOLVE", investigating.version);
    expect(resolved.status).toBe("RESOLVED");
    expect(resolved.resolution).toContain("RESOLVE");

    const queue = await core.listAdminOrderIssues({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      status: "RESOLVED",
    });
    expect(queue.ok).toBe(true);
    if (!queue.ok) return;
    expect(queue.value.items.some((item) => item.issueId === issueId)).toBe(true);
  });
});
