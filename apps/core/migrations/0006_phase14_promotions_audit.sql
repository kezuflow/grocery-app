CREATE TABLE IF NOT EXISTS promotion (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  discount_minor INTEGER NOT NULL CHECK (discount_minor >= 0),
  minimum_minor INTEGER NOT NULL DEFAULT 0,
  starts_at INTEGER NOT NULL,
  ends_at INTEGER,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'INACTIVE'))
);
CREATE TABLE IF NOT EXISTS audit_event (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT,
  action TEXT NOT NULL,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  details_json TEXT NOT NULL,
  idempotency_key TEXT,
  occurred_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS audit_event_idempotency_unique
ON audit_event(action, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS audit_event_aggregate_idx
ON audit_event(aggregate_type, aggregate_id, occurred_at);
CREATE TABLE IF NOT EXISTS domain_event (
  id TEXT PRIMARY KEY,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  occurred_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS domain_event_type_time_idx ON domain_event(event_type, occurred_at);
CREATE TABLE IF NOT EXISTS refund (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL REFERENCES payment_attempt(id),
  order_id TEXT NOT NULL REFERENCES grocery_order(id),
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS order_amendment (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES grocery_order(id),
  payment_id TEXT REFERENCES payment_attempt(id),
  total_minor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS supplier (id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS purchase_order (id TEXT PRIMARY KEY, requirement_id TEXT NOT NULL REFERENCES procurement_requirement(id), supplier_id TEXT REFERENCES supplier(id), status TEXT NOT NULL, ordered_quantity INTEGER NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS supply_exception (id TEXT PRIMARY KEY, requirement_id TEXT NOT NULL REFERENCES procurement_requirement(id), kind TEXT NOT NULL, affected_quantity INTEGER NOT NULL, status TEXT NOT NULL, resolution TEXT, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS delivery_batch (id TEXT PRIMARY KEY, cycle_id TEXT NOT NULL REFERENCES delivery_cycle(id), status TEXT NOT NULL, rider_user_id TEXT, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS delivery_stop (id TEXT PRIMARY KEY, batch_id TEXT REFERENCES delivery_batch(id), delivery_job_id TEXT NOT NULL REFERENCES delivery_job(id), sequence INTEGER, status TEXT NOT NULL, proof_json TEXT, UNIQUE(batch_id, sequence));
INSERT OR IGNORE INTO permission (id, code, description, created_at) VALUES
  ('perm_order_manage', 'order:manage', 'Manage committed orders and refunds', unixepoch('now') * 1000),
  ('perm_inventory_manage', 'inventory:manage', 'Adjust location inventory', unixepoch('now') * 1000),
  ('perm_procurement_manage', 'procurement:manage', 'Manage procurement and receiving', unixepoch('now') * 1000),
  ('perm_fulfillment_manage', 'fulfillment:manage', 'Manage picking and packing', unixepoch('now') * 1000),
  ('perm_delivery_manage', 'delivery:manage', 'Manage dispatch and delivery', unixepoch('now') * 1000);
INSERT OR IGNORE INTO role_permission (role_id, permission_id)
SELECT 'role_operations_admin', id FROM permission WHERE code LIKE '%:manage';
INSERT OR IGNORE INTO promotion
  (id, code, name, discount_minor, minimum_minor, starts_at, ends_at, status)
VALUES
  ('promo-welcome-50', 'WELCOME50', 'Welcome discount', 5000, 50000, 0, NULL, 'ACTIVE');
