import type {
  FulfillmentCommandRequest,
  InventoryAdjustmentRequest,
  ProcurementCommandRequest,
  ReceivingCommandRequest,
} from "@freshmarkets/contracts";
import { adjustInventory } from "../inventory/application/adjust-inventory";
import { advanceFulfillment } from "../operations/application/advance-fulfillment";
import { createProcurementRequirement } from "../procurement/application/create-procurement-requirement";
import { receiveProcurement } from "../procurement/application/receive-procurement";
import {
  fulfillmentCommandSchema,
  inventoryAdjustmentSchema,
  procurementCommandSchema,
  receivingCommandSchema,
} from "../validation";
import type { CoreRpcContext } from "./context";
import { rpcFailure, validationFailure } from "./validation-errors";

export function createOperationsRpc(context: CoreRpcContext) {
  return {
    async adjustInventory(input: InventoryAdjustmentRequest) {
      const validation = inventoryAdjustmentSchema.safeParse(input);
      if (!validation.success) return validationFailure(input.requestId, validation.error);
      if (
        !(await context.access.requireOperationalAccess(
          input,
          "inventory.adjust",
          input.locationId,
        ))
      )
        return rpcFailure(
          "FORBIDDEN",
          "Inventory capability and location scope are required",
          input.requestId,
        );
      const actor = await context.access.session(input);
      if (!actor)
        return rpcFailure("UNAUTHENTICATED", "Authentication is required", input.requestId);
      return adjustInventory(context.env.DB, {
        requestId: input.requestId,
        actorId: actor.id,
        locationId: input.locationId,
        inventoryPoolId: input.inventoryPoolId,
        deltaBase: input.delta,
        reason: input.reason,
        expectedVersion: input.expectedVersion,
        idempotencyKey: input.idempotencyKey,
      });
    },

    async createProcurementRequirement(input: ProcurementCommandRequest) {
      const validation = procurementCommandSchema.safeParse(input);
      if (!validation.success) return validationFailure(input.requestId, validation.error);
      if (
        !(await context.access.requireOperationalAccess(
          input,
          "procurement.manage",
          input.locationId,
        ))
      )
        return rpcFailure(
          "FORBIDDEN",
          "Procurement capability and location scope are required",
          input.requestId,
        );
      return createProcurementRequirement(context.env.DB, input);
    },

    async receiveProcurement(input: ReceivingCommandRequest) {
      const validation = receivingCommandSchema.safeParse(input);
      if (!validation.success) return validationFailure(input.requestId, validation.error);
      const actor = await context.access.session(input);
      if (!actor)
        return rpcFailure("UNAUTHENTICATED", "Authentication is required", input.requestId);
      return receiveProcurement(
        context.env.DB,
        { ...input, actorId: actor.id },
        {
          authorize: (locationId) =>
            context.access.requireOperationalAccess(input, "procurement.manage", locationId),
        },
      );
    },

    async advanceFulfillment(input: FulfillmentCommandRequest) {
      const validation = fulfillmentCommandSchema.safeParse(input);
      if (!validation.success) return validationFailure(input.requestId, validation.error);
      return advanceFulfillment(context.env.DB, input, {
        authorize: (locationId) =>
          context.access.requireOperationalAccess(input, "fulfillment.manage", locationId),
      });
    },
  };
}
