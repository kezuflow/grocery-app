-- Keep retained quotes conservative: their Cart version cannot be reconstructed
-- from current Cart contents or timestamps. Only new quotes record this fact.
ALTER TABLE checkout_quote ADD COLUMN cart_version INTEGER
  CHECK (cart_version IS NULL OR cart_version BETWEEN 1 AND 9007199254740991);
