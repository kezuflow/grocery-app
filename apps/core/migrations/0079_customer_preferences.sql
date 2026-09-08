-- Existing customers have no recorded language preference or promotional opt-in.
ALTER TABLE customer ADD COLUMN preferred_language TEXT
  CHECK (preferred_language IS NULL OR (typeof(preferred_language)='text' AND length(trim(preferred_language)) BETWEEN 1 AND 80));
ALTER TABLE customer ADD COLUMN promotional_emails INTEGER NOT NULL DEFAULT 0
  CHECK (typeof(promotional_emails)='integer' AND promotional_emails IN (0,1));
