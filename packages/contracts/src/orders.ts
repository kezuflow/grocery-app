import type { RpcResult } from "./common";
import type { AuthenticatedRequest, CustomerOrderView } from "./index";

export type OrdersService = {
  listCustomerOrders(
    request: AuthenticatedRequest,
  ): Promise<RpcResult<ReadonlyArray<CustomerOrderView>>>;
};
