import type { RpcResult } from "./common";
import type { AuthenticatedRequest, CustomerOrderView } from "./index";

export type RequestOrderCancellationRequest = AuthenticatedRequest & {
  orderId: string;
  reason: string;
  idempotencyKey: string;
  expectedVersion: number;
};

export type CancellationResult = {
  orderId: string;
  cancellationRequestedAt: string;
};

export type OrdersService = {
  listCustomerOrders(
    request: AuthenticatedRequest,
  ): Promise<RpcResult<ReadonlyArray<CustomerOrderView>>>;
  /** Canonical paid-order cancellation intent. Replaces the legacy generic advanceOrder CANCEL path (Plan 07). */
  requestCancellation(
    request: RequestOrderCancellationRequest,
  ): Promise<RpcResult<CancellationResult>>;
};
