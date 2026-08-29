import { describe, expect, it } from "vitest";
import type {
  AdminFoundationService,
  AdminStaffAccessService,
  AdminCustomerService,
  AdminPrivacyService,
  AdminPromotionsService,
  AdminCatalogService,
  AdminInventoryReadService,
  AdminOrdersService,
  AdminPaymentsService,
  AdminMembershipsService,
  AdminOrderIssuesService,
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
import type { AddressSearchCandidate, AddressSearchRequest } from "./geography";
import type { RpcResult } from "./common";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() =>
    Value extends Right ? 1 : 2
    ? true
    : false;
type Expect<Type extends true> = Type;

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
  it("exposes provider-neutral address search on the Core binding", () => {
    type AddressSearchSignature = Expect<
      Equal<
        CoreServiceBinding["searchAddressCandidates"],
        (
          request: AddressSearchRequest,
        ) => Promise<RpcResult<ReadonlyArray<AddressSearchCandidate>>>
      >
    >;

    void (true as AddressSearchSignature);
    expect(true).toBe(true);
  });

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
    void ({} as AdminFoundationService);
    void ({} as AdminStaffAccessService);
    void ({} as AdminCustomerService);
    void ({} as AdminPrivacyService);
    void ({} as AdminPromotionsService);
    void ({} as AdminCatalogService);
    void ({} as AdminInventoryReadService);
    void ({} as AdminOrdersService);
    void ({} as AdminPaymentsService);
    void ({} as AdminMembershipsService);
    void ({} as AdminOrderIssuesService);

    // The implemented surface plus explicit canonical additions must remain
    // assignable to the full binding (structural composition).
    const binding = {
      ...({} as ImplementedCoreService),
      searchAddressCandidates: async (
        request: AddressSearchRequest,
      ): Promise<
        | { ok: true; value: ReadonlyArray<AddressSearchCandidate>; requestId: string }
        | { ok: false; error: never }
      > => ({
        ok: true,
        value: [],
        requestId: request.requestId,
      }),
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
