-- One-use setup evidence. Existing staff access and all retained data are unchanged.
CREATE TABLE initial_administrator_setup (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  auth_user_id TEXT NOT NULL REFERENCES user(id) ON DELETE RESTRICT,
  staff_id TEXT NOT NULL REFERENCES staff_identity(id) ON DELETE RESTRICT,
  role_id TEXT NOT NULL REFERENCES role(id) ON DELETE RESTRICT,
  capability_codes_json TEXT NOT NULL CHECK (json_valid(capability_codes_json)),
  completed_at INTEGER NOT NULL CHECK (completed_at BETWEEN 0 AND 9007199254740991)
) STRICT;
CREATE TRIGGER initial_administrator_setup_immutable_update
BEFORE UPDATE ON initial_administrator_setup
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_INITIAL_ADMINISTRATOR_SETUP'); END;
CREATE TRIGGER initial_administrator_setup_immutable_delete
BEFORE DELETE ON initial_administrator_setup
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_INITIAL_ADMINISTRATOR_SETUP'); END;
