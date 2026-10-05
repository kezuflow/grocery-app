import type {
  AdminOrderStatusOverrideRequest,
  AdminOrderStatusOverrideResult,
  RpcResult,
} from "@freshmarkets/contracts";
import { overrideOrderStatus } from "../../orders/application/override-order-status";
import {
  resolveFinanceAdministrationAccess,
  type FinanceAdministrationDeps,
} from "./finance-administration-access";

export async function overrideAdminOrderStatus(
  deps: FinanceAdministrationDeps,
  request: AdminOrderStatusOverrideRequest,
): Promise<RpcResult<AdminOrderStatusOverrideResult>> {
  const access = await resolveFinanceAdministrationAccess(deps, request, "orders.manage");
  if (!access.ok) return access;
  return overrideOrderStatus(deps.db, request, access.value);
}
