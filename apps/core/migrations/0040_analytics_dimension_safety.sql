-- Preserve historical metric definitions while publishing dimension-safe
-- replacements for currency/base-unit aggregates.
DROP TRIGGER metric_definitions_no_update;
DROP TRIGGER metric_definitions_no_delete;
DROP INDEX metric_definitions_one_approved_code_idx;
DROP INDEX metric_definitions_code_status_version_idx;

ALTER TABLE metric_definitions RENAME TO metric_definitions_before_dimension_safety;

CREATE TABLE metric_definitions (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  display_name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN (
    'CUSTOMERS', 'ORDERS', 'MEMBERSHIPS', 'PROMOTIONS',
    'FULFILLMENT', 'DELIVERY', 'INVENTORY', 'FINANCE'
  )),
  formula_json TEXT NOT NULL CHECK (json_valid(formula_json)),
  source_contract_version TEXT NOT NULL,
  event_time_field TEXT NOT NULL,
  reporting_timezone_policy TEXT NOT NULL,
  inclusion_json TEXT NOT NULL CHECK (json_valid(inclusion_json)),
  exclusion_json TEXT NOT NULL CHECK (json_valid(exclusion_json)),
  rounding_policy TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('APPROVED', 'BLOCKED', 'SUPERSEDED')),
  approved_at INTEGER NULL,
  dimensions_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(dimensions_json)),
  unavailable_reason TEXT NULL,
  UNIQUE(code, version)
);

INSERT INTO metric_definitions (
  id, code, version, display_name, category, formula_json, source_contract_version,
  event_time_field, reporting_timezone_policy, inclusion_json, exclusion_json,
  rounding_policy, status, approved_at, dimensions_json, unavailable_reason
)
SELECT id, code, version, display_name, category, formula_json, source_contract_version,
       event_time_field, reporting_timezone_policy, inclusion_json, exclusion_json,
       rounding_policy, status, approved_at, dimensions_json, unavailable_reason
FROM metric_definitions_before_dimension_safety;

UPDATE metric_definitions
SET status = 'SUPERSEDED',
    unavailable_reason = 'Superseded by dimension-safe definition version 2.'
WHERE code IN ('refund_amount', 'inventory_adjustments_shrinkage') AND version = 1;

INSERT INTO metric_definitions (
  id, code, version, display_name, category, formula_json, source_contract_version,
  event_time_field, reporting_timezone_policy, inclusion_json, exclusion_json,
  rounding_policy, status, approved_at, dimensions_json, unavailable_reason
)
SELECT 'metric-definition-refund-amount-v2', code, 2, display_name, category,
       '{"description":"Sum successful Refund amounts by refund-success instant for exactly one currency."}',
       '2026-08-29.admin-analytics-dimension-safety', event_time_field,
       reporting_timezone_policy, inclusion_json,
       '{"currencies":"ambiguous requests are unavailable"}', rounding_policy,
       'APPROVED', 1787961600000, dimensions_json, NULL
FROM metric_definitions
WHERE code = 'refund_amount' AND version = 1;

INSERT INTO metric_definitions (
  id, code, version, display_name, category, formula_json, source_contract_version,
  event_time_field, reporting_timezone_policy, inclusion_json, exclusion_json,
  rounding_policy, status, approved_at, dimensions_json, unavailable_reason
)
SELECT 'metric-definition-inventory-adjustments-shrinkage-v2', code, 2, display_name, category,
       '{"description":"Sum signed adjustment ledger movements for exactly one canonical base unit, location, and optional reason."}',
       '2026-08-29.admin-analytics-dimension-safety', event_time_field,
       reporting_timezone_policy, inclusion_json,
       '{"baseUnits":"ambiguous requests are unavailable"}', rounding_policy,
       'APPROVED', 1787961600000, dimensions_json, NULL
FROM metric_definitions
WHERE code = 'inventory_adjustments_shrinkage' AND version = 1;

DROP TABLE metric_definitions_before_dimension_safety;

CREATE INDEX metric_definitions_code_status_version_idx
  ON metric_definitions(code, status, version DESC);
CREATE UNIQUE INDEX metric_definitions_one_approved_code_idx
  ON metric_definitions(code) WHERE status = 'APPROVED';

CREATE TRIGGER metric_definitions_no_update
BEFORE UPDATE ON metric_definitions
BEGIN
  SELECT RAISE(ABORT, 'metric definitions are immutable');
END;

CREATE TRIGGER metric_definitions_no_delete
BEFORE DELETE ON metric_definitions
BEGIN
  SELECT RAISE(ABORT, 'metric definitions are immutable');
END;
