-- Scheduled cadence is configuration, not a fulfillment mode. Preserve the
-- existing single effective location configuration while making its cadence
-- explicit and queryable by Admin.
ALTER TABLE fulfillment_location_mode ADD COLUMN cadence TEXT
  CHECK (cadence IS NULL OR cadence IN ('WEEKLY'));

UPDATE fulfillment_location_mode
SET cadence = CASE WHEN active_mode = 'SCHEDULED' THEN 'WEEKLY' ELSE NULL END;
