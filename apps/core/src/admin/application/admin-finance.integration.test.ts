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

async function seedManager(
  capabilities: readonly string[] = FINANCE_CAPABILITIES,
  scope: "global" | "location" = "global",
): Promise<{ cookie: string; staffId: string }> {
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
      "INSERT INTO staff_scope (id, staff_id, scope_kind, market_id, location_id) VALUES (?, ?, ?, NULL, ?)",
    ).bind(
      crypto.randomUUID(),
      staffId,
      scope,
      scope === "location" ? "location-cebu-central" : null,
    ),
  ];
  for (const capability of capabilities) {
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
    expect(detail.value.allowedActions).toEqual(["CANCEL"]);

    await env.DB.prepare("UPDATE grocery_order SET status='DELIVERED' WHERE id=?")
      .bind(orderId)
      .run();
    const terminalDetail = await core.getAdminOrder({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      orderId,
    });
    expect(terminalDetail.ok).toBe(true);
    if (terminalDetail.ok) expect(terminalDetail.value.allowedActions).toEqual([]);
  });

  it("derives order actions from both lifecycle state and the caller's capabilities", async () => {
    const reader = await seedManager(["orders.read"]);
    const { orderId } = await seedOrderWithPayment();

    const detail = await core.getAdminOrder({
      requestId: crypto.randomUUID(),
      headers: { cookie: reader.cookie },
      orderId,
    });

    expect(detail.ok).toBe(true);
    if (detail.ok) expect(detail.value.allowedActions).toEqual([]);
  });

  it("requires global finance scope and derives payment actions from refund capability", async () => {
    const scopedReader = await seedManager(["payments.read", "refunds.manage"], "location");
    const globalReader = await seedManager(["payments.read"]);
    const { paymentIntentId } = await seedOrderWithPayment();

    expect(
      await core.getAdminPaymentOverview({
        requestId: crypto.randomUUID(),
        headers: { cookie: scopedReader.cookie },
      }),
    ).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });

    const detail = await core.getAdminPayment({
      requestId: crypto.randomUUID(),
      headers: { cookie: globalReader.cookie },
      paymentIntentId,
    });
    expect(detail.ok).toBe(true);
    if (detail.ok) expect(detail.value.allowedActions).toEqual([]);
  });

  it("composes immutable order finance, operations, exceptions, and timeline projections", async () => {
    const manager = await seedManager();
    const { customerId, orderId, paymentIntentId } = await seedOrderWithPayment();
    const now = Date.now();
    const quoteId = crypto.randomUUID();
    const addressId = crypto.randomUUID();
    const cartId = crypto.randomUUID();
    const amendmentId = crypto.randomUUID();
    const reactionId = (await env.DB.prepare(
      "SELECT reaction_id AS id FROM order_payment_reaction WHERE order_id=?",
    )
      .bind(orderId)
      .first<{ id: string }>())!.id;

    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO customer_address (id, customer_id, label, recipient, phone, address_json, latitude, longitude, status, version, created_at, updated_at) VALUES (?, ?, 'Home', 'Customer', '09170000000', '{}', 10.3, 123.9, 'active', 1, ?, ?)",
      ).bind(addressId, customerId, now, now),
      env.DB.prepare(
        "INSERT INTO cart (id, customer_id, location_id, status, version, created_at, updated_at) VALUES (?, ?, 'location-cebu-central', 'CHECKED_OUT', 1, ?, ?)",
      ).bind(cartId, customerId, now, now),
      env.DB.prepare(
        `INSERT INTO checkout_quote
          (id, attempt_id, customer_id, cart_id, address_id, delivery_cycle_id, fulfillment_mode,
           currency, subtotal_minor, discount_minor, delivery_fee_minor, total_minor, lines_json,
           status, version, expires_at, idempotency_key, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'cycle-next-cebu', 'SCHEDULED', 'PHP', 48000, 1000, 3000,
                 50000, '[]', 'CONSUMED', 1, ?, ?, ?, ?)`,
      ).bind(
        quoteId,
        `attempt-${crypto.randomUUID()}`,
        customerId,
        cartId,
        addressId,
        now,
        `quote-${crypto.randomUUID()}`,
        now,
        now,
      ),
      env.DB.prepare(
        "UPDATE payment_intent SET subject_type='checkout_quote', subject_id=? WHERE id=?",
      ).bind(quoteId, paymentIntentId),
      env.DB.prepare(
        "UPDATE payment_attempt SET payment_intent_id=?, provider_reference='provider-secret' WHERE customer_id=?",
      ).bind(paymentIntentId, customerId),
      env.DB.prepare(
        "INSERT INTO order_item (id, order_id, sku_id, product_name_snapshot, variant_name_snapshot, unit_snapshot, quantity, unit_price_minor, line_total_minor, base_quantity) VALUES (?, ?, 'sku-red-onion-500g', 'Red Onion', '500 g', 'GRAM', 2, 12000, 24000, 1000)",
      ).bind(crypto.randomUUID(), orderId),
      env.DB.prepare(
        "INSERT INTO order_fulfillment_snapshot (order_id, location_id, cycle_id, zone_id, cutoff_at, delivery_date, promised_at, fulfillment_mode, sourcing_modes_json, created_at) VALUES (?, 'location-cebu-central', 'cycle-next-cebu', 'zone-cebu', ?, ?, ?, 'SCHEDULED', '[\"PLANNED\"]', ?)",
      ).bind(orderId, now + 3600000, now + 86400000, now + 90000000, now),
      env.DB.prepare(
        "INSERT INTO fulfillment_record (id, order_id, location_id, status, updated_at, version) VALUES (?, ?, 'location-cebu-central', 'PICKING', ?, 2)",
      ).bind(crypto.randomUUID(), orderId, now),
      env.DB.prepare(
        "INSERT INTO delivery_job (id, order_id, cycle_id, fulfillment_mode, location_id, zone_id, rider_user_id, status, address_snapshot_json, delivered_at, version, created_at, updated_at) VALUES (?, ?, 'cycle-next-cebu', 'SCHEDULED', 'location-cebu-central', 'zone-cebu-city-core', 'rider-1', 'ASSIGNED', '{}', NULL, 3, ?, ?)",
      ).bind(crypto.randomUUID(), orderId, now, now),
      env.DB.prepare(
        "INSERT INTO paid_order_amendment (id, order_id, status, currency, total_minor, payment_intent_id, idempotency_key, created_at, updated_at) VALUES (?, ?, 'COMMITTED', 'PHP', 5000, ?, ?, ?, ?)",
      ).bind(amendmentId, orderId, paymentIntentId, `amend-${crypto.randomUUID()}`, now, now),
      env.DB.prepare(
        "INSERT INTO paid_order_amendment_line (id, amendment_id, sku_id, product_name_snapshot, variant_name_snapshot, unit_snapshot, quantity, base_quantity, unit_price_minor, line_total_minor, created_at) VALUES (?, ?, 'sku-red-onion-500g', 'Red Onion', '500 g', 'GRAM', 1, 500, 5000, 5000, ?)",
      ).bind(crypto.randomUUID(), amendmentId, now),
      env.DB.prepare(
        "INSERT INTO finance_exception (id, kind, payment_intent_id, reaction_id, order_id, details_json, attempts, last_error_code, status, created_at) VALUES (?, 'TRANSIENT_FAILURE', ?, ?, ?, '{}', 1, 'TIMEOUT', 'OPEN', ?)",
      ).bind(crypto.randomUUID(), paymentIntentId, reactionId, orderId, now),
      env.DB.prepare(
        "INSERT INTO payment_reaction (id, payment_intent_id, reaction_type, subject_type, subject_id, status, idempotency_key, attempts, available_at, created_at, updated_at) VALUES (?, ?, 'COMMIT_ORDER', 'checkout_quote', ?, 'SUCCEEDED', ?, 1, ?, ?, ?)",
      ).bind(
        reactionId,
        paymentIntentId,
        quoteId,
        `reaction-${crypto.randomUUID()}`,
        now,
        now,
        now,
      ),
    ]);

    const detail = await core.getAdminOrder({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      orderId,
    });
    expect(detail.ok).toBe(true);
    if (!detail.ok) return;
    expect(detail.value.financial).toMatchObject({
      source: "CHECKOUT_QUOTE",
      subtotalMinor: 48000,
      discountMinor: 1000,
      deliveryFeeMinor: 3000,
    });
    expect(detail.value.items[0]).toMatchObject({
      productName: "Red Onion",
      variantName: "500 g",
      unit: "GRAM",
      baseQuantity: 1000,
    });
    expect(detail.value.payments).toHaveLength(1);
    expect(detail.value.amendments[0]?.lines).toHaveLength(1);
    expect(detail.value.fulfillment).toMatchObject({ status: "PICKING", version: 2 });
    expect(detail.value.delivery).toMatchObject({ status: "ASSIGNED", version: 3 });
    expect(detail.value.exceptions).toEqual([
      expect.objectContaining({ source: "FINANCE", kind: "TRANSIENT_FAILURE" }),
    ]);
    expect(detail.value.timeline.length).toBeGreaterThanOrEqual(5);
  });

  it("composes payment overview and detail without leaking provider identifiers or payload hashes", async () => {
    const manager = await seedManager();
    const { customerId, paymentIntentId } = await seedOrderWithPayment();
    const now = Date.now();
    const attempt = await env.DB.prepare("SELECT id FROM payment_attempt WHERE customer_id=?")
      .bind(customerId)
      .first<{ id: string }>();
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE payment_attempt SET payment_intent_id=?, provider_reference='provider-secret' WHERE id=?",
      ).bind(paymentIntentId, attempt!.id),
      env.DB.prepare(
        "INSERT INTO payment_events (id, provider, provider_event_id, provider_reference, event_type, payload_hash, received_at, processed_at, processing_status) VALUES (?, 'mock', 'event-secret', 'provider-secret', 'payment.succeeded', 'hash-secret', ?, ?, 'PROCESSED')",
      ).bind(crypto.randomUUID(), now, now),
      env.DB.prepare(
        "INSERT INTO payment_refund (id, payment_intent_id, amount_minor, currency, status, reason, idempotency_key, version, created_at, updated_at) VALUES (?, ?, 10000, 'PHP', 'SUCCEEDED', 'quality issue', ?, 1, ?, ?)",
      ).bind(crypto.randomUUID(), paymentIntentId, `refund-${crypto.randomUUID()}`, now, now),
      env.DB.prepare(
        "INSERT INTO payment_reconciliation_case (id, payment_intent_id, category, status, details_json, created_at) VALUES (?, ?, 'AMBIGUOUS_OUTCOME', 'OPEN', '{\"providerReference\":\"must-not-leak\"}', ?)",
      ).bind(crypto.randomUUID(), paymentIntentId, now),
    ]);

    const overview = await core.getAdminPaymentOverview({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
    });
    expect(overview.ok).toBe(true);
    if (overview.ok) {
      expect(overview.value.intentCounts.total).toBeGreaterThan(0);
      expect(overview.value.openReconciliationCount).toBeGreaterThan(0);
      expect(overview.value.totalsByCurrency).toEqual(
        expect.arrayContaining([expect.objectContaining({ currency: "PHP" })]),
      );
    }

    const detail = await core.getAdminPayment({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      paymentIntentId,
    });
    expect(detail.ok).toBe(true);
    if (!detail.ok) return;
    expect(detail.value.remainingRefundableMinor).toBe(40000);
    expect(detail.value.allowedActions).toEqual(["REQUEST_REFUND"]);
    expect(detail.value.attempts).toHaveLength(1);
    expect(detail.value.events).toEqual([
      expect.objectContaining({ eventType: "payment.succeeded", processingStatus: "PROCESSED" }),
    ]);
    expect(detail.value.reconciliationCases[0]).not.toHaveProperty("details");
    expect(JSON.stringify(detail.value)).not.toContain("provider-secret");
    expect(JSON.stringify(detail.value)).not.toContain("hash-secret");
    expect(JSON.stringify(detail.value)).not.toContain("event-secret");
  });

  it("cancels an order through the canonical command with reason and audit", async () => {
    const manager = await seedManager();
    const { orderId } = await seedOrderWithPayment({ status: "COMMITTED" });

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

  it("preserves the canonical illegal-transition error for terminal order cancellation", async () => {
    const manager = await seedManager();
    const { orderId } = await seedOrderWithPayment({ status: "DELIVERED" });
    const result = await core.cancelAdminOrder({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      orderId,
      reason: "terminal order",
      expectedVersion: 1,
      idempotencyKey: `cancel-${crypto.randomUUID()}`,
    });
    expect(result).toMatchObject({ ok: false, error: { code: "ILLEGAL_TRANSITION" } });
  });

  it("rejects a cancellation idempotency key reused for another order without false audit", async () => {
    const manager = await seedManager();
    const first = await seedOrderWithPayment();
    const second = await seedOrderWithPayment();
    const idempotencyKey = `cancel-${crypto.randomUUID()}`;

    const initial = await core.cancelAdminOrder({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      orderId: first.orderId,
      reasonCode: "customer request",
      expectedVersion: 1,
      idempotencyKey,
    });
    expect(initial.ok).toBe(true);

    const reused = await core.cancelAdminOrder({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      orderId: second.orderId,
      reasonCode: "different customer request",
      expectedVersion: 1,
      idempotencyKey,
    });
    expect(reused).toMatchObject({ ok: false, error: { code: "IDEMPOTENCY_CONFLICT" } });

    const secondOrder = await env.DB.prepare("SELECT status, version FROM grocery_order WHERE id=?")
      .bind(second.orderId)
      .first<{ status: string; version: number }>();
    expect(secondOrder).toEqual({ status: "COMMITTED", version: 1 });

    const falseAudit = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM audit_event WHERE action='ORDER.CANCELED' AND aggregate_id=?",
    )
      .bind(second.orderId)
      .first<{ count: number }>();
    expect(falseAudit?.count).toBe(0);
  });

  it("rolls back an Admin order cancellation when required audit evidence fails", async () => {
    const manager = await seedManager();
    const { orderId } = await seedOrderWithPayment();
    await env.DB.prepare(
      `CREATE TRIGGER fail_order_cancel_audit BEFORE INSERT ON audit_event
       WHEN NEW.action='ORDER.CANCELED'
       BEGIN SELECT RAISE(ABORT, 'forced audit failure'); END`,
    ).run();

    const result = await core.cancelAdminOrder({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      orderId,
      reasonCode: "atomic cancellation",
      expectedVersion: 1,
      idempotencyKey: `cancel-${crypto.randomUUID()}`,
    });
    expect(result.ok).toBe(false);

    const order = await env.DB.prepare("SELECT status, version FROM grocery_order WHERE id=?")
      .bind(orderId)
      .first<{ status: string; version: number }>();
    expect(order).toEqual({ status: "COMMITTED", version: 1 });
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

  it("reserves pending refunds in detail actions and records one winner under a refund race", async () => {
    const manager = await seedManager();
    const { paymentIntentId } = await seedOrderWithPayment();
    const firstKey = `ref-${crypto.randomUUID()}`;
    const secondKey = `ref-${crypto.randomUUID()}`;

    const [first, second] = await Promise.all([
      core.requestAdminRefund({
        requestId: crypto.randomUUID(),
        headers: { cookie: manager.cookie },
        paymentIntentId,
        amountMinor: 50000,
        reason: "first concurrent request",
        idempotencyKey: firstKey,
      }),
      core.requestAdminRefund({
        requestId: crypto.randomUUID(),
        headers: { cookie: manager.cookie },
        paymentIntentId,
        amountMinor: 50000,
        reason: "second concurrent request",
        idempotencyKey: secondKey,
      }),
    ]);

    expect([first, second].filter((result) => result.ok)).toHaveLength(1);
    const detail = await core.getAdminPayment({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      paymentIntentId,
    });
    expect(detail).toMatchObject({
      ok: true,
      value: { remainingRefundableMinor: 0, allowedActions: [] },
    });
    const audit = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM audit_event WHERE action='PAYMENT.REFUND_REQUESTED' AND json_extract(details_json, '$.paymentIntentId')=?",
    )
      .bind(paymentIntentId)
      .first<{ count: number }>();
    expect(audit?.count).toBe(1);
    const claims = await env.DB.prepare(
      "SELECT status, result_reference AS resultReference FROM idempotency_records WHERE scope='admin.payments.refund' AND idempotency_key IN (?, ?) ORDER BY idempotency_key",
    )
      .bind(firstKey, secondKey)
      .all<{ status: string; resultReference: string | null }>();
    expect(claims.results.filter((claim) => claim.status === "SUCCEEDED")).toHaveLength(1);
    expect(claims.results.filter((claim) => claim.status === "PROCESSING")).toHaveLength(0);
    expect(
      claims.results.find((claim) => claim.status === "SUCCEEDED")?.resultReference,
    ).toBeTruthy();
  });

  it("reserves an approved refund before accepting another request", async () => {
    const manager = await seedManager();
    const { paymentIntentId } = await seedOrderWithPayment();
    const now = Date.now();
    await env.DB.prepare(
      "INSERT INTO payment_refund (id, payment_intent_id, amount_minor, currency, status, reason, idempotency_key, version, created_at, updated_at) VALUES (?, ?, 50000, 'PHP', 'APPROVED', 'provider approved', ?, 1, ?, ?)",
    )
      .bind(crypto.randomUUID(), paymentIntentId, `approved-${crypto.randomUUID()}`, now, now)
      .run();

    const detail = await core.getAdminPayment({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      paymentIntentId,
    });
    expect(detail).toMatchObject({
      ok: true,
      value: { remainingRefundableMinor: 0, allowedActions: [] },
    });
    const request = await core.requestAdminRefund({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      paymentIntentId,
      amountMinor: 1,
      reason: "must not over-reserve",
      idempotencyKey: `ref-${crypto.randomUUID()}`,
    });
    expect(request).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
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

  it("rolls back an Admin membership change when required audit evidence fails", async () => {
    const manager = await seedManager();
    const principal = await signUp();
    const now = Date.now();
    const customerId = crypto.randomUUID();
    const subscriptionId = crypto.randomUUID();
    const principalRow = await env.DB.prepare(
      "SELECT id FROM customer_principal WHERE auth_user_id=?",
    )
      .bind(principal.userId)
      .first<{ id: string }>();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO customer (id, auth_user_id, principal_id, status, version, created_at, updated_at) VALUES (?, ?, ?, 'active', 1, ?, ?)",
      ).bind(customerId, principal.userId, principalRow!.id, now, now),
      env.DB.prepare(
        "INSERT INTO subscription (id, customer_id, offer_id, status, starts_at, created_at, updated_at, version) VALUES (?, ?, 'offer-membership-monthly', 'ACTIVE', ?, ?, ?, 1)",
      ).bind(subscriptionId, customerId, now, now, now),
    ]);
    await env.DB.prepare(
      `CREATE TRIGGER fail_membership_pause_audit
       BEFORE INSERT ON audit_event
       WHEN NEW.action IN ('MEMBERSHIP.PAUSED', 'MEMBERSHIP.RESUMED', 'MEMBERSHIP.CANCELED')
       BEGIN SELECT RAISE(ABORT, 'forced audit failure'); END`,
    ).run();

    try {
      await core.pauseAdminMembership({
        requestId: crypto.randomUUID(),
        headers: { cookie: manager.cookie },
        subscriptionId,
        reason: "atomic pause",
        expectedVersion: 1,
        idempotencyKey: `mem-${crypto.randomUUID()}`,
      });
    } catch {
      // The observable invariant is rollback, independent of RPC error transport.
    }

    const row = await env.DB.prepare("SELECT status, version FROM subscription WHERE id=?")
      .bind(subscriptionId)
      .first<{ status: string; version: number }>();
    expect(row).toEqual({ status: "ACTIVE", version: 1 });

    await env.DB.prepare("UPDATE subscription SET status='PAUSED', paused_at=? WHERE id=?")
      .bind(now, subscriptionId)
      .run();

    try {
      await core.resumeAdminMembership({
        requestId: crypto.randomUUID(),
        headers: { cookie: manager.cookie },
        subscriptionId,
        reason: "atomic resume",
        expectedVersion: 1,
        idempotencyKey: `mem-${crypto.randomUUID()}`,
      });
    } catch {
      // The observable invariant is rollback, independent of RPC error transport.
    }
    const resumedRow = await env.DB.prepare("SELECT status, version FROM subscription WHERE id=?")
      .bind(subscriptionId)
      .first<{ status: string; version: number }>();
    expect(resumedRow).toEqual({ status: "PAUSED", version: 1 });

    await env.DB.prepare("UPDATE subscription SET status='ACTIVE', paused_at=NULL WHERE id=?")
      .bind(subscriptionId)
      .run();

    try {
      await core.cancelAdminMembership({
        requestId: crypto.randomUUID(),
        headers: { cookie: manager.cookie },
        subscriptionId,
        reason: "atomic cancel",
        timing: "IMMEDIATE",
        expectedVersion: 1,
        idempotencyKey: `mem-${crypto.randomUUID()}`,
      });
    } catch {
      // The observable invariant is rollback, independent of RPC error transport.
    }
    const canceledRow = await env.DB.prepare("SELECT status, version FROM subscription WHERE id=?")
      .bind(subscriptionId)
      .first<{ status: string; version: number }>();
    expect(canceledRow).toEqual({ status: "ACTIVE", version: 1 });
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
      action: "CLAIM" | "BEGIN_INVESTIGATION" | "RESOLVE" | "ESCALATE",
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

    const reopen = await core.applyAdminOrderIssueAction({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      issueId,
      action: "REOPEN" as never,
      reason: "must remain terminal",
      expectedVersion: resolved.version,
      idempotencyKey: `iss-${crypto.randomUUID()}`,
    });
    expect(reopen).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });

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
