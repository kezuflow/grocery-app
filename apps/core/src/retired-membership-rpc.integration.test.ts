import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import { createCoreRpcContext } from "./entrypoint/context";
import { createMembershipRpc } from "./entrypoint/membership-rpc";
import { createPaymentsRpc } from "./entrypoint/payments-rpc";

describe("Membership RPC adapter", () => {
  it("rejects retired enrollment and recurring authorization without provider or business effects", async () => {
    const context = createCoreRpcContext(env);
    vi.spyOn(context.access, "resolveAuthenticatedCustomer").mockResolvedValue({
      ok: true,
      requestId: "retired",
      value: {
        customerId: "retired-customer",
        principalId: "retired-principal",
        customerStatus: "active",
        user: {
          id: "retired-user",
          email: "retired@example.test",
          name: "Test",
          emailVerified: true,
        },
      },
    });
    const providers = vi.spyOn(context, "paymentProviders");
    const snapshot = () =>
      env.DB.prepare(
        "SELECT (SELECT COUNT(*) FROM subscription) subscriptions,(SELECT COUNT(*) FROM payment_intent) payments,(SELECT COUNT(*) FROM payment_authorization) authorizations",
      ).first();
    const before = await snapshot();
    const request = {
      headers: {},
      requestId: "retired",
      idempotencyKey: "retired-key",
      offerId: "offer-membership-monthly",
      returnUrl: "https://example.test/account",
      authorizationId: "retained-authorization",
    };
    const membership = createMembershipRpc(context),
      payments = createPaymentsRpc(context);
    for (const result of await Promise.all([
      membership.startTrial(request),
      membership.beginPaidEnrollment(request),
      membership.getOffer(request),
      membership.getMembershipExperience(request),
      membership.getSubscriptionEligibility(request),
      payments.beginRecurringAuthorization(request),
      payments.completeRecurringAuthorization(request),
    ]))
      expect(result).toMatchObject({
        ok: false,
        error: { code: "ILLEGAL_TRANSITION", requestId: "retired" },
      });
    expect(providers).not.toHaveBeenCalled();
    expect(await snapshot()).toEqual(before);
    vi.restoreAllMocks();
  });
});
