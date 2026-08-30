import type {
  BeginPaidEnrollmentRequest,
  CancelSubscriptionRequest,
  GetSubscriptionRequest,
  PauseSubscriptionRequest,
  ResumeSubscriptionRequest,
  StartTrialRequest,
  SubscriptionEligibilityRequest,
} from "@freshmarkets/contracts";
import {
  expectedVersionSchema,
  idempotencyKeySchema,
  identifierSchema,
  reasonSchema,
  z,
} from "@freshmarkets/validation";
import { getSubscriptionEligibility } from "../membership/application/subscription-eligibility";
import { startPromotionalTrial } from "../membership/application/start-promotional-trial";
import {
  beginPaidEnrollment,
  findSubscriptionIdForCustomer,
  getMembershipExperience,
  getMembershipOffer,
  getSubscriptionSummaryForCustomer,
} from "../membership/application/get-membership-experience";
import {
  cancelSubscription,
  pauseSubscription,
  resumeSubscription,
} from "../membership/application/change-subscription";
import { authenticatedRequestSchema } from "../validation";
import type { CoreRpcContext } from "./context";
import { validationFailure } from "./validation-errors";

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
      return getMembershipExperience(context.env.DB, {
        customerId: customer.value.customerId,
        requestId: input.requestId,
      });
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
      return getMembershipOffer(context.env.DB, {
        customerId: customer.value.customerId,
        requestId: input.requestId,
      });
    },

    async startTrial(input: StartTrialRequest) {
      const validation = authenticatedRequestSchema
        .extend({ idempotencyKey: idempotencyKeySchema })
        .safeParse(input);
      if (!validation.success) return validationFailure(input.requestId, validation.error);
      const customer = await context.access.resolveAuthenticatedCustomer(input);
      if (!customer.ok) return customer;
      return startPromotionalTrial(context.env.DB, {
        customerId: customer.value.customerId,
        idempotencyKey: validation.data.idempotencyKey,
        requestId: input.requestId,
      });
    },

    async getSubscriptionEligibility(input: SubscriptionEligibilityRequest) {
      const customer = await context.access.resolveAuthenticatedCustomer(input);
      if (!customer.ok) return customer;
      return getSubscriptionEligibility(context.env.DB, {
        ...input,
        customerId: customer.value.customerId,
      });
    },

    async beginPaidEnrollment(input: BeginPaidEnrollmentRequest) {
      const validation = authenticatedRequestSchema
        .extend({ offerId: identifierSchema, idempotencyKey: idempotencyKeySchema })
        .safeParse(input);
      if (!validation.success) return validationFailure(input.requestId, validation.error);
      const customer = await context.access.resolveAuthenticatedCustomer(input);
      if (!customer.ok) return customer;
      return beginPaidEnrollment(context.env.DB, {
        customerId: customer.value.customerId,
        offerId: validation.data.offerId,
        idempotencyKey: validation.data.idempotencyKey,
        requestId: input.requestId,
      });
    },

    async pauseSubscription(input: PauseSubscriptionRequest) {
      const validation = authenticatedRequestSchema
        .extend({
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
      return pauseSubscription(context.env.DB, {
        subscriptionId,
        reason: validation.data.reason,
        idempotencyKey: validation.data.idempotencyKey,
        expectedVersion: validation.data.expectedVersion,
        requestId: input.requestId,
      });
    },

    async resumeSubscription(input: ResumeSubscriptionRequest) {
      const validation = authenticatedRequestSchema
        .extend({ idempotencyKey: idempotencyKeySchema, expectedVersion: expectedVersionSchema })
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
      return resumeSubscription(context.env.DB, {
        subscriptionId,
        idempotencyKey: validation.data.idempotencyKey,
        expectedVersion: validation.data.expectedVersion,
        requestId: input.requestId,
      });
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
