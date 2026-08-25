CREATE TABLE IF NOT EXISTS user (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  email_verified INTEGER NOT NULL DEFAULT 0,
  image TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS user_email_unique ON user(email);

CREATE TABLE IF NOT EXISTS session (
  id TEXT PRIMARY KEY NOT NULL,
  expires_at INTEGER NOT NULL,
  token TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS session_token_unique ON session(token);
CREATE INDEX IF NOT EXISTS session_user_id_idx ON session(user_id);

CREATE TABLE IF NOT EXISTS account (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  access_token TEXT,
  refresh_token TEXT,
  id_token TEXT,
  access_token_expires_at INTEGER,
  refresh_token_expires_at INTEGER,
  scope TEXT,
  password TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS account_user_id_idx ON account(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS account_provider_identity_unique ON account(provider_id, account_id);

CREATE TABLE IF NOT EXISTS verification (
  id TEXT PRIMARY KEY NOT NULL,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER,
  updated_at INTEGER
);
CREATE INDEX IF NOT EXISTS verification_identifier_idx ON verification(identifier);

CREATE TABLE IF NOT EXISTS customer_principal (
  id TEXT PRIMARY KEY NOT NULL,
  auth_user_id TEXT NOT NULL UNIQUE REFERENCES user(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS staff_identity (
  id TEXT PRIMARY KEY NOT NULL,
  auth_user_id TEXT NOT NULL UNIQUE REFERENCES user(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS role (
  id TEXT PRIMARY KEY NOT NULL,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS permission (
  id TEXT PRIMARY KEY NOT NULL,
  code TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS role_permission (
  role_id TEXT NOT NULL REFERENCES role(id) ON DELETE CASCADE,
  permission_id TEXT NOT NULL REFERENCES permission(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS staff_role (
  staff_id TEXT NOT NULL REFERENCES staff_identity(id) ON DELETE CASCADE,
  role_id TEXT NOT NULL REFERENCES role(id) ON DELETE CASCADE,
  PRIMARY KEY (staff_id, role_id)
);

CREATE TABLE IF NOT EXISTS staff_scope (
  id TEXT PRIMARY KEY NOT NULL,
  staff_id TEXT NOT NULL REFERENCES staff_identity(id) ON DELETE CASCADE,
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('global', 'market', 'location')),
  market_id TEXT,
  location_id TEXT,
  UNIQUE (staff_id, scope_kind, market_id, location_id),
  CHECK ((scope_kind = 'global' AND market_id IS NULL AND location_id IS NULL) OR
         (scope_kind = 'market' AND market_id IS NOT NULL AND location_id IS NULL) OR
         (scope_kind = 'location' AND market_id IS NULL AND location_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS staff_scope_staff_idx ON staff_scope(staff_id);

INSERT OR IGNORE INTO permission (id, code, description, created_at) VALUES
  ('perm_staff_read', 'staff:read', 'Read staff identities', unixepoch('now') * 1000),
  ('perm_staff_manage', 'staff:manage', 'Manage staff identities', unixepoch('now') * 1000),
  ('perm_rbac_read', 'rbac:read', 'Read roles and permissions', unixepoch('now') * 1000),
  ('perm_rbac_manage', 'rbac:manage', 'Manage roles and permissions', unixepoch('now') * 1000),
  ('perm_location_read', 'location:read', 'Read location-scoped operations', unixepoch('now') * 1000),
  ('perm_location_manage', 'location:manage', 'Manage location-scoped operations', unixepoch('now') * 1000);

INSERT OR IGNORE INTO role (id, code, name, created_at) VALUES
  ('role_operations_admin', 'operations_admin', 'Operations administrator', unixepoch('now') * 1000),
  ('role_operations_viewer', 'operations_viewer', 'Operations viewer', unixepoch('now') * 1000);

INSERT OR IGNORE INTO role_permission (role_id, permission_id)
SELECT 'role_operations_admin', id FROM permission;
INSERT OR IGNORE INTO role_permission (role_id, permission_id)
SELECT 'role_operations_viewer', id FROM permission WHERE code IN ('staff:read', 'rbac:read', 'location:read');
