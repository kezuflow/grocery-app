-- Forward-only convergence of the compatibility operations tables onto the
-- canonical Procurement, Receiving, Fulfillment, and Delivery vocabularies.

ALTER TABLE procurement_requirement ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE procurement_requirement ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE receiving_record ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE receiving_record ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE delivery_job ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE delivery_job ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;

UPDATE procurement_requirement
SET status = CASE status
  WHEN 'DRAFT' THEN 'AGGREGATED'
  WHEN 'APPROVED' THEN 'REQUIREMENT_APPROVED'
  WHEN 'RECEIVING' THEN 'ORDERED'
  WHEN 'CANCELED' THEN 'CLOSED'
  ELSE status
END;

UPDATE receiving_record
SET status = CASE status WHEN 'PENDING' THEN 'NOT_STARTED' ELSE status END;

UPDATE fulfillment_record
SET status = CASE status
  WHEN 'PENDING' THEN 'NOT_STARTED'
  WHEN 'SHORTAGE' THEN 'SHORTED'
  WHEN 'DISPATCHED' THEN 'HANDED_OFF'
  ELSE status
END;

UPDATE delivery_job
SET status = CASE status
  WHEN 'PENDING' THEN CASE WHEN rider_user_id IS NULL THEN 'UNASSIGNED' ELSE 'ASSIGNED' END
  WHEN 'DISPATCHED' THEN 'EN_ROUTE'
  ELSE status
END;

UPDATE procurement_requirement
SET created_at = COALESCE((SELECT cutoff_at FROM delivery_cycle WHERE id=delivery_cycle_id), 0),
    updated_at = COALESCE((SELECT cutoff_at FROM delivery_cycle WHERE id=delivery_cycle_id), 0)
WHERE created_at=0 OR updated_at=0;

UPDATE receiving_record
SET created_at = COALESCE((SELECT pr.created_at FROM procurement_requirement pr WHERE pr.id=procurement_requirement_id), 0),
    updated_at = COALESCE((SELECT pr.updated_at FROM procurement_requirement pr WHERE pr.id=procurement_requirement_id), 0)
WHERE created_at=0 OR updated_at=0;

UPDATE delivery_job
SET created_at = COALESCE((SELECT o.created_at FROM grocery_order o WHERE o.id=order_id), 0),
    updated_at = COALESCE((SELECT f.updated_at FROM fulfillment_record f WHERE f.order_id=delivery_job.order_id), 0)
WHERE created_at=0 OR updated_at=0;

-- Preserve every historical row but close duplicate active requirements before
-- installing the single-active-aggregate invariant.
UPDATE procurement_requirement
SET status='CLOSED', updated_at=MAX(updated_at, created_at)
WHERE status!='CLOSED'
  AND EXISTS (
    SELECT 1 FROM procurement_requirement AS survivor
    WHERE survivor.delivery_cycle_id=procurement_requirement.delivery_cycle_id
      AND survivor.location_id=procurement_requirement.location_id
      AND survivor.inventory_pool_id=procurement_requirement.inventory_pool_id
      AND survivor.status!='CLOSED'
      AND survivor.id < procurement_requirement.id
  );

CREATE UNIQUE INDEX procurement_requirement_active_context_unique
  ON procurement_requirement(delivery_cycle_id, location_id, inventory_pool_id)
  WHERE status!='CLOSED';

CREATE TRIGGER procurement_requirement_canonical_status_insert
BEFORE INSERT ON procurement_requirement
WHEN NEW.status NOT IN ('OPEN','AGGREGATED','REQUIREMENT_APPROVED','ORDERED','PARTIALLY_RECEIVED','RECEIVED','CLOSED','EXCEPTION')
BEGIN SELECT RAISE(ABORT, 'INVALID_PROCUREMENT_STATUS'); END;

CREATE TRIGGER procurement_requirement_canonical_status_update
BEFORE UPDATE OF status ON procurement_requirement
WHEN NEW.status NOT IN ('OPEN','AGGREGATED','REQUIREMENT_APPROVED','ORDERED','PARTIALLY_RECEIVED','RECEIVED','CLOSED','EXCEPTION')
BEGIN SELECT RAISE(ABORT, 'INVALID_PROCUREMENT_STATUS'); END;

CREATE TRIGGER receiving_record_canonical_status_insert
BEFORE INSERT ON receiving_record
WHEN NEW.status NOT IN ('NOT_STARTED','IN_PROGRESS','DISCREPANCY','COMPLETED','CANCELED')
BEGIN SELECT RAISE(ABORT, 'INVALID_RECEIVING_STATUS'); END;

CREATE TRIGGER receiving_record_canonical_status_update
BEFORE UPDATE OF status ON receiving_record
WHEN NEW.status NOT IN ('NOT_STARTED','IN_PROGRESS','DISCREPANCY','COMPLETED','CANCELED')
BEGIN SELECT RAISE(ABORT, 'INVALID_RECEIVING_STATUS'); END;

CREATE TRIGGER fulfillment_record_canonical_status_insert
BEFORE INSERT ON fulfillment_record
WHEN NEW.status NOT IN ('NOT_STARTED','PICKING','READY_TO_PACK','PACKING','PACKED','HANDED_OFF','COMPLETED','SHORTED','CANCELED','ESCALATED')
BEGIN SELECT RAISE(ABORT, 'INVALID_FULFILLMENT_STATUS'); END;

CREATE TRIGGER fulfillment_record_canonical_status_update
BEFORE UPDATE OF status ON fulfillment_record
WHEN NEW.status NOT IN ('NOT_STARTED','PICKING','READY_TO_PACK','PACKING','PACKED','HANDED_OFF','COMPLETED','SHORTED','CANCELED','ESCALATED')
BEGIN SELECT RAISE(ABORT, 'INVALID_FULFILLMENT_STATUS'); END;

CREATE TRIGGER delivery_job_canonical_status_insert
BEFORE INSERT ON delivery_job
WHEN NEW.status NOT IN ('UNASSIGNED','ASSIGNED','EN_ROUTE','ARRIVED','DELIVERED','FAILED','RETRY_SCHEDULED','ESCALATED','CANCELED')
BEGIN SELECT RAISE(ABORT, 'INVALID_DELIVERY_STATUS'); END;

CREATE TRIGGER delivery_job_canonical_status_update
BEFORE UPDATE OF status ON delivery_job
WHEN NEW.status NOT IN ('UNASSIGNED','ASSIGNED','EN_ROUTE','ARRIVED','DELIVERED','FAILED','RETRY_SCHEDULED','ESCALATED','CANCELED')
BEGIN SELECT RAISE(ABORT, 'INVALID_DELIVERY_STATUS'); END;
