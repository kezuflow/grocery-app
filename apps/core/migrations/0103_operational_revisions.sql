-- Location-scoped invalidation is committed with the business row that changed.
-- The revision is an opaque freshness signal; operational facts remain in their
-- existing authoritative tables. Publishing can be retried after a Worker crash.
CREATE TABLE operational_revision (
  location_id TEXT PRIMARY KEY NOT NULL REFERENCES fulfillment_location(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision BETWEEN 1 AND 9007199254740991),
  published_revision INTEGER NOT NULL DEFAULT 0 CHECK (published_revision BETWEEN 0 AND 9007199254740991),
  CHECK (published_revision <= revision)
) STRICT;
CREATE INDEX operational_revision_pending_idx
  ON operational_revision(location_id) WHERE published_revision < revision;

CREATE TRIGGER operational_fulfillment_insert AFTER INSERT ON fulfillment_record BEGIN
  INSERT INTO operational_revision(location_id) VALUES (NEW.location_id)
    ON CONFLICT(location_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER operational_fulfillment_update AFTER UPDATE OF status,version ON fulfillment_record
WHEN NEW.status<>OLD.status OR NEW.version<>OLD.version BEGIN
  INSERT INTO operational_revision(location_id) VALUES (NEW.location_id)
    ON CONFLICT(location_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER operational_order_update AFTER UPDATE OF status,version ON grocery_order
WHEN NEW.status<>OLD.status OR NEW.version<>OLD.version BEGIN
  INSERT INTO operational_revision(location_id)
    SELECT location_id FROM fulfillment_record WHERE order_id=NEW.id
    ON CONFLICT(location_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER operational_delivery_insert AFTER INSERT ON delivery_job
WHEN NEW.location_id IS NOT NULL BEGIN
  INSERT INTO operational_revision(location_id) VALUES (NEW.location_id)
    ON CONFLICT(location_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER operational_delivery_update AFTER UPDATE OF status,version,promised_at ON delivery_job
WHEN NEW.location_id IS NOT NULL AND (
  NEW.status<>OLD.status OR NEW.version<>OLD.version OR NEW.promised_at IS NOT OLD.promised_at
) BEGIN
  INSERT INTO operational_revision(location_id) VALUES (NEW.location_id)
    ON CONFLICT(location_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER operational_dispatch_insert AFTER INSERT ON delivery_provider_dispatch BEGIN
  INSERT INTO operational_revision(location_id)
    SELECT location_id FROM delivery_job WHERE id=NEW.delivery_job_id AND location_id IS NOT NULL
    ON CONFLICT(location_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER operational_dispatch_update AFTER UPDATE OF status,version,provider_status ON delivery_provider_dispatch
WHEN NEW.status<>OLD.status OR NEW.version<>OLD.version
  OR NEW.provider_status IS NOT OLD.provider_status BEGIN
  INSERT INTO operational_revision(location_id)
    SELECT location_id FROM delivery_job WHERE id=NEW.delivery_job_id AND location_id IS NOT NULL
    ON CONFLICT(location_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER operational_receiving_insert AFTER INSERT ON receiving_record BEGIN
  INSERT INTO operational_revision(location_id)
    SELECT location_id FROM procurement_requirement WHERE id=NEW.procurement_requirement_id
    ON CONFLICT(location_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER operational_receiving_update AFTER UPDATE OF status,version,accepted_quantity,rejected_quantity ON receiving_record
WHEN NEW.status<>OLD.status OR NEW.version<>OLD.version
  OR NEW.accepted_quantity<>OLD.accepted_quantity OR NEW.rejected_quantity<>OLD.rejected_quantity BEGIN
  INSERT INTO operational_revision(location_id)
    SELECT location_id FROM procurement_requirement WHERE id=NEW.procurement_requirement_id
    ON CONFLICT(location_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER operational_issue_insert AFTER INSERT ON order_issue BEGIN
  INSERT INTO operational_revision(location_id)
    SELECT location_id FROM fulfillment_record WHERE order_id=NEW.order_id
    ON CONFLICT(location_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER operational_issue_update AFTER UPDATE OF status,version ON order_issue
WHEN NEW.status<>OLD.status OR NEW.version<>OLD.version BEGIN
  INSERT INTO operational_revision(location_id)
    SELECT location_id FROM fulfillment_record WHERE order_id=NEW.order_id
    ON CONFLICT(location_id) DO UPDATE SET revision=revision+1;
END;
