CREATE TABLE delivery_provider_command (
  id TEXT PRIMARY KEY NOT NULL,
  dispatch_id TEXT NOT NULL REFERENCES delivery_provider_dispatch(id),
  operation TEXT NOT NULL CHECK (operation IN ('REFRESH','CANCEL')),
  idempotency_scope TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  location_id TEXT NOT NULL REFERENCES fulfillment_location(id),
  request_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('SUBMITTING','OUTCOME_UNKNOWN','OBSERVED','SUCCEEDED','REJECTED')),
  observation_id TEXT REFERENCES delivery_provider_event_inbox(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(idempotency_scope,idempotency_key)
);
CREATE UNIQUE INDEX delivery_provider_command_pending_cancel_idx
  ON delivery_provider_command(dispatch_id)
  WHERE operation='CANCEL' AND status IN ('SUBMITTING','OUTCOME_UNKNOWN','OBSERVED');
CREATE INDEX delivery_provider_command_recovery_idx ON delivery_provider_command(status,updated_at,id);
CREATE INDEX delivery_provider_command_observation_idx ON delivery_provider_command(observation_id);
