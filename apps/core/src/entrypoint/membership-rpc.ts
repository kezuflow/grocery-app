import type {
  BeginPaidEnrollmentRequest,
  CancelSubscriptionRequest,
  GetSubscriptionRequest,
  StartTrialRequest,
  SubscriptionEligibilityRequest,
} from "@freshmarkets/contracts";
import {
  expectedVersionSchema,
  idempotencyKeySchema,
  reasonSchema,
  z,
} from "@freshmarkets/validation";
import {
  findSubscriptionIdForCustomer,
  getSubscriptionSummaryForCustomer,
} from "../membership/application/get-membership-experience";
import { cancelSubscription } from "../membership/application/change-subscription";
import { authenticatedRequestSchema } from "../validation";
import type { CoreRpcContext } from "./context";
import { validationFailure } from "./validation-errors";
import { cancelProviderSubscription } from "../payments/application/cancel-provider-subscription";

export function createMembershipRpc(context: CoreRpcContext) {
  async function customerFor(input: GetSubscriptionRequest) {
    const validation = authenticatedRequestSchema.safeParse(input);
    if (!validation.success) return validationFailure(input.requestId, validation.error);
    return context.access.resolveAuthenticatedCustomer(input);
  }

  return {
    async getMembershipExperience(input: GetSubscriptionRequest) {
      const customer = await customerFor(input);
      if (!customer.ok) return customer;
      return {
        ok: false as const,
        error: {
          code: "ILLEGAL_TRANSITION" as const,
          message: "Membership enrollment is no longer available",
          requestId: input.requestId,
        },
      };
    },

    async getSubscriptionSummary(input: GetSubscriptionRequest) {
      const customer = await customerFor(input);
      if (!customer.ok) return customer;
      return getSubscriptionSummaryForCustomer(context.env.DB, {
        customerId: customer.value.customerId,
        requestId: input.requestId,
      });
    },

    async getOffer(input: GetSubscriptionRequest) {
      const customer = await customerFor(input);
      if (!customer.ok) return customer;
      return {
        ok: false as const,
        error: {
          code: "ILLEGAL_TRANSITION" as const,
          message: "Membership enrollment is no longer available",
          requestId: input.requestId,
        },
      };
    },

    async startTrial(input: StartTrialRequest) {
      const customer = await customerFor(input);
      if (!customer.ok) return customer;
      return {
        ok: false as const,
        error: {
          code: "ILLEGAL_TRANSITION" as const,
          message: "Membership enrollment is no longer available",
          requestId: input.requestId,
        },
      };
    },

    async getSubscriptionEligibility(input: SubscriptionEligibilityRequest) {
      const customer = await customerFor(input);
      if (!customer.ok) return customer;
      return {
        ok: false as const,
        error: {
          code: "ILLEGAL_TRANSITION" as const,
          message: "Membership enrollment is no longer available",
          requestId: input.requestId,
        },
      };
    },

    async beginPaidEnrollment(input: BeginPaidEnrollmentRequest) {
      const customer = await customerFor(input);
      if (!customer.ok) return customer;
      return {
        ok: false as const,
        error: {
          code: "ILLEGAL_TRANSITION" as const,
          message: "Membership enrollment is no longer available",
          requestId: input.requestId,
        },
      };
    },

    async cancelSubscription(input: CancelSubscriptionRequest) {
      const validation = authenticatedRequestSchema
        .extend({
          timing: z.enum(["IMMEDIATE", "PERIOD_END"]),
          reason: reasonSchema.optional(),
          idempotencyKey: idempotencyKeySchema,
          expectedVersion: expectedVersionSchema,
        })
        .safeParse(input);
      if (!validation.success) return validationFailure(input.requestId, validation.error);
      const customer = await context.access.resolveAuthenticatedCustomer(input);
      if (!customer.ok) return customer;
      const subscriptionId = await findSubscriptionIdForCustomer(
        context.env.DB,
        customer.value.customerId,
      );
      if (!subscriptionId)
        return {
          ok: false as const,
          error: {
            code: "NOT_FOUND" as const,
            message: "Subscription not found",
            requestId: input.requestId,
          },
        };
      if (validation.data.timing === "IMMEDIATE") {
        const providerCancellation = await cancelProviderSubscription(
          context.env.DB,
          context.paymentProviders(),
          subscriptionId,
        );
        if (!providerCancellation.ok)
          return {
            ok: false as const,
            error: {
              code: "PROVIDER_LOOKUP_FAILED" as const,
              message: `PayMongo cancellation could not be confirmed: ${providerCancellation.errorCode}`,
              requestId: input.requestId,
            },
          };
      }
      return cancelSubscription(context.env.DB, {
        subscriptionId,
        timing: validation.data.timing,
        reason: validation.data.reason,
        idempotencyKey: validation.data.idempotencyKey,
        expectedVersion: validation.data.expectedVersion,
        requestId: input.requestId,
      });
    },
  };
}
