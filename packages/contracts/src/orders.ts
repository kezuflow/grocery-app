import type { RpcResult } from "./common";
import type { AuthenticatedRequest } from "./auth";
import type { ImplementedOrderState } from "./states";

export type CustomerOrderView = {
  id: string;
  status: ImplementedOrderState;
  deliveryDate: string;
  totalMinor: number;
  currency: string;
  itemCount: number;
};

export type AdminOrderCommandRequest = AuthenticatedRequest & {
  orderId: string;
  action: "CANCEL" | "REFUND";
  reason: string;
  idempotencyKey: string;
  expectedVersion: number;
};

export type OrdersService = {
  listCustomerOrders(
    request: AuthenticatedRequest,
  ): Promise<RpcResult<ReadonlyArray<CustomerOrderView>>>;
};
