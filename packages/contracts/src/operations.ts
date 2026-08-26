import type { RpcResult } from "./common";
import type {
  DeliveryCommandRequest,
  FulfillmentCommandRequest,
  InventoryAdjustmentRequest,
  InventoryAdjustmentResult,
  ProcurementCommandRequest,
  ReceivingCommandRequest,
  ReceivingCommandResult,
} from "./index";
import type { OperationsCommandState } from "./states";

export type OperationsCommandResult = { id: string; status: OperationsCommandState };

/**
 * Canonical operations target command groups. Every group is a typed domain
 * command with a stable idempotency key and required aggregate version;
 * free-form string actions have no place here.
 */
export type OperationsService = {
  adjustInventory(
    request: InventoryAdjustmentRequest,
  ): Promise<RpcResult<InventoryAdjustmentResult>>;
  createProcurementRequirement(
    request: ProcurementCommandRequest,
  ): Promise<RpcResult<OperationsCommandResult>>;
  receiveProcurement(request: ReceivingCommandRequest): Promise<RpcResult<ReceivingCommandResult>>;
  advanceFulfillment(
    request: FulfillmentCommandRequest,
  ): Promise<RpcResult<OperationsCommandResult>>;
  advanceDelivery(request: DeliveryCommandRequest): Promise<RpcResult<OperationsCommandResult>>;
};
