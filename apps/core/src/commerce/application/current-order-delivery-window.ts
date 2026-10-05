/** Operational cycle edits do not rewrite the customer's original paid promise.
 * Only a recorded cycle schedule correction opts an Order into the current plan.
 * Individual delivery agreements remain authoritative in the owning Delivery queries.
 */
export const currentOrderDeliveryWindowSql = `SELECT saved.order_id,saved.cycle_id,saved.window_id,
  CASE WHEN edited.cycle_id IS NOT NULL THEN current.name ELSE saved.name END name,
  saved.timezone,
  CASE WHEN edited.cycle_id IS NOT NULL THEN current.starts_at ELSE saved.starts_at END starts_at,
  CASE WHEN edited.cycle_id IS NOT NULL THEN current.ends_at ELSE saved.ends_at END ends_at,
  CASE WHEN edited.cycle_id IS NOT NULL THEN schedule.pickup_at ELSE saved.pickup_at END pickup_at,
  saved.created_at
  FROM order_delivery_window_snapshot saved
  LEFT JOIN delivery_cycle_window current ON current.id=saved.window_id AND current.cycle_id=saved.cycle_id
  LEFT JOIN delivery_cycle_schedule schedule ON schedule.cycle_id=saved.cycle_id
  LEFT JOIN (SELECT aggregate_id cycle_id FROM audit_event
    WHERE aggregate_type='delivery_cycle' AND action='delivery_cycle.schedule_edited' GROUP BY aggregate_id) edited
    ON edited.cycle_id=saved.cycle_id AND current.id IS NOT NULL AND schedule.cycle_id IS NOT NULL`;
