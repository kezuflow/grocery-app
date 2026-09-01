-- User-facing Admin geography uses the operational location name Central Cebu.
-- Stable identifiers and the parent Metro Cebu market remain unchanged so
-- historical snapshots, scope assignments, and multi-market support survive.
UPDATE fulfillment_location
SET name = 'Central Cebu',
    version = version + 1,
    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE id = 'location-cebu-central'
  AND name = 'Cebu Central';
