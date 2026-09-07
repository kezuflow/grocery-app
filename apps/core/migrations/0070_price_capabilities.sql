-- Explicit role assignment is required; catalog management does not grant price authority.
INSERT INTO permission (id, code, description, created_at) VALUES
  ('perm_prices_read_v1', 'prices.read', 'Read Global exact-location price history', unixepoch('now') * 1000),
  ('perm_prices_manage_v1', 'prices.manage', 'Manage Global exact-location prices', unixepoch('now') * 1000);
