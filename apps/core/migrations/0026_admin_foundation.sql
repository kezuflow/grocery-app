-- Admin Foundation Slice 1: canonical dot-form capability seeds, additive
-- legacy assignment mapping, and Audit query columns/indexes.
-- Historical colon-form permission rows and their assignments are preserved.

INSERT OR IGNORE INTO permission (id, code, description, created_at) VALUES
  ('perm_customers_read_v1', 'customers.read', 'Read customer CRM records', unixepoch('now') * 1000),
  ('perm_customers_manage_v1', 'customers.manage', 'Manage customer CRM records', unixepoch('now') * 1000),
  ('perm_orders_read_v1', 'orders.read', 'Read orders', unixepoch('now') * 1000),
  ('perm_orders_manage_v1', 'orders.manage', 'Manage orders', unixepoch('now') * 1000),
  ('perm_catalog_read_v1', 'catalog.read', 'Read catalog', unixepoch('now') * 1000),
  ('perm_catalog_manage_v1', 'catalog.manage', 'Manage catalog', unixepoch('now') * 1000),
  ('perm_inventory_read_v1', 'inventory.read', 'Read location inventory', unixepoch('now') * 1000),
  ('perm_inventory_adjust_v1', 'inventory.adjust', 'Adjust location inventory', unixepoch('now') * 1000),
  ('perm_promotions_read_v1', 'promotions.read', 'Read promotions', unixepoch('now') * 1000),
  ('perm_promotions_manage_v1', 'promotions.manage', 'Manage promotions', unixepoch('now') * 1000),
  ('perm_memberships_read_v1', 'memberships.read', 'Read memberships', unixepoch('now') * 1000),
  ('perm_memberships_manage_v1', 'memberships.manage', 'Manage memberships', unixepoch('now') * 1000),
  ('perm_payments_read_v1', 'payments.read', 'Read payments', unixepoch('now') * 1000),
  ('perm_payments_manage_v1', 'payments.manage', 'Manage payments', unixepoch('now') * 1000),
  ('perm_refunds_manage_v1', 'refunds.manage', 'Manage refunds', unixepoch('now') * 1000),
  ('perm_fulfillment_read_v1', 'fulfillment.read', 'Read fulfillment work', unixepoch('now') * 1000),
  ('perm_fulfillment_manage_v1', 'fulfillment.manage', 'Manage picking and packing', unixepoch('now') * 1000),
  ('perm_delivery_read_v1', 'delivery.read', 'Read delivery operations', unixepoch('now') * 1000),
  ('perm_delivery_manage_v1', 'delivery.manage', 'Manage dispatch and delivery', unixepoch('now') * 1000),
  ('perm_procurement_read_v1', 'procurement.read', 'Read procurement and receiving', unixepoch('now') * 1000),
  ('perm_procurement_manage_v1', 'procurement.manage', 'Manage procurement and receiving', unixepoch('now') * 1000),
  ('perm_analytics_read_v1', 'analytics.read', 'Read approved analytics metrics', unixepoch('now') * 1000),
  ('perm_staff_read_v1', 'staff.read', 'Read staff identities and access', unixepoch('now') * 1000),
  ('perm_staff_manage_v1', 'staff.manage', 'Manage staff identities and access', unixepoch('now') * 1000),
  ('perm_audit_read_v1', 'audit.read', 'Read the audit log', unixepoch('now') * 1000),
  ('perm_settings_read_v1', 'settings.read', 'Read operational settings', unixepoch('now') * 1000),
  ('perm_settings_manage_v1', 'settings.manage', 'Manage operational settings', unixepoch('now') * 1000);

-- Map legacy assignments to canonical capabilities for every holding role.
-- Historical permission rows and assignments remain untouched.
INSERT OR IGNORE INTO role_permission (role_id, permission_id)
SELECT rp.role_id, 'perm_staff_read_v1'
FROM role_permission rp JOIN permission p ON p.id = rp.permission_id
WHERE p.code = 'staff:read';

INSERT OR IGNORE INTO role_permission (role_id, permission_id)
SELECT rp.role_id, 'perm_staff_manage_v1'
FROM role_permission rp JOIN permission p ON p.id = rp.permission_id
WHERE p.code = 'staff:manage';

INSERT OR IGNORE INTO role_permission (role_id, permission_id)
SELECT rp.role_id, 'perm_orders_read_v1'
FROM role_permission rp JOIN permission p ON p.id = rp.permission_id
WHERE p.code = 'order:manage';

