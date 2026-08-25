import { describe, expect, it } from "vitest";
import type {
  CatalogService,
  CheckoutService,
  CoreServiceBinding,
  ImplementedCoreService,
  LegacyCommerceService,
  LegacyOperationsService,
  MembershipService,
  OrdersService,
  PaymentsService,
} from "./core-service";
import type { SubscriptionSummary } from "./membership";
import type { PaymentActionView, PaymentSummary } from "./payments";

type HasCommitMockOrder<T> = "commitMockOrder" extends keyof T ? true : false;
type StartTrialParam = Parameters<MembershipService["startTrial"]>[0];
type HasProviderPaymentRef = "paymentMethodRef" extends keyof StartTrialParam ? true : false;
type HasGenericStringAction = {
  [K in keyof LegacyOperationsService]: LegacyOperationsService[K] extends (
    input: infer I,
  ) => unknown
    ? "action" extends keyof I
      ? string extends I["action"]
        ? true
        : false
      : false
    : false;
}[keyof LegacyOperationsService];

describe("domain-grouped core services", () => {
  it("keeps sandbox commitment out of the canonical checkout target", () => {
    const absentFromCheckout: HasCommitMockOrder<CheckoutService> = false;
    const presentOnLegacy: HasCommitMockOrder<LegacyCommerceService> = true;
    expect(absentFromCheckout).toBe(false);
    expect(presentOnLegacy).toBe(true);
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
      paymentAttemptId: "",
      state: "PROCESSING",
      actionType: "NONE",
      actionUrl: null,
    } satisfies PaymentActionView);
    void ({
      paymentAttemptId: "",
      purpose: "ORDER_COMMITMENT",
      amountMinor: 1,
      currency: "PHP",
      state: "SUCCEEDED",
      updatedAt: "",
    } satisfies PaymentSummary);
    void ({} as OrdersService);
    void ({} as LegacyOperationsService);

    // The implemented surface must remain assignable to the full binding.
    const implemented = {} as ImplementedCoreService;
    const legacyCommerce = {} as LegacyCommerceService;
    const legacyOperations = {} as LegacyOperationsService;
    const cancellation = {} as Pick<OrdersService, "requestCancellation">;
    const binding: CoreServiceBinding = Object.assign(
      {},
      implemented,
      legacyCommerce,
      legacyOperations,
      cancellation,
    );
    expect(binding).toBeTruthy();
  });
});
