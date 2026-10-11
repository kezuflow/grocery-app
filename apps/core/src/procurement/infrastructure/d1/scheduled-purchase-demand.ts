import { unrefundedOrderSql } from "../../../orders/infrastructure/d1/unrefunded-order";

export const scheduledPurchaseDemandSql = `SELECT d.* FROM committed_demand d
  JOIN grocery_order o ON o.id=d.order_id AND o.cycle_id=d.delivery_cycle_id
  WHERE d.status='OPEN' AND d.demand_basis='EXACT_PAID_LINE'
    AND o.fulfillment_mode='SCHEDULED'
    AND o.status NOT IN ('PENDING_PAYMENT','EXPIRED','CANCELLATION_REQUESTED')
    AND ${unrefundedOrderSql}
    AND NOT EXISTS (SELECT 1 FROM fulfillment_record f WHERE f.order_id=o.id AND f.status='CANCELED')`;
