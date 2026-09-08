import { describe, expect, it } from "vitest";
import { env, exports } from "cloudflare:workers";
import { SELF } from "cloudflare:test";
import { createAuth } from "./auth/service";
import { resolveAuthenticatedCustomer } from "./customer/principal";
import type {
  CoreServiceBinding,
  RpcResult,
  SubscriptionEligibility,
} from "@freshmarkets/contracts";

const core = exports.default as unknown as CoreServiceBinding;

function requestId() {
  return crypto.randomUUID();
}

function cookieHeader(response: Response): string {
  const cookies = response.headers.getSetCookie?.() ?? [];
  return cookies.map((cookie) => cookie.split(";", 1)[0]).join("; ");
}

async function signUp(email = `phase4a-${crypto.randomUUID()}@example.com`) {
  const response = await SELF.fetch("https://core.example.invalid/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://core.example.invalid" },
    body: JSON.stringify({ name: "Phase 4A", email, password: "correct-horse-battery-staple" }),
  });
  expect(response.status).toBeLessThan(400);
  const body = (await response.json()) as { user?: { id: string; email: string } };
  expect(body.user?.id).toBeTruthy();
  return { userId: body.user!.id, email, cookie: cookieHeader(response) };
}

async function signIn(email: string) {
  const response = await SELF.fetch("https://core.example.invalid/api/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://core.example.invalid" },
    body: JSON.stringify({ email, password: "correct-horse-battery-staple" }),
  });
  expect(response.status).toBeLessThan(400);
  return cookieHeader(response);
}

async function commerceContext(cookie: string): Promise<RpcResult<SubscriptionEligibility>> {
  return core.getSubscriptionEligibility({ headers: { cookie }, requestId: requestId() });
}

