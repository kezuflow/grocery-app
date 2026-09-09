-- Agreement evidence is retained separately from the original commercial snapshot.
CREATE UNIQUE INDEX delivery_dispatch_job_identity ON delivery_provider_dispatch(id, delivery_job_id);
CREATE TABLE delivery_promise_revision (
  id TEXT PRIMARY KEY,
  delivery_job_id TEXT NOT NULL REFERENCES delivery_job(id),
  dispatch_id TEXT NOT NULL,
  job_version INTEGER NOT NULL CHECK (job_version > 0),
  previous_promised_at INTEGER NOT NULL,
  promised_at INTEGER NOT NULL CHECK (promised_at > 0),
  agreement_note TEXT NOT NULL CHECK (length(trim(agreement_note)) BETWEEN 1 AND 1000),
  return_inspection_note TEXT NULL CHECK (return_inspection_note IS NULL OR length(trim(return_inspection_note)) BETWEEN 1 AND 1000),
  return_inspected_at INTEGER NULL CHECK ((return_inspected_at IS NULL) = (return_inspection_note IS NULL)),
  actor_user_id TEXT NOT NULL REFERENCES user(id),
  recorded_at INTEGER NOT NULL,
  UNIQUE (delivery_job_id, job_version),
  FOREIGN KEY (dispatch_id, delivery_job_id) REFERENCES delivery_provider_dispatch(id, delivery_job_id)
);
CREATE INDEX delivery_promise_revision_dispatch ON delivery_promise_revision(dispatch_id);
CREATE TRIGGER delivery_promise_revision_no_update
BEFORE UPDATE ON delivery_promise_revision BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_DELIVERY_AGREEMENT'); END;
CREATE TRIGGER delivery_promise_revision_no_delete
BEFORE DELETE ON delivery_promise_revision BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_DELIVERY_AGREEMENT'); END;
