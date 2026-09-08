import type { InventoryTransfersService } from "@freshmarkets/contracts";
import { z } from "@freshmarkets/validation";
import { inventoryTransfers } from "../inventory/application/inventory-transfers";
import type { CoreRpcContext } from "./context";
import { rpcFailure } from "./validation-errors";

export function createInventoryTransfersRpc(context: CoreRpcContext): InventoryTransfersService {
  return {
    async listInventoryTransfers({ headers, requestId, ...payload }) {
      const actor = await context.access.session({ headers, requestId });
      if (!actor) return rpcFailure("UNAUTHENTICATED", "Authentication is required", requestId);
      return inventoryTransfers(context.env.DB, actor.id, requestId, context.access.now()).list(
        payload,
      );
    },
    async getInventoryTransfer({ headers, requestId, transferId }) {
      const actor = await context.access.session({ headers, requestId });
      if (!actor) return rpcFailure("UNAUTHENTICATED", "Authentication is required", requestId);
      if (!z.string().min(1).max(200).safeParse(transferId).success)
        return rpcFailure("VALIDATION_FAILED", "Transfer ID is required", requestId);
      return inventoryTransfers(context.env.DB, actor.id, requestId, context.access.now()).get(
        transferId,
      );
    },
    async getInventoryTransferOptions({ headers, requestId, ...payload }) {
      const actor = await context.access.session({ headers, requestId });
      if (!actor) return rpcFailure("UNAUTHENTICATED", "Authentication is required", requestId);
      return inventoryTransfers(context.env.DB, actor.id, requestId, context.access.now()).options(
        payload,
      );
    },
    async createInventoryTransfer({ headers, requestId, ...payload }) {
      const actor = await context.access.session({ headers, requestId });
      if (!actor) return rpcFailure("UNAUTHENTICATED", "Authentication is required", requestId);
      return inventoryTransfers(context.env.DB, actor.id, requestId, context.access.now()).create(
        payload,
      );
    },
    async dispatchInventoryTransfer({ headers, requestId, ...payload }) {
      const actor = await context.access.session({ headers, requestId });
      if (!actor) return rpcFailure("UNAUTHENTICATED", "Authentication is required", requestId);
      return inventoryTransfers(context.env.DB, actor.id, requestId, context.access.now()).dispatch(
        payload,
      );
    },
    async receiveInventoryTransfer({ headers, requestId, ...payload }) {
      const actor = await context.access.session({ headers, requestId });
      if (!actor) return rpcFailure("UNAUTHENTICATED", "Authentication is required", requestId);
      return inventoryTransfers(context.env.DB, actor.id, requestId, context.access.now()).receive(
        payload,
      );
    },
    async cancelInventoryTransfer({ headers, requestId, ...payload }) {
      const actor = await context.access.session({ headers, requestId });
      if (!actor) return rpcFailure("UNAUTHENTICATED", "Authentication is required", requestId);
      return inventoryTransfers(context.env.DB, actor.id, requestId, context.access.now()).cancel(
        payload,
      );
    },
  };
}
