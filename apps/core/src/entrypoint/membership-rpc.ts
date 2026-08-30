import type { StartTrialRequest, SubscriptionEligibilityRequest } from "@freshmarkets/contracts";
import { idempotencyKeySchema } from "@freshmarkets/validation";
import { getSubscriptionEligibility } from "../membership/application/subscription-eligibility";
import { startPromotionalTrial } from "../membership/application/start-promotional-trial";
import { authenticatedRequestSchema } from "../validation";
import type { CoreRpcContext } from "./context";
import { validationFailure } from "./validation-errors";

export function createMembershipRpc(context: CoreRpcContext) {
  return {
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
  };
}