INSERT OR IGNORE INTO role_permission (role_id, permission_id)
SELECT rp.role_id, 'perm_orders_manage_v1'
FROM role_permission rp JOIN permission p ON p.id = rp.permission_id
WHERE p.code = 'order:manage';

INSERT OR IGNORE INTO role_permission (role_id, permission_id)
SELECT rp.role_id, 'perm_inventory_read_v1'
FROM role_permission rp JOIN permission p ON p.id = rp.permission_id
WHERE p.code = 'inventory:manage';

INSERT OR IGNORE INTO role_permission (role_id, permission_id)
SELECT rp.role_id, 'perm_inventory_adjust_v1'
FROM role_permission rp JOIN permission p ON p.id = rp.permission_id
WHERE p.code = 'inventory:manage';

INSERT OR IGNORE INTO role_permission (role_id, permission_id)
SELECT rp.role_id, 'perm_procurement_read_v1'
FROM role_permission rp JOIN permission p ON p.id = rp.permission_id
WHERE p.code = 'procurement:manage';

INSERT OR IGNORE INTO role_permission (role_id, permission_id)
SELECT rp.role_id, 'perm_procurement_manage_v1'
FROM role_permission rp JOIN permission p ON p.id = rp.permission_id
WHERE p.code = 'procurement:manage';

INSERT OR IGNORE INTO role_permission (role_id, permission_id)
SELECT rp.role_id, 'perm_fulfillment_read_v1'
FROM role_permission rp JOIN permission p ON p.id = rp.permission_id
WHERE p.code = 'fulfillment:manage';

INSERT OR IGNORE INTO role_permission (role_id, permission_id)
SELECT rp.role_id, 'perm_fulfillment_manage_v1'
FROM role_permission rp JOIN permission p ON p.id = rp.permission_id
WHERE p.code = 'fulfillment:manage';

INSERT OR IGNORE INTO role_permission (role_id, permission_id)
SELECT rp.role_id, 'perm_delivery_read_v1'
FROM role_permission rp JOIN permission p ON p.id = rp.permission_id
WHERE p.code = 'delivery:manage';

INSERT OR IGNORE INTO role_permission (role_id, permission_id)
SELECT rp.role_id, 'perm_delivery_manage_v1'
FROM role_permission rp JOIN permission p ON p.id = rp.permission_id
WHERE p.code = 'delivery:manage';

-- Canonical operational grants: the admin role holds operational read/manage;
-- the viewer role holds only the operational read half.
INSERT OR IGNORE INTO role_permission (role_id, permission_id)
SELECT 'role_operations_admin', id FROM permission
WHERE code IN (
  'orders.read', 'orders.manage',
  'inventory.read', 'inventory.adjust',
  'procurement.read', 'procurement.manage',
  'fulfillment.read', 'fulfillment.manage',
  'delivery.read', 'delivery.manage',
  'staff.read', 'staff.manage'
);

INSERT OR IGNORE INTO role_permission (role_id, permission_id)
SELECT 'role_operations_viewer', id FROM permission
WHERE code IN (
  'orders.read',
  'inventory.read',
  'procurement.read',
  'fulfillment.read',
  'delivery.read'
);

-- Audit query fields (additive; details_json is retained for compatibility).
ALTER TABLE audit_event ADD COLUMN market_id TEXT;
ALTER TABLE audit_event ADD COLUMN location_id TEXT;
ALTER TABLE audit_event ADD COLUMN reason TEXT;
ALTER TABLE audit_event ADD COLUMN before_json TEXT;
ALTER TABLE audit_event ADD COLUMN after_json TEXT;
ALTER TABLE audit_event ADD COLUMN correlation_id TEXT;

CREATE INDEX IF NOT EXISTS audit_event_occurred_idx ON audit_event(occurred_at, id);
CREATE INDEX IF NOT EXISTS audit_event_aggregate_idx ON audit_event(aggregate_type, aggregate_id, occurred_at);
CREATE INDEX IF NOT EXISTS audit_event_actor_idx ON audit_event(actor_user_id, occurred_at);
CREATE INDEX IF NOT EXISTS audit_event_market_idx ON audit_event(market_id, occurred_at);
CREATE INDEX IF NOT EXISTS audit_event_location_idx ON audit_event(location_id, occurred_at);
