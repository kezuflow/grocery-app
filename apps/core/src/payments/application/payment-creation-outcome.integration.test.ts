import { env } from "cloudflare:workers";
import { it, expect, vi } from "vitest";
import { createPayment, type CreatePaymentCommand } from "./create-payment";
import { createPayMongoPaymentProvider } from "../infrastructure/providers/paymongo-payment-provider";
import { ProviderRegistry } from "../infrastructure/providers/provider-registry";
it("records an explicit provider rejection as failed without an unknown-outcome case", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json({ errors: [{ code: "parameter_invalid" }] }, { status: 422 }));
  const provider = createPayMongoPaymentProvider({
    secretKey: "sk_test_freshmarkets",
    webhookSecret: "whsk_test_freshmarkets",
    fetcher,
  });
  const registry = new ProviderRegistry("test", [provider]),
    input = await command({});
  expect(await createPayment(env.DB, registry, input)).toMatchObject({
    ok: false,
    error: { code: "PAYMENT_FAILED" },
  });
  expect(
    await env.DB.prepare("SELECT status FROM payment_intent WHERE idempotency_key=?")
      .bind(input.idempotencyKey)
      .first(),
  ).toEqual({ status: "FAILED" });
  expect(
    await env.DB.prepare(
      "SELECT COUNT(*) n FROM payment_reconciliation_case c JOIN payment_intent p ON p.id=c.payment_intent_id WHERE p.idempotency_key=?",
    )
      .bind(input.idempotencyKey)
      .first(),
  ).toEqual({ n: 0 });
  await createPayment(env.DB, registry, input);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
async function command(overrides: Partial<CreatePaymentCommand>): Promise<CreatePaymentCommand> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO customer(id,auth_user_id,status,created_at,updated_at) VALUES (?,?,'active',?,?)",
  )
    .bind(id, `auth-${id}`, Date.now(), Date.now())
    .run();
  return {
    purpose: "GROCERY_CHECKOUT",
    subjectType: "checkout_quote",
    subjectId: crypto.randomUUID(),
    customerId: id,
    amountMinor: 29900,
    currency: "PHP",
    providerCode: "paymongo",
    returnUrl: "https://app.example/checkout",
    idempotencyKey: crypto.randomUUID(),
    requestId: crypto.randomUUID(),
    ...overrides,
  };
}
it.each(["timeout", "server", "invalid-json", "invalid-resource"] as const)(
  "retains PayMongo %s creation as unknown and never resubmits on replay",
  async (kind) => {
    const fetcher = vi.fn<typeof fetch>();
    if (kind === "timeout") fetcher.mockRejectedValue(new Error("TEST_RESPONSE_LOST"));
    if (kind === "server")
      fetcher.mockResolvedValue(
        Response.json({ errors: [{ code: "server_error" }] }, { status: 500 }),
      );
    if (kind === "invalid-json") fetcher.mockResolvedValue(new Response("unreadable"));
    if (kind === "invalid-resource") fetcher.mockResolvedValue(Response.json({ data: {} }));
    const provider = createPayMongoPaymentProvider({
      secretKey: "sk_test_freshmarkets",
      webhookSecret: "whsk_test_freshmarkets",
      fetcher,
    });
    const registry = new ProviderRegistry("test", [provider]);
    const input = await command({
      purpose: "GROCERY_CHECKOUT",
      subjectType: "checkout_quote",
      subjectId: crypto.randomUUID(),
      providerCode: "paymongo",
    });
    expect(await createPayment(env.DB, registry, input)).toMatchObject({
      ok: false,
      error: { code: "PAYMENT_OUTCOME_UNRESOLVED" },
    });
    const row = await env.DB.prepare("SELECT id,status FROM payment_intent WHERE idempotency_key=?")
      .bind(input.idempotencyKey)
      .first<{ id: string; status: string }>();
    expect(row?.status).toBe("INITIATED");
    expect(
      await env.DB.prepare(
        "SELECT category,status FROM payment_reconciliation_case WHERE payment_intent_id=?",
      )
        .bind(row?.id)
        .first(),
    ).toEqual({ category: "AMBIGUOUS_OUTCOME", status: "OPEN" });
    await createPayment(env.DB, registry, input);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(
      await env.DB.prepare("SELECT COUNT(*) n FROM payment_attempt WHERE payment_intent_id=?")
        .bind(row?.id)
        .first(),
    ).toEqual({ n: 0 });
  },
);
