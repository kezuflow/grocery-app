-- Existing invitations remain pending without grants; they cannot grant access.
CREATE TABLE staff_invitation_role (
  invitation_id TEXT NOT NULL REFERENCES staff_invitation(id),
  role_id TEXT NOT NULL REFERENCES role(id),
  PRIMARY KEY(invitation_id, role_id)
);
CREATE TABLE staff_invitation_scope (
  id TEXT PRIMARY KEY,
  invitation_id TEXT NOT NULL REFERENCES staff_invitation(id),
  scope_kind TEXT NOT NULL CHECK(scope_kind IN ('global','market','location')),
  market_id TEXT REFERENCES market(id),
  location_id TEXT REFERENCES fulfillment_location(id),
  CHECK((scope_kind='global' AND market_id IS NULL AND location_id IS NULL)
    OR (scope_kind='market' AND market_id IS NOT NULL AND location_id IS NULL)
    OR (scope_kind='location' AND market_id IS NULL AND location_id IS NOT NULL))
);
CREATE UNIQUE INDEX staff_invitation_scope_identity ON staff_invitation_scope
  (invitation_id,scope_kind,COALESCE(market_id,''),COALESCE(location_id,''));
