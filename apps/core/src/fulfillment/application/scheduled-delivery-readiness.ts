/**
 * Correlated against delivery_job AS job. The queue and booking admission use
 * the same received-goods evidence; this does not reserve or consume stock.
 * Packed orders use their immutable consumption evidence instead of deducting
 * their quantities a second time from the remaining cycle balance.
 */
export const scheduledDeliveryGoodsReadySql = `EXISTS (
  SELECT 1 FROM grocery_order grocery JOIN fulfillment_record fulfillment ON fulfillment.order_id=grocery.id
  WHERE grocery.id=job.order_id AND grocery.fulfillment_mode='SCHEDULED'
    AND grocery.cycle_id=job.cycle_id AND fulfillment.location_id=job.location_id
    AND ((grocery.status='FULFILLMENT_PENDING' AND fulfillment.status IN ('PICKING','READY_TO_PACK','PACKING'))
      OR (grocery.status='FULFILLMENT_READY' AND fulfillment.status='PACKED'))
    AND EXISTS (SELECT 1 FROM committed_demand WHERE order_id=job.order_id)
    AND NOT EXISTS (SELECT 1 FROM committed_demand WHERE order_id=job.order_id AND
      (status<>'OPEN' OR demand_basis<>'EXACT_PAID_LINE' OR delivery_cycle_id IS NOT job.cycle_id OR location_id<>job.location_id))
    AND NOT EXISTS (SELECT 1 FROM order_item line WHERE line.order_id=job.order_id AND NOT EXISTS
      (SELECT 1 FROM committed_demand demand WHERE demand.order_item_id=line.id AND demand.order_id=line.order_id AND demand.quantity=line.base_quantity))
    AND NOT EXISTS (SELECT 1 FROM paid_order_amendment_line line JOIN paid_order_amendment amendment ON amendment.id=line.amendment_id
      WHERE amendment.order_id=job.order_id AND amendment.status='COMMITTED' AND NOT EXISTS
        (SELECT 1 FROM committed_demand demand WHERE demand.amendment_line_id=line.id AND demand.order_id=amendment.order_id AND demand.quantity=line.base_quantity))
    AND NOT EXISTS (
      SELECT demand.inventory_pool_id FROM committed_demand demand WHERE demand.order_id=job.order_id
      GROUP BY demand.inventory_pool_id HAVING SUM(demand.quantity)<=0 OR
        CASE WHEN fulfillment.status='PACKED' THEN
          COALESCE((SELECT SUM(quantity_base) FROM cycle_goods_movement movement WHERE movement.order_id=job.order_id
            AND movement.cycle_id=job.cycle_id AND movement.location_id=job.location_id
            AND movement.inventory_pool_id=demand.inventory_pool_id AND movement.movement_type='PACKING'),0)<>SUM(demand.quantity)
        ELSE COALESCE((SELECT received_base-packed_base-surplus_released_base-disposed_base FROM cycle_goods_balance balance
          WHERE balance.cycle_id=job.cycle_id AND balance.location_id=job.location_id AND balance.inventory_pool_id=demand.inventory_pool_id),0)<SUM(demand.quantity) END
    )
)`;
