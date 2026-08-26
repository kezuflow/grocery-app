import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import {
  beginRecurringAuthorization,
  type BeginRecurringAuthorizationCommand,
} from "./begin-recurring-authorization";
import { completeRecurringAuthorization } from "./complete-recurring-authorization";
import {
  createFakePaymentProvider,
  setFakeAuthorizationOutcome,
} from "../infrastructure/providers/fake-payment-provider";
import { ProviderRegistry } from "../infrastructure/providers/provider-registry";

let customerIdCounter = 0;
async function seedCustomer(): Promise<string> {
  const id = `cust-auth-${++customerIdCounter}-${crypto.randomUUID().slice(0, 8)}`;
  await env.DB.prepare(
    "INSERT INTO customer (id, auth_user_id, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
  )
    .bind(id, `auth-${id}`, Date.now(), Date.now())
    .run();
  return id;
}

async function beginCommand(
  overrides: Partial<BeginRecurringAuthorizationCommand> = {},
): Promise<BeginRecurringAuthorizationCommand> {
  return {
    customerId: await seedCustomer(),
    providerCode: "fake",
    currency: "PHP",
    returnUrl: "https://app.example/membership",
    idempotencyKey: `auth-${crypto.randomUUID()}`,
    requestId: crypto.randomUUID(),
    ...overrides,
  };
}

function testRegistry(): ProviderRegistry {
  return new ProviderRegistry("test", [createFakePaymentProvider()]);
}

async function authorizationRow(id: string) {
  return env.DB.prepare(
    "SELECT customer_id, provider, provider_authorization_ref, provider_method_ref, recurring_capable, status, established_at FROM payment_authorization WHERE id=?",
  )
    .bind(id)
    .first<{
      customer_id: string;
      provider: string;
      provider_authorization_ref: string;
      provider_method_ref: string | null;
      recurring_capable: number;
      status: string;
      established_at: number | null;
    }>();
}

describe("beginRecurringAuthorization", () => {
  it("persists a PENDING authorization and returns the redirect action", async () => {
    const command = await beginCommand();
    const result = await beginRecurringAuthorization(env.DB, testRegistry(), command);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.provider).toBe("fake");
    expect(result.value.actionType).toBe("REDIRECT");
    expect(result.value.redirectUrl).toContain("fake.pay.example");
    const row = await authorizationRow(result.value.authorizationId);
    expect(row).toMatchObject({
      customer_id: command.customerId,
      provider: "fake",
      status: "PENDING",
      recurring_capable: 0,
    });
    expect(row?.provider_method_ref).toBeNull();
  });

  it("replays the same authorization for the same idempotency key", async () => {
    const command = await beginCommand();
    const first = await beginRecurringAuthorization(env.DB, testRegistry(), command);
    const replay = await beginRecurringAuthorization(env.DB, testRegistry(), command);
    expect(first.ok && replay.ok).toBe(true);
    if (!first.ok || !replay.ok) return;
    expect(replay.value.authorizationId).toBe(first.value.authorizationId);
    const count = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM payment_authorization WHERE customer_id=?",
    )
      .bind(command.customerId)
      .first<{ count: number }>();
    expect(count?.count).toBe(1);
  });

  it("rejects a reused idempotency key with a different request", async () => {
    const command = await beginCommand();
    await beginRecurringAuthorization(env.DB, testRegistry(), command);
    const conflict = await beginRecurringAuthorization(env.DB, testRegistry(), {
      ...command,
      customerId: await seedCustomer(),
    });
    expect(conflict).toMatchObject({ ok: false, error: { code: "IDEMPOTENCY_CONFLICT" } });
  });

  it("fails closed when no provider is configured", async () => {
    const command = await beginCommand({ providerCode: "paymongo" });
    const result = await beginRecurringAuthorization(env.DB, new ProviderRegistry("test"), command);
    expect(result).toMatchObject({ ok: false, error: { code: "CONFIGURATION_ERROR" } });
    const count = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM payment_authorization WHERE customer_id=?",
    )
      .bind(command.customerId)
      .first<{ count: number }>();
    expect(count?.count).toBe(0);
  });
});

