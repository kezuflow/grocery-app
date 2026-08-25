-- Phase 4B remediation: persist the authoritative serviceability outcome.
ALTER TABLE customer_address ADD COLUMN serviceable INTEGER
  CHECK (serviceable IS NULL OR serviceable IN (0, 1));

ALTER TABLE customer_address ADD COLUMN serviceability_reason TEXT
  CHECK (
    serviceability_reason IS NULL OR serviceability_reason IN (
      'INVALID_COORDINATES',
      'OUTSIDE_SERVICE_AREA',
      'OUTSIDE_DELIVERY_ZONE',
      'NO_ELIGIBLE_LOCATION'
    )
  );
