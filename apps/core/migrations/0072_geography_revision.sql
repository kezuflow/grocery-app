CREATE TABLE geography_configuration (
  market_id TEXT PRIMARY KEY NOT NULL REFERENCES market(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL CHECK (version BETWEEN 1 AND 9007199254740991),
  updated_at INTEGER NOT NULL CHECK (updated_at BETWEEN -9007199254740991 AND 9007199254740991)
) STRICT;
INSERT INTO geography_configuration(market_id,version,updated_at) SELECT id,1,0 FROM market;