describe("Phase 4A authenticated customer boundary", () => {
  it("rejects first provisioning if access is disabled before its transaction", async () => {
    const account = await signUp();
    await env.DB.prepare("UPDATE user SET email_verified=1 WHERE id=?").bind(account.userId).run();
    const cookie = await signIn(account.email);
    const db = new Proxy(env.DB, {
      get(database, property) {
        if (property === "batch")
          return async (statements: D1PreparedStatement[]) => {
            await database
              .prepare("UPDATE customer_principal SET status='disabled' WHERE auth_user_id=?")
              .bind(account.userId)
              .run();
            return database.batch(statements);
          };
        const value = Reflect.get(database, property, database);
        return typeof value === "function" ? value.bind(database) : value;
      },
    });
    const result = await resolveAuthenticatedCustomer(
      db,
      { headers: { cookie }, requestId: requestId() },
      {
        now: Date.now,
        getSessionUser: async (headers) =>
          (await createAuth(env).api.getSession({ headers }))?.user ?? null,
      },
    );
    expect(result).toMatchObject({ ok: false });
    expect(
      await env.DB.prepare("SELECT COUNT(*) count FROM customer WHERE auth_user_id=?")
        .bind(account.userId)
        .first(),
    ).toEqual({ count: 0 });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) count FROM audit_event WHERE action='CUSTOMER.PROVISIONED' AND actor_user_id=?",
      )
        .bind(account.userId)
        .first(),
    ).toEqual({ count: 0 });
  });
  it("rolls back implicit principal/customer creation when its audit is ignored and safely retries", async () => {
    const account = await signUp();
    await env.DB.prepare("UPDATE user SET email_verified=1 WHERE id=?").bind(account.userId).run();
    const cookie = await signIn(account.email);
    await env.DB.prepare("DELETE FROM customer_principal WHERE auth_user_id=?")
      .bind(account.userId)
      .run();
    await env.DB.prepare(
      "CREATE TRIGGER test_ignore_customer_provisioning BEFORE INSERT ON audit_event WHEN NEW.action='CUSTOMER.PROVISIONED' BEGIN SELECT RAISE(IGNORE); END",
    ).run();
    const request = { headers: { cookie }, requestId: requestId() };
    try {
      expect(await core.listCustomerAddresses(request)).toMatchObject({ ok: false });
      expect(
        await env.DB.prepare("SELECT COUNT(*) count FROM customer WHERE auth_user_id=?")
          .bind(account.userId)
          .first(),
      ).toEqual({ count: 0 });
      expect(
        await env.DB.prepare("SELECT COUNT(*) count FROM customer_principal WHERE auth_user_id=?")
          .bind(account.userId)
          .first(),
      ).toEqual({ count: 0 });
    } finally {
      await env.DB.prepare("DROP TRIGGER test_ignore_customer_provisioning").run();
    }
    const results = await Promise.all(
      Array.from({ length: 4 }, () => core.listCustomerAddresses(request)),
    );
    expect(results.every((result) => result.ok)).toBe(true);
    expect(
      await env.DB.prepare("SELECT COUNT(*) count FROM customer WHERE auth_user_id=?")
        .bind(account.userId)
        .first(),
    ).toEqual({ count: 1 });
    expect(
      await env.DB.prepare("SELECT COUNT(*) count FROM customer_principal WHERE auth_user_id=?")
        .bind(account.userId)
        .first(),
    ).toEqual({ count: 1 });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) count FROM audit_event WHERE action='CUSTOMER.PROVISIONED' AND actor_user_id=?",
      )
        .bind(account.userId)
        .first(),
    ).toEqual({ count: 1 });
  });
  it("preserves a retained customer identity when attaching its principal", async () => {
    const account = await signUp();
    await env.DB.prepare("UPDATE user SET email_verified=1 WHERE id=?").bind(account.userId).run();
    const cookie = await signIn(account.email);
    const customerId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO customer(id,auth_user_id,status,created_at,updated_at) VALUES (?,?,'active',?,?)",
    )
      .bind(customerId, account.userId, Date.now(), Date.now())
      .run();
    expect(
      await core.listCustomerAddresses({ headers: { cookie }, requestId: requestId() }),
    ).toMatchObject({ ok: true });
    const customer = await env.DB.prepare(
      "SELECT id,principal_id FROM customer WHERE auth_user_id=?",
    )
      .bind(account.userId)
      .first<{ id: string; principal_id: string | null }>();
    expect(customer?.id).toBe(customerId);
    expect(customer?.principal_id).toBeTruthy();
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) count FROM audit_event WHERE action='CUSTOMER.PROVISIONED' AND actor_user_id=?",
      )
        .bind(account.userId)
        .first(),
    ).toEqual({ count: 0 });
  });
  it("signup provisions an idempotent principal and preserves auth cookies", async () => {
    const account = await signUp();
    const principal = await env.DB.prepare(
      "SELECT id, auth_user_id, status FROM customer_principal WHERE auth_user_id=?",
    )
      .bind(account.userId)
      .first<{ id: string; auth_user_id: string; status: string }>();
    expect(principal).toMatchObject({ auth_user_id: account.userId, status: "active" });
    await env.DB.prepare("DELETE FROM customer_principal WHERE auth_user_id=?")
      .bind(account.userId)
      .run();
    await env.DB.prepare("UPDATE user SET email_verified=1 WHERE id=?").bind(account.userId).run();
    const cookie = await signIn(account.email);
    expect(cookie).toContain("better-auth");
    const reconciledAccess = await commerceContext(cookie);
    expect(reconciledAccess.ok).toBe(true);
    const reconciled = await env.DB.prepare(
      "SELECT id FROM customer_principal WHERE auth_user_id=?",
    )
      .bind(account.userId)
      .first<{ id: string }>();
    expect(reconciled?.id).toBeTruthy();
  });

  it("first and repeated commerce access provision exactly one stable customer", async () => {
    const account = await signUp();
    await env.DB.prepare("UPDATE user SET email_verified=1 WHERE id=?").bind(account.userId).run();
    const cookie = await signIn(account.email);
    const [first, second] = await Promise.all([commerceContext(cookie), commerceContext(cookie)]);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    const customers = await env.DB.prepare(
      "SELECT id, principal_id, auth_user_id FROM customer WHERE auth_user_id=?",
    )
      .bind(account.userId)
      .all<{ id: string; principal_id: string; auth_user_id: string }>();
    expect(customers.results).toHaveLength(1);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(customers.results[0].principal_id).toBeTruthy();
  });

  it("disabled principals block provisioning and existing customers", async () => {
    const account = await signUp();
    await env.DB.prepare("UPDATE user SET email_verified=1 WHERE id=?").bind(account.userId).run();
    const cookie = await signIn(account.email);
    const principal = await env.DB.prepare("SELECT id FROM customer_principal WHERE auth_user_id=?")
      .bind(account.userId)
      .first<{ id: string }>();
    await env.DB.prepare("UPDATE customer_principal SET status='disabled' WHERE id=?")
      .bind(principal!.id)
      .run();
    const blockedBefore = await commerceContext(cookie);
    expect(blockedBefore).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS count FROM customer WHERE principal_id=?")
        .bind(principal!.id)
        .first<{ count: number }>(),
    ).toMatchObject({ count: 0 });

    await env.DB.prepare(
      "INSERT INTO customer (id, auth_user_id, principal_id, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?)",
    )
      .bind(crypto.randomUUID(), account.userId, principal!.id, Date.now(), Date.now())
      .run();
    const blockedAfter = await commerceContext(cookie);
    expect(blockedAfter).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });

  it("derives customer identity from session and isolates users", async () => {
    const a = await signUp();
    const b = await signUp();
    await env.DB.batch([
      env.DB.prepare("UPDATE user SET email_verified=1 WHERE id IN (?, ?)").bind(
        a.userId,
        b.userId,
      ),
    ]);
    const [aCookie, bCookie] = await Promise.all([signIn(a.email), signIn(b.email)]);
    await Promise.all([commerceContext(aCookie), commerceContext(bCookie)]);
    const rows = await env.DB.prepare(
      "SELECT auth_user_id, id FROM customer WHERE auth_user_id IN (?, ?) ORDER BY auth_user_id",
    )
      .bind(a.userId, b.userId)
      .all<{ auth_user_id: string; id: string }>();
    expect(rows.results).toHaveLength(2);
    expect(rows.results[0].id).not.toBe(rows.results[1].id);

    const forged = await core.getSubscriptionEligibility({
      headers: { cookie: aCookie },
      requestId: requestId(),
      customerId: rows.results[1].id,
    } as unknown as Parameters<CoreServiceBinding["getSubscriptionEligibility"]>[0]);
    expect(forged.ok).toBe(true);
    if (forged.ok) expect(forged.value.state).toBeNull();
  });
});
