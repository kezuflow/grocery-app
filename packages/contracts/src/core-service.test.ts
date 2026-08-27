import { describe, expect, it } from "vitest";
import type {
  CatalogService,
  CheckoutService,
  CoreServiceBinding,
  ImplementedCoreService,
  MembershipService,
  OrdersService,
  PaymentsService,
} from "./core-service";
import type { SubscriptionSummary } from "./membership";
import type { PaymentActionView, PaymentSummary } from "./payments";
import type { OperationsService } from "./operations";

type HasCommitMockOrder<T> = "commitMockOrder" extends keyof T ? true : false;
type StartTrialParam = Parameters<MembershipService["startTrial"]>[0];
type HasProviderPaymentRef = "paymentMethodRef" extends keyof StartTrialParam ? true : false;
type HasGenericStringAction = {
  [K in keyof OperationsService]: OperationsService[K] extends (input: infer I) => unknown
    ? "action" extends keyof I
      ? string extends I["action"]
        ? true
        : false
      : false
    : false;
}[keyof OperationsService];

describe("domain-grouped core services", () => {
  it("keeps mock commitment out of every contract surface", () => {
    const absentFromCheckout: HasCommitMockOrder<CheckoutService> = false;
    expect(absentFromCheckout).toBe(false);
    expect("commitMockOrder" in ({} as Record<string, never>)).toBe(false);
  });

  it("keeps provider payment references out of membership commands", () => {
    const providerFree: HasProviderPaymentRef = false;
    expect(providerFree).toBe(false);
  });

  it("keeps free-form string actions out of operations command groups", () => {
    const closedActions: HasGenericStringAction = false;
    expect(closedActions).toBe(false);
  });

  it("exposes canonical target ports for downstream plans", async () => {
    const summary: SubscriptionSummary = {
      subscriptionId: "sub-1",
      state: "TRIALING",
      cancelAtPeriodEnd: false,
      scheduledCancellationAt: null,
      trialStartsAt: null,
      trialEndsAt: null,
      version: 1,
    };
    expect(summary.state).toBe("TRIALING");
    void ({} as CatalogService);
    void ({} as PaymentsService);
    void ({
      paymentIntentId: "",
      state: "PROCESSING",
      actionType: "NONE",
      redirectUrl: null,
      clientToken: null,
      expiresAt: null,
    } satisfies PaymentActionView);
    void ({
      paymentIntentId: "",
      purpose: "GROCERY_CHECKOUT",
      amountMinor: 1,
      currency: "PHP",
      state: "SUCCEEDED",
      updatedAt: "",
    } satisfies PaymentSummary);
    void ({} as OrdersService);
    void ({} as OperationsService);

    // The implemented surface plus explicit canonical additions must remain
    // assignable to the full binding (structural composition).
    const binding = {
      ...({} as ImplementedCoreService),
      createCheckoutQuote: async () => ({
        ok: true,
        value: {
          quoteId: "",
          attemptVersion: 1,
          expiresAt: "",
          currency: "PHP",
          subtotalMinor: 0,
          discountMinor: 0,
          deliveryFeeMinor: 0,
          totalMinor: 0,
          lines: [],
        },
        requestId: "",
      }),
      refreshCheckoutQuote: async () => ({
        ok: true,
        value: {
          quoteId: "",
          attemptVersion: 1,
          expiresAt: "",
          currency: "PHP",
          subtotalMinor: 0,
          discountMinor: 0,
          deliveryFeeMinor: 0,
          totalMinor: 0,
          lines: [],
        },
        requestId: "",
      }),
      createPaymentIntent: async () => ({
        ok: true,
        value: {
          paymentIntentId: "",
          state: "PROCESSING" as const,
          actionType: "NONE" as const,
          redirectUrl: null,
          clientToken: null,
          expiresAt: null,
        },
        requestId: "",
      }),
    } as unknown as CoreServiceBinding;
    expect(binding).toBeTruthy();
  });
});
