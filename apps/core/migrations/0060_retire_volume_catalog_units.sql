-- FreshMarkets currently sells groceries and packaged liquids by count, not by
-- authoritative volume. Preserve the historical VOLUME rows for compatibility
-- while removing them from active catalog authoring.

UPDATE unit
SET status = 'inactive',
    version = version + 1,
    updated_at = unixepoch('now') * 1000
WHERE dimension = 'VOLUME' AND status = 'active';
