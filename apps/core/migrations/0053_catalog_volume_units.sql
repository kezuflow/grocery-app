-- Complete the controlled unit registry for the canonical VOLUME dimension.
-- Product inventory remains integer MILLILITER; LITER is an exact sell-unit conversion.

INSERT OR IGNORE INTO unit
  (id, code, name, dimension, symbol, created_at, canonical_base_code,
   conversion_numerator, conversion_denominator, status, version, updated_at)
VALUES
  ('unit-milliliter', 'MILLILITER', 'Milliliter', 'VOLUME', 'mL', 0,
   'MILLILITER', 1, 1, 'active', 1, 0),
  ('unit-liter', 'LITER', 'Liter', 'VOLUME', 'L', 0,
   'MILLILITER', 1000, 1, 'active', 1, 0);
