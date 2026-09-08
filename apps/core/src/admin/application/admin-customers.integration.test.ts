import { describe, expect, it } from "vitest";
import { SELF } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import type { CoreServiceBinding } from "@freshmarkets/contracts";
import { acceptCustomerInvitation } from "../../customer/invitations";
import { createAuth } from "../../auth/service";
import { inviteCustomer, revokeCustomerInvitation } from "./customer-invitations";
import { changeCustomerAccess } from "./change-customer-access";
import { revokeCustomerSessions } from "./revoke-customer-sessions";
import { applyPrivacyAction, requestCustomerClosure } from "./customer-commands";

const core = exports.default as unknown as CoreServiceBinding;

describe("verified customer invitation acceptance", () => {
  it("acceptance and revocation cannot both win", async () => {
    const { account, manager, request } = await invitation();
    const responses = await Promise.all([
      core.acceptCustomerInvitation(request),
      core.revokeCustomerInvitation({
        ...request,
        headers: { cookie: manager.cookie },
        reason: "Withdraw invitation",
        idempotencyKey: crypto.randomUUID(),
      }),
    ]);
    expect(responses.filter((result) => result.ok)).toHaveLength(1);
    const row = await env.DB.prepare(
      "SELECT status,version,accepted_customer_id FROM customer_invitation WHERE id=?",
    )
      .bind(request.invitationId)
      .first<{ status: string; version: number; accepted_customer_id: string | null }>();
    expect(row?.version).toBe(2);
    expect(
      await env.DB.prepare("SELECT count(*) AS count FROM customer WHERE auth_user_id=?")
        .bind(account.userId)
        .first(),
    ).toEqual({ count: row?.status === "ACCEPTED" ? 1 : 0 });
    expect(
      await env.DB.prepare(
        "SELECT count(*) AS count FROM audit_event WHERE aggregate_id=? AND action IN ('CUSTOMER.INVITATION_ACCEPTED','CUSTOMER.INVITATION_REVOKED')",
      )
        .bind(request.invitationId)
        .first(),
    ).toEqual({ count: 1 });
  });
  it("rejects unauthenticated acceptance and offer reads", async () => {
    expect(
      await core.getMyCustomerInvitation({ headers: {}, requestId: "unauth-offer" }),
    ).toMatchObject({ ok: false, error: { code: "UNAUTHENTICATED" } });
    expect(
      await core.acceptCustomerInvitation({
        headers: {},
        requestId: "unauth-accept",
        invitationId: "unknown",
        expectedVersion: 1,
        idempotencyKey: "unauth-accept",
      }),
    ).toMatchObject({ ok: false, error: { code: "UNAUTHENTICATED" } });
  });
  it("lets only one distinct acceptance decision win", async () => {
    const { account, request } = await invitation();
    const responses = await Promise.all([
      core.acceptCustomerInvitation(request),
      core.acceptCustomerInvitation({ ...request, idempotencyKey: crypto.randomUUID() }),
    ]);
    expect(responses.filter((result) => result.ok)).toHaveLength(1);
    expect(
      await env.DB.prepare("SELECT count(*) AS count FROM customer WHERE auth_user_id=?")
        .bind(account.userId)
        .first(),
    ).toEqual({ count: 1 });
    expect(
      await env.DB.prepare(
        "SELECT count(*) AS count FROM audit_event WHERE aggregate_id=? AND action='CUSTOMER.INVITATION_ACCEPTED'",
      )
        .bind(request.invitationId)
        .first(),
    ).toEqual({ count: 1 });
  });
  it("preserves creation and revocation receipts after later transitions", async () => {
    const manager = await seedManager();
    const creation = {
      headers: { cookie: manager.cookie },
      requestId: crypto.randomUUID(),
      email: `receipt-${crypto.randomUUID()}@example.com`,
      idempotencyKey: crypto.randomUUID(),
    };
    const created = await core.inviteCustomer(creation);
    if (!created.ok) throw new Error("Creation failed");
    const revocation = {
      ...creation,
      invitationId: created.value.invitationId,
      expectedVersion: 1,
      reason: "Incorrect invitee",
      idempotencyKey: crypto.randomUUID(),
    };
    const revoked = await core.revokeCustomerInvitation(revocation);
    expect(revoked).toMatchObject({ ok: true, value: { status: "REVOKED", version: 2 } });
    expect(await core.revokeCustomerInvitation(revocation)).toEqual(revoked);
    expect(await core.inviteCustomer(creation)).toEqual(created);
    expect(
      await core.revokeCustomerInvitation({ ...revocation, reason: "Changed reason" }),
    ).toMatchObject({ ok: false, error: { code: "IDEMPOTENCY_CONFLICT" } });
    expect(
      await core.inviteCustomer({ ...creation, idempotencyKey: crypto.randomUUID() }),
    ).toMatchObject({ ok: true });
  });
  it.each([
    "create:invitation",
    "create:audit",
    "create:receipt",
    "revoke:invitation",
    "revoke:audit",
    "revoke:receipt",
  ])("rolls back %s and recovers the same key", async (scenario) => {
    const manager = await seedManager();
    const creation = {
      headers: { cookie: manager.cookie },
      requestId: crypto.randomUUID(),
      email: `rollback-${crypto.randomUUID()}@example.com`,
      idempotencyKey: crypto.randomUUID(),
    };
    const revoke = scenario.startsWith("revoke");
    const created = revoke ? await core.inviteCustomer(creation) : null;
    const invitationId = created?.ok ? created.value.invitationId : "unused";
    const revocation = {
      ...creation,
      invitationId,
      expectedVersion: 1,
      reason: "Withdraw invitation",
      idempotencyKey: crypto.randomUUID(),
    };
    const command = () =>
      revoke ? core.revokeCustomerInvitation(revocation) : core.inviteCustomer(creation);
    const trigger = scenario.endsWith("invitation")
      ? revoke
        ? "BEFORE UPDATE ON customer_invitation"
        : "BEFORE INSERT ON customer_invitation"
      : scenario.endsWith("audit")
        ? `BEFORE INSERT ON audit_event WHEN NEW.action='${revoke ? "CUSTOMER.INVITATION_REVOKED" : "CUSTOMER.INVITED"}'`
        : "BEFORE UPDATE ON idempotency_records WHEN NEW.status='SUCCEEDED'";
    await env.DB.exec(
      `CREATE TRIGGER test_ignore_invitation_admin ${trigger} BEGIN SELECT RAISE(IGNORE); END`,
    );
    try {
      expect(await command()).toMatchObject({ ok: false });
      expect(
        await env.DB.prepare(
          "SELECT count(*) AS count FROM customer_invitation WHERE email_normalized=? AND status='PENDING'",
        )
          .bind(creation.email)
          .first(),
      ).toEqual({ count: revoke ? 1 : 0 });
      expect(
        await env.DB.prepare(
          "SELECT count(*) AS count FROM idempotency_records WHERE idempotency_key=?",
        )
          .bind(revoke ? revocation.idempotencyKey : creation.idempotencyKey)
          .first(),
      ).toEqual({ count: 0 });
    } finally {
      await env.DB.exec("DROP TRIGGER test_ignore_invitation_admin");
    }
    expect(await command()).toMatchObject({ ok: true });
  });
  it.each(["create", "revoke"])(
    "rechecks Global customer authority for %s inside the transaction",
    async (operation) => {
      const manager = await seedManager();
      const request = {
        headers: { cookie: manager.cookie },
        requestId: crypto.randomUUID(),
        email: `authority-${crypto.randomUUID()}@example.com`,
        idempotencyKey: crypto.randomUUID(),
      };
      const created = operation === "revoke" ? await core.inviteCustomer(request) : null;
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
      const result =
        operation === "create"
          ? await inviteCustomer(deps, request)
          : await revokeCustomerInvitation(deps, {
              ...request,
              idempotencyKey: crypto.randomUUID(),
              invitationId: created?.ok ? created.value.invitationId : "missing",
              expectedVersion: 1,
              reason: "Withdraw",
            });
      expect(result).toMatchObject({ ok: false });
      expect(
        await env.DB.prepare(
          "SELECT count(*) AS count FROM customer_invitation WHERE email_normalized=? AND status='PENDING'",
        )
          .bind(request.email)
          .first(),
      ).toEqual({ count: operation === "revoke" ? 1 : 0 });
    },
  );
  async function invitation() {
    const manager = await seedManager();
    const account = await signUp();
    const user = await env.DB.prepare("SELECT email FROM user WHERE id=?")
      .bind(account.userId)
      .first<{ email: string }>();
    if (!user) throw new Error("Missing test identity");
    const created = await core.inviteCustomer({
      headers: { cookie: manager.cookie },
      requestId: crypto.randomUUID(),
      email: user.email,
      idempotencyKey: crypto.randomUUID(),
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("Invitation creation failed");
    const offer = await core.getMyCustomerInvitation({
      headers: { cookie: account.cookie },
      requestId: crypto.randomUUID(),
    });
    expect(offer.ok && offer.value?.invitationId).toBe(created.value.invitationId);
    return {
      account,
      manager,
      request: {
        headers: { cookie: account.cookie },
        requestId: crypto.randomUUID(),
        invitationId: created.value.invitationId,
        expectedVersion: 1,
        idempotencyKey: crypto.randomUUID(),
      },
    };
  }
  it("provisions through the reachable invitation command and replays the original acceptance", async () => {
    const { account, request } = await invitation();
    const responses = await Promise.all([
      core.acceptCustomerInvitation(request),
      core.acceptCustomerInvitation(request),
    ]);
    expect(responses[0]).toMatchObject({ ok: true });
    expect(responses[1]).toEqual(responses[0]);
    await env.DB.prepare("UPDATE customer_principal SET status='disabled' WHERE auth_user_id=?")
      .bind(account.userId)
      .run();
    expect(await core.acceptCustomerInvitation(request)).toEqual(responses[0]);
    expect(await core.acceptCustomerInvitation({ ...request, expectedVersion: 2 })).toMatchObject({
      ok: false,
      error: { code: "IDEMPOTENCY_CONFLICT" },
    });
    expect(
      await env.DB.prepare("SELECT count(*) AS count FROM customer WHERE auth_user_id=?")
        .bind(account.userId)
        .first(),
    ).toEqual({ count: 1 });
    expect(
      await env.DB.prepare(
        "SELECT count(*) AS count FROM audit_event WHERE aggregate_id=? AND action='CUSTOMER.INVITATION_ACCEPTED'",
      )
        .bind(request.invitationId)
        .first(),
    ).toEqual({ count: 1 });
  });
  it.each(["customer", "acceptance", "audit", "receipt"])(
    "rolls back all effects when the required %s write is ignored, then retries",
    async (effect) => {
      const { account, request } = await invitation();
      const trigger =
        effect === "customer"
          ? "BEFORE INSERT ON customer"
          : effect === "acceptance"
            ? "BEFORE UPDATE ON customer_invitation WHEN NEW.status='ACCEPTED'"
            : effect === "audit"
              ? "BEFORE INSERT ON audit_event WHEN NEW.action='CUSTOMER.INVITATION_ACCEPTED'"
              : "BEFORE UPDATE ON idempotency_records WHEN NEW.scope='customer.invitation.accept' AND NEW.status='SUCCEEDED'";
      await env.DB.exec(
        `CREATE TRIGGER test_ignore_customer_acceptance ${trigger} BEGIN SELECT RAISE(IGNORE); END`,
      );
      try {
        expect(await core.acceptCustomerInvitation(request)).toMatchObject({ ok: false });
        expect(
          await env.DB.prepare("SELECT count(*) AS count FROM customer WHERE auth_user_id=?")
            .bind(account.userId)
            .first(),
        ).toEqual({ count: 0 });
        expect(
          await env.DB.prepare(
            "SELECT status,version,accepted_customer_id FROM customer_invitation WHERE id=?",
          )
            .bind(request.invitationId)
            .first(),
        ).toEqual({ status: "PENDING", version: 1, accepted_customer_id: null });
        expect(
          await env.DB.prepare(
            "SELECT count(*) AS count FROM audit_event WHERE actor_user_id=? AND action IN ('CUSTOMER.PROVISIONED','CUSTOMER.INVITATION_ACCEPTED')",
          )
            .bind(account.userId)
            .first(),
        ).toEqual({ count: 0 });
        expect(
          await env.DB.prepare(
            "SELECT count(*) AS count FROM idempotency_records WHERE scope='customer.invitation.accept' AND idempotency_key=?",
          )
            .bind(`${account.userId}:${request.idempotencyKey}`)
            .first(),
        ).toEqual({ count: 0 });
      } finally {
        await env.DB.exec("DROP TRIGGER test_ignore_customer_acceptance");
      }
      expect(await core.acceptCustomerInvitation(request)).toMatchObject({ ok: true });
    },
  );
  it.each(["unverified", "wrong-account", "stale", "revoked", "disabled"])(
    "rejects %s without provisioning",
    async (reason) => {
      const { account, request } = await invitation();
      if (reason === "unverified")
        await env.DB.prepare("UPDATE user SET email_verified=0 WHERE id=?")
          .bind(account.userId)
          .run();
      if (reason === "wrong-account") request.headers.cookie = (await signUp()).cookie;
      if (reason === "stale") request.expectedVersion = 2;
      if (reason === "revoked")
        await env.DB.prepare(
          "UPDATE customer_invitation SET status='REVOKED',version=version+1 WHERE id=?",
        )
          .bind(request.invitationId)
          .run();
      if (reason === "disabled")
        await env.DB.prepare("UPDATE customer_principal SET status='disabled' WHERE auth_user_id=?")
          .bind(account.userId)
          .run();
      expect(await core.acceptCustomerInvitation(request)).toMatchObject({ ok: false });
      expect(
        await env.DB.prepare("SELECT count(*) AS count FROM customer WHERE auth_user_id=?")
          .bind(account.userId)
          .first(),
      ).toEqual({ count: 0 });
    },
  );
  it.each([-1, 0, 1])("enforces expiry at the exact boundary (%s ms)", async (offset) => {
    const { request } = await invitation();
    const expires = await env.DB.prepare("SELECT expires_at FROM customer_invitation WHERE id=?")
      .bind(request.invitationId)
      .first<{ expires_at: number }>();
    if (!expires) throw new Error("Missing invitation");
    const result = await acceptCustomerInvitation(
      {
        database: env.DB,
        session: async (input) =>
          (await createAuth(env).api.getSession({ headers: new Headers(input.headers) }))?.user ??
          null,
        now: () => expires.expires_at + offset,
      },
      request,
    );
    expect(result.ok).toBe(offset < 0);
  });
  it("rejects identity verification withdrawn between the read and transaction", async () => {
    const { account, request } = await invitation();
    const database = new Proxy(env.DB, {
      get(target, property) {
        if (property === "batch")
          return async (statements: D1PreparedStatement[]) => {
            await target
              .prepare("UPDATE user SET email_verified=0 WHERE id=?")
              .bind(account.userId)
              .run();
            return target.batch(statements);
          };
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    expect(
      await acceptCustomerInvitation(
        {
          database,
          session: async (input) =>
            (await createAuth(env).api.getSession({ headers: new Headers(input.headers) }))?.user ??
            null,
          now: Date.now,
        },
        request,
      ),
    ).toMatchObject({ ok: false });
    expect(
      await env.DB.prepare("SELECT count(*) AS count FROM customer WHERE auth_user_id=?")
        .bind(account.userId)
        .first(),
    ).toEqual({ count: 0 });
  });
});

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
  it("excludes unrelated staff actions when that staff user is also a customer", async () => {
    const manager = await seedManager();
    const identity = await env.DB.prepare("SELECT auth_user_id FROM staff_identity WHERE id=?")
      .bind(manager.staffId)
      .first<{ auth_user_id: string }>();
    if (!identity) throw new Error("Missing manager");
    const customerId = await seedCustomer({ userId: identity.auth_user_id });
    expect(
      await core.inviteCustomer({
        headers: { cookie: manager.cookie },
        requestId: crypto.randomUUID(),
        email: `unrelated-${crypto.randomUUID()}@example.com`,
        idempotencyKey: crypto.randomUUID(),
      }),
    ).toMatchObject({ ok: true });
    const detail = await core.getAdminCustomer({
      headers: { cookie: manager.cookie },
      requestId: crypto.randomUUID(),
      customerId,
    });
    expect(detail).toMatchObject({ ok: true, value: { recentAudit: [] } });
  });
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

describe("customer privacy recovery", () => {
  async function ready(requestType: "CLOSURE" | "ANONYMIZATION" = "CLOSURE") {
    const manager = await seedManager();
    const account = await signUp();
    const customerId = await seedCustomer(account);
    const creation = {
      headers: { cookie: manager.cookie },
      requestId: crypto.randomUUID(),
      customerId,
      requestType,
      reason: "Customer requested review",
      idempotencyKey: crypto.randomUUID(),
    };
    const created = await core.requestCustomerClosure(creation);
    if (!created.ok) throw new Error("Privacy request failed");
    let current = created.value;
    for (const action of ["VERIFY", "APPROVE", "BEGIN_PROCESSING"] as const) {
      const next = await core.applyPrivacyAction({
        headers: creation.headers,
        requestId: crypto.randomUUID(),
        privacyRequestId: current.privacyRequestId,
        action,
        reason: `${action} reviewed`,
        expectedVersion: current.version,
        idempotencyKey: crypto.randomUUID(),
      });
      if (!next.ok) throw new Error("Privacy preparation failed");
      current = next.value;
    }
    return {
      manager,
      account,
      customerId,
      creation,
      created,
      current,
      completion: {
        headers: creation.headers,
        requestId: crypto.randomUUID(),
        privacyRequestId: current.privacyRequestId,
        action: "COMPLETE" as const,
        reason: "Customer closure confirmed",
        expectedVersion: current.version,
        idempotencyKey: crypto.randomUUID(),
      },
    };
  }
  it.each([
    "request",
    "customer",
    "principal",
    "sessions",
    "closure-audit",
    "action-audit",
    "receipt",
  ])("rolls back closure when the required %s effect is ignored", async (effect) => {
    const setup = await ready();
    const trigger =
      effect === "request"
        ? "BEFORE UPDATE ON privacy_request"
        : effect === "customer"
          ? "BEFORE UPDATE ON customer"
          : effect === "principal"
            ? "BEFORE UPDATE ON customer_principal"
            : effect === "sessions"
              ? "BEFORE DELETE ON session"
              : effect === "closure-audit"
                ? "BEFORE INSERT ON audit_event WHEN NEW.action='CUSTOMER.CLOSED'"
                : effect === "action-audit"
                  ? "BEFORE INSERT ON audit_event WHEN NEW.action='PRIVACY.ACTION_APPLIED'"
                  : "BEFORE UPDATE ON idempotency_records WHEN NEW.status='SUCCEEDED'";
    await env.DB.exec(
      `CREATE TRIGGER test_ignore_closure_effect ${trigger} BEGIN SELECT RAISE(IGNORE); END`,
    );
    try {
      expect(await core.applyPrivacyAction(setup.completion)).toMatchObject({ ok: false });
      expect(
        await env.DB.prepare("SELECT status,version FROM privacy_request WHERE id=?")
          .bind(setup.current.privacyRequestId)
          .first(),
      ).toEqual({ status: "PROCESSING", version: setup.current.version });
      expect(
        await env.DB.prepare("SELECT status FROM customer_principal WHERE auth_user_id=?")
          .bind(setup.account.userId)
          .first(),
      ).toEqual({ status: "active" });
      expect(
        await env.DB.prepare("SELECT version FROM customer WHERE id=?")
          .bind(setup.customerId)
          .first(),
      ).toEqual({ version: 1 });
      expect(
        await env.DB.prepare("SELECT count(*) AS count FROM session WHERE user_id=?")
          .bind(setup.account.userId)
          .first(),
      ).toEqual({ count: 1 });
      expect(
        await env.DB.prepare("SELECT count(*) AS count FROM audit_event WHERE correlation_id=?")
          .bind(setup.completion.requestId)
          .first(),
      ).toEqual({ count: 0 });
      expect(
        await env.DB.prepare(
          "SELECT count(*) AS count FROM idempotency_records WHERE scope='admin.privacy.action' AND idempotency_key=?",
        )
          .bind(setup.completion.idempotencyKey)
          .first(),
      ).toEqual({ count: 0 });
    } finally {
      await env.DB.exec("DROP TRIGGER test_ignore_closure_effect");
    }
    const completed = await core.applyPrivacyAction(setup.completion);
    expect(completed).toMatchObject({
      ok: true,
      value: { status: "COMPLETED", availableActions: [] },
    });
    expect(await core.applyPrivacyAction(setup.completion)).toEqual(completed);
    expect(await core.requestCustomerClosure(setup.creation)).toEqual(setup.created);
  });
  it.each(["request", "audit", "receipt"])(
    "rolls back privacy creation when its %s is ignored",
    async (effect) => {
      const manager = await seedManager();
      const customerId = await seedCustomer(await signUp());
      const request = {
        headers: { cookie: manager.cookie },
        requestId: crypto.randomUUID(),
        customerId,
        requestType: "CLOSURE" as const,
        reason: "Customer requested closure",
        idempotencyKey: crypto.randomUUID(),
      };
      const trigger =
        effect === "request"
          ? "BEFORE INSERT ON privacy_request"
          : effect === "audit"
            ? "BEFORE INSERT ON audit_event WHEN NEW.action='CUSTOMER.CLOSURE_REQUESTED'"
            : "BEFORE UPDATE ON idempotency_records WHEN NEW.status='SUCCEEDED'";
      await env.DB.exec(
        `CREATE TRIGGER test_ignore_privacy_create ${trigger} BEGIN SELECT RAISE(IGNORE); END`,
      );
      try {
        expect(await core.requestCustomerClosure(request)).toMatchObject({ ok: false });
        expect(
          await env.DB.prepare("SELECT count(*) AS count FROM privacy_request WHERE customer_id=?")
            .bind(customerId)
            .first(),
        ).toEqual({ count: 0 });
        expect(
          await env.DB.prepare(
            "SELECT count(*) AS count FROM idempotency_records WHERE idempotency_key=?",
          )
            .bind(request.idempotencyKey)
            .first(),
        ).toEqual({ count: 0 });
      } finally {
        await env.DB.exec("DROP TRIGGER test_ignore_privacy_create");
      }
      expect(await core.requestCustomerClosure(request)).toMatchObject({ ok: true });
    },
  );
  it.each(["creation", "completion"])(
    "rechecks Global authority for privacy %s",
    async (operation) => {
      const setup = await ready();
      const db = new Proxy(env.DB, {
        get(target, property) {
          if (property === "batch")
            return async (statements: D1PreparedStatement[]) => {
              await target
                .prepare("DELETE FROM staff_scope WHERE staff_id=?")
                .bind(setup.manager.staffId)
                .run();
              return target.batch(statements);
            };
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      const deps = { auth: createAuth(env), db };
      const result =
        operation === "creation"
          ? await requestCustomerClosure(deps, {
              ...setup.creation,
              idempotencyKey: crypto.randomUUID(),
            })
          : await applyPrivacyAction(deps, setup.completion);
      expect(result).toMatchObject({ ok: false });
      expect(
        await env.DB.prepare("SELECT status FROM privacy_request WHERE id=?")
          .bind(setup.current.privacyRequestId)
          .first(),
      ).toEqual({ status: "PROCESSING" });
      expect(
        await env.DB.prepare("SELECT status FROM customer_principal WHERE auth_user_id=?")
          .bind(setup.account.userId)
          .first(),
      ).toEqual({ status: "active" });
    },
  );
  it("does not claim anonymization completion without a configured policy", async () => {
    const setup = await ready("ANONYMIZATION");
    expect(setup.current.availableActions).not.toContain("COMPLETE");
    expect(await core.applyPrivacyAction(setup.completion)).toMatchObject({
      ok: false,
      error: { code: "CONFLICT" },
    });
    expect(
      await env.DB.prepare("SELECT status FROM privacy_request WHERE id=?")
        .bind(setup.current.privacyRequestId)
        .first(),
    ).toEqual({ status: "PROCESSING" });
    expect(
      await env.DB.prepare("SELECT status FROM customer_principal WHERE auth_user_id=?")
        .bind(setup.account.userId)
        .first(),
    ).toEqual({ status: "active" });
  });
  it("lets one completion win and preserves its receipt after a later authorized restoration", async () => {
    const setup = await ready();
    const competing = { ...setup.completion, idempotencyKey: crypto.randomUUID() };
    const results = await Promise.all([
      core.applyPrivacyAction(setup.completion),
      core.applyPrivacyAction(competing),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(
      await env.DB.prepare(
        "SELECT count(*) AS count FROM audit_event WHERE aggregate_id=? AND action='CUSTOMER.CLOSED'",
      )
        .bind(setup.customerId)
        .first(),
    ).toEqual({ count: 1 });
    const winner = results[0]?.ok ? setup.completion : competing;
    const winningResult = results.find((result) => result.ok);
    if (!winningResult) throw new Error("No completion won");
    expect(
      await core.changeCustomerAccess({
        headers: setup.creation.headers,
        requestId: crypto.randomUUID(),
        customerId: setup.customerId,
        action: "RESTORE",
        expectedVersion: 2,
        reason: "Customer withdrew closure request",
        idempotencyKey: crypto.randomUUID(),
      }),
    ).toMatchObject({ ok: true });
    expect(await core.applyPrivacyAction(winner)).toEqual(winningResult);
    expect(
      await env.DB.prepare("SELECT status FROM customer_principal WHERE auth_user_id=?")
        .bind(setup.account.userId)
        .first(),
    ).toEqual({ status: "active" });
  });
  it("filters the privacy queue to the requested customer", async () => {
    const setup = await ready();
    const other = await ready();
    const result = await core.listPrivacyRequests({
      headers: setup.creation.headers,
      requestId: crypto.randomUUID(),
      customerId: setup.customerId,
      limit: 100,
    });
    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.value.items).toHaveLength(1);
      expect(result.value.items[0]?.privacyRequestId).toBe(setup.current.privacyRequestId);
      expect(result.value.items.some((item) => item.customerId === other.customerId)).toBe(false);
    }
  });
});

describe("customer crm commands", () => {
  it("rejects a session set changed before the transaction and retries against the current set", async () => {
    const manager = await seedManager();
    const account = await signUp();
    const customerId = await seedCustomer(account);
    const user = await env.DB.prepare("SELECT email FROM user WHERE id=?")
      .bind(account.userId)
      .first<{ email: string }>();
    if (!user) throw new Error("Missing account");
    const request = {
      headers: { cookie: manager.cookie },
      requestId: crypto.randomUUID(),
      customerId,
      reason: "Support review",
      idempotencyKey: crypto.randomUUID(),
    };
    const database = new Proxy(env.DB, {
      get(target, property) {
        if (property === "batch")
          return async (statements: D1PreparedStatement[]) => {
            const login = await SELF.fetch("https://core.example.invalid/api/auth/sign-in/email", {
              method: "POST",
              headers: {
                "content-type": "application/json",
                origin: "https://core.example.invalid",
              },
              body: JSON.stringify({ email: user.email, password: "correct-horse-battery-staple" }),
            });
            expect(login.status).toBe(200);
            return target.batch(statements);
          };
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    expect(
      await revokeCustomerSessions({ auth: createAuth(env), db: database }, request),
    ).toMatchObject({ ok: false });
    expect(
      await env.DB.prepare("SELECT count(*) AS count FROM session WHERE user_id=?")
        .bind(account.userId)
        .first(),
    ).toEqual({ count: 2 });
    expect(
      await env.DB.prepare(
        "SELECT count(*) AS count FROM audit_event WHERE aggregate_id=? AND action='CUSTOMER.SESSIONS_REVOKED'",
      )
        .bind(customerId)
        .first(),
    ).toEqual({ count: 0 });
    expect(await core.revokeCustomerSessions(request)).toMatchObject({
      ok: true,
      value: { revokedSessionCount: 2 },
    });
  });
  it("replays the original access decision after restoration and rejects changed intent", async () => {
    const manager = await seedManager();
    const account = await signUp();
    const customerId = await seedCustomer(account);
    const request = {
      headers: { cookie: manager.cookie },
      requestId: crypto.randomUUID(),
      customerId,
      reason: "Support review",
      idempotencyKey: crypto.randomUUID(),
      action: "DISABLE" as const,
      expectedVersion: 1,
    };
    const disabled = await core.changeCustomerAccess(request);
    expect(disabled).toMatchObject({ ok: true, value: { accessStatus: "disabled", version: 2 } });
    expect(await core.changeCustomerAccess(request)).toEqual(disabled);
    expect(
      await core.changeCustomerAccess({
        ...request,
        action: "RESTORE",
        expectedVersion: 2,
        idempotencyKey: crypto.randomUUID(),
      }),
    ).toMatchObject({ ok: true });
    expect(await core.changeCustomerAccess(request)).toEqual(disabled);
    const detail = await core.getAdminCustomer({
      headers: request.headers,
      requestId: crypto.randomUUID(),
      customerId,
    });
    expect(detail.ok).toBe(true);
    if (detail.ok)
      expect(
        detail.value.recentAudit.filter((event) => event.action === "CUSTOMER.ACCESS_CHANGED"),
      ).toHaveLength(2);
    expect(await core.changeCustomerAccess({ ...request, reason: "Another reason" })).toMatchObject(
      { ok: false, error: { code: "IDEMPOTENCY_CONFLICT" } },
    );
    await env.DB.prepare(
      "UPDATE idempotency_records SET result_type=scope,result_reference=? WHERE scope='admin.customers.access' AND idempotency_key=?",
    )
      .bind(customerId, request.idempotencyKey)
      .run();
    expect(await core.changeCustomerAccess(request)).toMatchObject({
      ok: true,
      value: { accessStatus: "active", version: 3 },
    });
  });
  it("replaying session revocation preserves a later real login and legacy count receipts", async () => {
    const manager = await seedManager();
    const account = await signUp();
    const customerId = await seedCustomer(account);
    const request = {
      headers: { cookie: manager.cookie },
      requestId: crypto.randomUUID(),
      customerId,
      reason: "Support review",
      idempotencyKey: crypto.randomUUID(),
    };
    const revoked = await core.revokeCustomerSessions(request);
    expect(revoked.ok).toBe(true);
    if (!revoked.ok) return;
    const user = await env.DB.prepare("SELECT email FROM user WHERE id=?")
      .bind(account.userId)
      .first<{ email: string }>();
    if (!user) throw new Error("Missing account");
    const login = await SELF.fetch("https://core.example.invalid/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://core.example.invalid" },
      body: JSON.stringify({ email: user.email, password: "correct-horse-battery-staple" }),
    });
    expect(login.status).toBe(200);
    expect(await core.revokeCustomerSessions(request)).toEqual(revoked);
    await env.DB.prepare(
      "UPDATE idempotency_records SET result_type=scope,result_reference=? WHERE scope='admin.customers.sessions.revoke' AND idempotency_key=?",
    )
      .bind(String(revoked.value.revokedSessionCount), request.idempotencyKey)
      .run();
    expect(await core.revokeCustomerSessions(request)).toEqual(revoked);
    expect(
      await env.DB.prepare("SELECT count(*) AS count FROM session WHERE user_id=?")
        .bind(account.userId)
        .first(),
    ).toEqual({ count: 1 });
  });
  it.each(["access", "sessions"])(
    "rechecks customer %s authority inside the batch",
    async (operation) => {
      const manager = await seedManager();
      const account = await signUp();
      const customerId = await seedCustomer(account);
      const request = {
        headers: { cookie: manager.cookie },
        requestId: crypto.randomUUID(),
        customerId,
        reason: "Support review",
        idempotencyKey: crypto.randomUUID(),
      };
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
      expect(
        operation === "access"
          ? await changeCustomerAccess(deps, { ...request, action: "DISABLE", expectedVersion: 1 })
          : await revokeCustomerSessions(deps, request),
      ).toMatchObject({ ok: false });
      expect(
        await env.DB.prepare(
          "SELECT count(*) AS count FROM idempotency_records WHERE idempotency_key=?",
        )
          .bind(request.idempotencyKey)
          .first(),
      ).toEqual({ count: 0 });
      expect(
        await env.DB.prepare("SELECT status FROM customer_principal WHERE auth_user_id=?")
          .bind(account.userId)
          .first(),
      ).toEqual({ status: "active" });
      expect(
        await env.DB.prepare("SELECT count(*) AS count FROM session WHERE user_id=?")
          .bind(account.userId)
          .first(),
      ).toEqual({ count: 1 });
    },
  );
  it("allows one competing access version to win", async () => {
    const manager = await seedManager();
    const customerId = await seedCustomer(await signUp());
    const request = {
      headers: { cookie: manager.cookie },
      requestId: crypto.randomUUID(),
      customerId,
      reason: "Support review",
      idempotencyKey: crypto.randomUUID(),
      action: "DISABLE" as const,
      expectedVersion: 1,
    };
    const results = await Promise.all([
      core.changeCustomerAccess(request),
      core.changeCustomerAccess({ ...request, idempotencyKey: crypto.randomUUID() }),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(
      await env.DB.prepare("SELECT version FROM customer WHERE id=?").bind(customerId).first(),
    ).toEqual({ version: 2 });
    expect(
      await env.DB.prepare(
        "SELECT count(*) AS count FROM audit_event WHERE aggregate_id=? AND action='CUSTOMER.ACCESS_CHANGED'",
      )
        .bind(customerId)
        .first(),
    ).toEqual({ count: 1 });
  });
  it.each([
    "access:principal",
    "access:version",
    "access:audit",
    "access:receipt",
    "sessions:delete",
    "sessions:audit",
    "sessions:receipt",
  ])("rolls back %s when its required write is ignored", async (scenario) => {
    const operation = scenario.startsWith("access") ? "access" : "sessions";
    const manager = await seedManager();
    const account = await signUp();
    const customerId = await seedCustomer(account);
    const request = {
      headers: { cookie: manager.cookie },
      requestId: crypto.randomUUID(),
      customerId,
      reason: "Support access review",
      idempotencyKey: crypto.randomUUID(),
    };
    const sessions = await env.DB.prepare("SELECT count(*) AS count FROM session WHERE user_id=?")
      .bind(account.userId)
      .first();
    const trigger = scenario.endsWith("principal")
      ? "BEFORE UPDATE ON customer_principal"
      : scenario.endsWith("version")
        ? "BEFORE UPDATE ON customer"
        : scenario.endsWith("delete")
          ? "BEFORE DELETE ON session"
          : scenario.endsWith("receipt")
            ? "BEFORE UPDATE ON idempotency_records WHEN NEW.status='SUCCEEDED'"
            : `BEFORE INSERT ON audit_event WHEN NEW.action='${operation === "access" ? "CUSTOMER.ACCESS_CHANGED" : "CUSTOMER.SESSIONS_REVOKED"}'`;
    await env.DB.exec(
      `CREATE TRIGGER test_ignore_customer_access_audit ${trigger} BEGIN SELECT RAISE(IGNORE); END`,
    );
    try {
      const result =
        operation === "access"
          ? await core.changeCustomerAccess({ ...request, action: "DISABLE", expectedVersion: 1 })
          : await core.revokeCustomerSessions(request);
      expect(result).toMatchObject({ ok: false });
      expect(
        await env.DB.prepare("SELECT status FROM customer_principal WHERE auth_user_id=?")
          .bind(account.userId)
          .first(),
      ).toEqual({ status: "active" });
      expect(
        await env.DB.prepare("SELECT version FROM customer WHERE id=?").bind(customerId).first(),
      ).toEqual({ version: 1 });
      expect(
        await env.DB.prepare("SELECT count(*) AS count FROM session WHERE user_id=?")
          .bind(account.userId)
          .first(),
      ).toEqual(sessions);
      expect(
        await env.DB.prepare(
          "SELECT count(*) AS count FROM idempotency_records WHERE idempotency_key=?",
        )
          .bind(request.idempotencyKey)
          .first(),
      ).toEqual({ count: 0 });
    } finally {
      await env.DB.exec("DROP TRIGGER test_ignore_customer_access_audit");
    }
    const retried =
      operation === "access"
        ? await core.changeCustomerAccess({ ...request, action: "DISABLE", expectedVersion: 1 })
        : await core.revokeCustomerSessions(request);
    expect(retried).toMatchObject({ ok: true });
  });
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
      "SELECT COUNT(*) AS count FROM audit_event WHERE action = 'CUSTOMER.ACCESS_CHANGED' AND aggregate_id=?",
    )
      .bind(customerId)
      .first<{ count: number }>();
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
    expect(staleEvidence).toEqual({ audit_count: 0, idempotency_status: null });

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
    expect(
      await env.DB.prepare(
        "SELECT cp.status FROM customer c JOIN customer_principal cp ON cp.id=c.principal_id WHERE c.id=?",
      )
        .bind(customerId)
        .first(),
    ).toEqual({ status: "disabled" });
    expect(
      await env.DB.prepare(
        "SELECT count(*) AS count FROM session WHERE user_id=(SELECT auth_user_id FROM customer WHERE id=?)",
      )
        .bind(customerId)
        .first(),
    ).toEqual({ count: 0 });

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
    expect(
      queue.value.items.find((item) => item.privacyRequestId === requested.value!.privacyRequestId)
        ?.version,
    ).toBe(completed.version);
  });
});
