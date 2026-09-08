-- Preserve every existing notification and attempt, including row identities.

PRAGMA defer_foreign_keys=ON;

CREATE TABLE migration_0081_notification_outbox AS SELECT rowid AS retained_rowid,* FROM "notification_outbox";

CREATE TABLE migration_0081_notification_attempt AS SELECT rowid AS retained_rowid,* FROM "notification_attempt";

DROP TABLE notification_attempt;

DROP TABLE notification_outbox;

CREATE TABLE "notification_outbox" (
  id TEXT NOT NULL PRIMARY KEY,
  event_type TEXT NOT NULL,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  customer_id TEXT REFERENCES customer(id),
  staff_invitation_id TEXT REFERENCES staff_invitation(id) ON DELETE RESTRICT,
  customer_invitation_id TEXT REFERENCES customer_invitation(id) ON DELETE RESTRICT,
  channel TEXT NOT NULL CHECK (channel IN ('EMAIL')),
  recipient_snapshot TEXT NOT NULL,
  template_data_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'CANCELED')),
  scheduled_at INTEGER NOT NULL,
  available_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error_code TEXT,
  sent_at INTEGER,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  publication_status TEXT NOT NULL DEFAULT 'PENDING'
  CHECK (
    publication_status IN ('PENDING', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'DEAD_LETTERED')
  ),
  queue_message_id TEXT,
  publication_attempts INTEGER NOT NULL DEFAULT 0
  CHECK (publication_attempts >= 0),
  published_at INTEGER,
  lease_owner TEXT,
  lease_expires_at INTEGER,
  dead_lettered_at INTEGER,
  processed_at INTEGER
,
  CHECK ("scheduled_at" IS NULL OR "scheduled_at" BETWEEN -9007199254740991 AND 9007199254740991),
  CHECK ("available_at" IS NULL OR "available_at" BETWEEN -9007199254740991 AND 9007199254740991),
  CHECK ("attempts" IS NULL OR "attempts" BETWEEN -9007199254740991 AND 9007199254740991),
  CHECK ("sent_at" IS NULL OR "sent_at" BETWEEN -9007199254740991 AND 9007199254740991),
  CHECK ("created_at" IS NULL OR "created_at" BETWEEN -9007199254740991 AND 9007199254740991),
  CHECK ("updated_at" IS NULL OR "updated_at" BETWEEN -9007199254740991 AND 9007199254740991),
  CHECK ("publication_attempts" IS NULL OR "publication_attempts" BETWEEN -9007199254740991 AND 9007199254740991),
  CHECK ("published_at" IS NULL OR "published_at" BETWEEN -9007199254740991 AND 9007199254740991),
  CHECK ("lease_expires_at" IS NULL OR "lease_expires_at" BETWEEN -9007199254740991 AND 9007199254740991),
  CHECK ("dead_lettered_at" IS NULL OR "dead_lettered_at" BETWEEN -9007199254740991 AND 9007199254740991),
  CHECK ("processed_at" IS NULL OR "processed_at" BETWEEN -9007199254740991 AND 9007199254740991)
,
  CHECK ((customer_id IS NOT NULL)+(staff_invitation_id IS NOT NULL)+(customer_invitation_id IS NOT NULL)=1)
) STRICT;

CREATE TABLE "notification_attempt" (
  id TEXT NOT NULL PRIMARY KEY,
  notification_id TEXT NOT NULL REFERENCES notification_outbox(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('PROCESSING', 'SENT', 'FAILED')),
  error_code TEXT,
  attempted_at INTEGER NOT NULL,
  completed_at INTEGER
,
  CHECK ("attempted_at" IS NULL OR "attempted_at" BETWEEN -9007199254740991 AND 9007199254740991),
  CHECK ("completed_at" IS NULL OR "completed_at" BETWEEN -9007199254740991 AND 9007199254740991)
) STRICT;

INSERT INTO "notification_outbox"(rowid,"id","event_type","aggregate_type","aggregate_id","customer_id","channel","recipient_snapshot","template_data_json","status","scheduled_at","available_at","attempts","last_error_code","sent_at","idempotency_key","created_at","updated_at","publication_status","queue_message_id","publication_attempts","published_at","lease_owner","lease_expires_at","dead_lettered_at","processed_at") SELECT retained_rowid,"id","event_type","aggregate_type","aggregate_id","customer_id","channel","recipient_snapshot","template_data_json","status","scheduled_at","available_at","attempts","last_error_code","sent_at","idempotency_key","created_at","updated_at","publication_status","queue_message_id","publication_attempts","published_at","lease_owner","lease_expires_at","dead_lettered_at","processed_at" FROM migration_0081_notification_outbox;

INSERT INTO "notification_attempt"(rowid,"id","notification_id","status","error_code","attempted_at","completed_at") SELECT retained_rowid,"id","notification_id","status","error_code","attempted_at","completed_at" FROM migration_0081_notification_attempt;

CREATE INDEX notification_attempt_message_idx
  ON notification_attempt(notification_id, attempted_at);

CREATE INDEX notification_outbox_due_idx
  ON notification_outbox(status, available_at, scheduled_at);

CREATE INDEX notification_outbox_expired_lease_idx
  ON notification_outbox(publication_status, lease_expires_at, id);

CREATE INDEX notification_outbox_publication_due_idx
  ON notification_outbox(publication_status, available_at, scheduled_at, id);

CREATE UNIQUE INDEX notification_outbox_queue_message_unique
  ON notification_outbox(queue_message_id)
  WHERE queue_message_id IS NOT NULL;

CREATE TRIGGER notification_outbox_queue_state_insert_guard
BEFORE INSERT ON notification_outbox
WHEN
  (NEW.publication_status = 'PUBLISHED'
   AND (NEW.queue_message_id IS NULL OR NEW.published_at IS NULL))
  OR (NEW.publication_status = 'DEAD_LETTERED' AND NEW.dead_lettered_at IS NULL)
  OR ((NEW.lease_owner IS NULL) != (NEW.lease_expires_at IS NULL))
BEGIN
  SELECT RAISE(ABORT, 'INVALID_NOTIFICATION_QUEUE_STATE');
END;

CREATE TRIGGER notification_outbox_queue_state_update_guard
BEFORE UPDATE OF publication_status, queue_message_id, published_at, lease_owner,
  lease_expires_at, dead_lettered_at
ON notification_outbox
WHEN
  (NEW.publication_status = 'PUBLISHED'
   AND (NEW.queue_message_id IS NULL OR NEW.published_at IS NULL))
  OR (NEW.publication_status = 'DEAD_LETTERED' AND NEW.dead_lettered_at IS NULL)
  OR ((NEW.lease_owner IS NULL) != (NEW.lease_expires_at IS NULL))
BEGIN
  SELECT RAISE(ABORT, 'INVALID_NOTIFICATION_QUEUE_STATE');
END;

CREATE UNIQUE INDEX notification_outbox_staff_invitation_unique ON notification_outbox(staff_invitation_id) WHERE staff_invitation_id IS NOT NULL;

CREATE UNIQUE INDEX notification_outbox_customer_invitation_unique ON notification_outbox(customer_invitation_id) WHERE customer_invitation_id IS NOT NULL;

DROP TABLE migration_0081_notification_outbox;

DROP TABLE migration_0081_notification_attempt;
