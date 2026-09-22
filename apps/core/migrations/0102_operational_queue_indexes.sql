-- FDP-5 measured queue paths: avoid the full Order sort and full Fulfillment scan.
-- These indexes do not change authority, snapshots, or write semantics.
CREATE INDEX grocery_order_commitment_queue_idx
  ON grocery_order(COALESCE(committed_at,created_at) DESC,id DESC);

CREATE INDEX fulfillment_record_location_order_idx
  ON fulfillment_record(location_id,order_id);
