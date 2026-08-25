-- Phase 4A: link the commerce customer aggregate to the application principal.
-- customer.auth_user_id is retained as a legacy compatibility column from 0005;
-- Core no longer treats it as an authentication or authorization authority.
ALTER TABLE customer ADD COLUMN principal_id TEXT REFERENCES customer_principal(id);

UPDATE customer
SET principal_id = (
  SELECT cp.id
  FROM customer_principal cp
  WHERE cp.auth_user_id = customer.auth_user_id
)
WHERE principal_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS customer_principal_unique
  ON customer(principal_id)
  WHERE principal_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS customer_principal_status_idx
  ON customer_principal(status, updated_at);
