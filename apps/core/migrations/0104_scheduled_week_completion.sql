-- Scheduled purchasing and physical packing are two staff attestations for one
-- destination and delivery week. This table does not represent received stock.
CREATE TABLE scheduled_week_completion (
  cycle_id TEXT NOT NULL REFERENCES delivery_cycle(id) ON DELETE RESTRICT,
  location_id TEXT NOT NULL REFERENCES fulfillment_location(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL CHECK (version BETWEEN 1 AND 9007199254740991),
  demand_line_count INTEGER NOT NULL CHECK (demand_line_count > 0),
  paid_order_count INTEGER NOT NULL CHECK (paid_order_count > 0),
  total_quantity_base INTEGER NOT NULL CHECK (total_quantity_base > 0),
  purchase_completed_at INTEGER NOT NULL,
  purchase_actor_user_id TEXT NOT NULL,
  packed_at INTEGER,
  packing_actor_user_id TEXT,
  CHECK ((packed_at IS NULL) = (packing_actor_user_id IS NULL)),
  PRIMARY KEY (cycle_id, location_id)
) STRICT;

-- The current Cebu week was configured at 11:59 PM for the last accepted
-- minute. Store its exclusive midnight boundary so payment and the one-hour
-- settlement gate agree with the 12:00 AM / 1:00 AM operating rule. The week
-- was already closed early, so this does not reopen customer admission.
UPDATE delivery_cycle SET cutoff_at=1790438400000,version=version+1
  WHERE id='97b4ee93-8305-498a-8ce5-b293a32c4422'
    AND cutoff_at=1790438340000 AND status='CUTOFF_REACHED'
    AND EXISTS(SELECT 1 FROM delivery_cycle_schedule s WHERE s.cycle_id=delivery_cycle.id
      AND s.procurement_at=1790438400000);
UPDATE checkout_quote SET cycle_snapshot_json=json_set(cycle_snapshot_json,
  '$.cutoffAt','2026-09-26T16:00:00.000Z')
  WHERE delivery_cycle_id='97b4ee93-8305-498a-8ce5-b293a32c4422'
    AND status IN ('ACTIVE','PAYMENT_PENDING')
    AND json_valid(cycle_snapshot_json)
    AND json_extract(cycle_snapshot_json,'$.cutoffAt')='2026-09-26T15:59:00.000Z'
    AND EXISTS(SELECT 1 FROM delivery_cycle c WHERE c.id=delivery_cycle_id
      AND c.cutoff_at=1790438400000 AND c.status='CUTOFF_REACHED');
UPDATE order_fulfillment_snapshot SET cutoff_at=1790438400000
  WHERE cycle_id='97b4ee93-8305-498a-8ce5-b293a32c4422'
    AND cutoff_at=1790438340000
    AND EXISTS(SELECT 1 FROM delivery_cycle c WHERE c.id=cycle_id
      AND c.cutoff_at=1790438400000 AND c.status='CUTOFF_REACHED');
