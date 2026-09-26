-- Scheduled purchase completion records one staff attestation for the exact
-- paid demand of a destination and delivery week. It is not a stock receipt.
CREATE TABLE scheduled_week_completion (
  cycle_id TEXT NOT NULL REFERENCES delivery_cycle(id) ON DELETE RESTRICT,
  location_id TEXT NOT NULL REFERENCES fulfillment_location(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL CHECK (version BETWEEN 1 AND 9007199254740991),
  demand_line_count INTEGER NOT NULL CHECK (demand_line_count > 0),
  paid_order_count INTEGER NOT NULL CHECK (paid_order_count > 0),
  total_quantity_base INTEGER NOT NULL CHECK (total_quantity_base > 0),
  purchase_completed_at INTEGER NOT NULL,
  purchase_actor_user_id TEXT NOT NULL,
  PRIMARY KEY (cycle_id, location_id)
) STRICT;
