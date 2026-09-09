-- Preserve the original expected and rejected quantities when replacement goods arrive.
ALTER TABLE receiving_record ADD COLUMN shortage_base INTEGER NOT NULL DEFAULT 0
  CHECK (shortage_base BETWEEN 0 AND 9007199254740991);
ALTER TABLE receiving_record ADD COLUMN replacement_base INTEGER NOT NULL DEFAULT 0
  CHECK (replacement_base BETWEEN 0 AND 9007199254740991 AND replacement_base<=accepted_quantity);

CREATE TRIGGER receiving_event_no_update BEFORE UPDATE ON receiving_event
BEGIN SELECT RAISE(ABORT,'IMMUTABLE_RECEIVING_EVIDENCE'); END;
CREATE TRIGGER receiving_event_no_delete BEFORE DELETE ON receiving_event
BEGIN SELECT RAISE(ABORT,'IMMUTABLE_RECEIVING_EVIDENCE'); END;
CREATE TRIGGER supply_exception_observation_immutable
BEFORE UPDATE OF requirement_id,kind,affected_quantity,created_at ON supply_exception
WHEN NEW.requirement_id<>OLD.requirement_id OR NEW.kind<>OLD.kind
  OR NEW.affected_quantity<>OLD.affected_quantity OR NEW.created_at<>OLD.created_at
BEGIN SELECT RAISE(ABORT,'IMMUTABLE_SUPPLY_OBSERVATION'); END;