describe("completeRecurringAuthorization", () => {
  it("confirms a recurring-capable mandate as ACTIVE with its method identity", async () => {
    const command = await beginCommand();
    const registry = testRegistry();
    const begun = await beginRecurringAuthorization(env.DB, registry, command);
    if (!begun.ok) throw new Error("begin failed");
    const completed = await completeRecurringAuthorization(env.DB, registry, {
      customerId: command.customerId,
      authorizationId: begun.value.authorizationId,
      requestId: command.requestId,
    });
    expect(completed).toMatchObject({ ok: true, value: { provider: "fake" } });
    const row = await authorizationRow(begun.value.authorizationId);
    expect(row).toMatchObject({ status: "ACTIVE", recurring_capable: 1 });
    expect(row?.provider_method_ref).toContain("fake_method_");
    expect(row?.established_at).not.toBeNull();
  });

  it("is idempotent for an already-ACTIVE authorization", async () => {
    const command = await beginCommand();
    const registry = testRegistry();
    const begun = await beginRecurringAuthorization(env.DB, registry, command);
    if (!begun.ok) throw new Error("begin failed");
    const input = {
      customerId: command.customerId,
      authorizationId: begun.value.authorizationId,
      requestId: crypto.randomUUID(),
    };
    await completeRecurringAuthorization(env.DB, registry, input);
    const again = await completeRecurringAuthorization(env.DB, registry, input);
    expect(again).toMatchObject({ ok: true });
  });

  it("keeps PENDING when the customer has not finished authorization", async () => {
    const command = await beginCommand();
    const registry = testRegistry();
    const begun = await beginRecurringAuthorization(env.DB, registry, command);
    if (!begun.ok) throw new Error("begin failed");
    const reference = `fake_auth_${command.idempotencyKey}`;
    setFakeAuthorizationOutcome(registry.require("fake"), reference, {
      providerAuthorizationReference: reference,
      recurringCapable: true,
      providerMethodRef: null,
      status: "PENDING",
    });
    const result = await completeRecurringAuthorization(env.DB, registry, {
      customerId: command.customerId,
      authorizationId: begun.value.authorizationId,
      requestId: command.requestId,
    });
    expect(result).toMatchObject({ ok: false, error: { code: "AUTHORIZATION_PENDING" } });
    expect(await authorizationRow(begun.value.authorizationId)).toMatchObject({
      status: "PENDING",
    });
  });

  it("closes the attempt when the instrument cannot hold a recurring mandate", async () => {
    const command = await beginCommand();
    const registry = testRegistry();
    const begun = await beginRecurringAuthorization(env.DB, registry, command);
    if (!begun.ok) throw new Error("begin failed");
    const reference = `fake_auth_${command.idempotencyKey}`;
    setFakeAuthorizationOutcome(registry.require("fake"), reference, {
      providerAuthorizationReference: reference,
      recurringCapable: false,
      providerMethodRef: "fake_method_nonrecurring",
      status: "ACTIVE",
    });
    const result = await completeRecurringAuthorization(env.DB, registry, {
      customerId: command.customerId,
      authorizationId: begun.value.authorizationId,
      requestId: command.requestId,
    });
    expect(result).toMatchObject({ ok: false, error: { code: "RECURRING_NOT_CAPABLE" } });
    expect(await authorizationRow(begun.value.authorizationId)).toMatchObject({
      status: "REVOKED",
    });
  });

  it("refuses an authorization owned by another customer", async () => {
    const command = await beginCommand();
    const registry = testRegistry();
    const begun = await beginRecurringAuthorization(env.DB, registry, command);
    if (!begun.ok) throw new Error("begin failed");
    const result = await completeRecurringAuthorization(env.DB, registry, {
      customerId: await seedCustomer(),
      authorizationId: begun.value.authorizationId,
      requestId: command.requestId,
    });
    expect(result).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  });

  it("rejects a method identity already owned by a live authorization", async () => {
    const first = await beginCommand();
    const registry = testRegistry();
    const firstBegun = await beginRecurringAuthorization(env.DB, registry, first);
    if (!firstBegun.ok) throw new Error("begin failed");
    await completeRecurringAuthorization(env.DB, registry, {
      customerId: first.customerId,
      authorizationId: firstBegun.value.authorizationId,
      requestId: first.requestId,
    });

    const second = await beginCommand();
    const secondBegun = await beginRecurringAuthorization(env.DB, registry, second);
    if (!secondBegun.ok) throw new Error("begin failed");
    const reference = `fake_auth_${second.idempotencyKey}`;
    setFakeAuthorizationOutcome(registry.require("fake"), reference, {
      providerAuthorizationReference: reference,
      recurringCapable: true,
      // Same vaulted instrument as the first authorization.
      providerMethodRef: `fake_method_fake_auth_${first.idempotencyKey}`,
      status: "ACTIVE",
    });
    const result = await completeRecurringAuthorization(env.DB, registry, {
      customerId: second.customerId,
      authorizationId: secondBegun.value.authorizationId,
      requestId: second.requestId,
    });
    expect(result).toMatchObject({ ok: false, error: { code: "AUTHORIZATION_IDENTITY_IN_USE" } });
    expect(await authorizationRow(secondBegun.value.authorizationId)).toMatchObject({
      status: "REVOKED",
    });
  });
});
