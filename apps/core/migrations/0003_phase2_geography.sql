CREATE TABLE IF NOT EXISTS organization (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'inactive')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS market (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organization(id) ON DELETE RESTRICT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  currency TEXT NOT NULL,
  timezone TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'inactive')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS market_status_idx ON market(status);

CREATE TABLE IF NOT EXISTS fulfillment_location (
  id TEXT PRIMARY KEY NOT NULL,
  market_id TEXT NOT NULL REFERENCES market(id) ON DELETE RESTRICT,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('FULFILLMENT_CENTER', 'SATELLITE', 'CROSS_DOCK', 'DISPATCH_ONLY', 'PICKUP_POINT')),
  address_json TEXT,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'inactive')),
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (market_id, code),
  CHECK (latitude >= -90 AND latitude <= 90),
  CHECK (longitude >= -180 AND longitude <= 180)
);
CREATE INDEX IF NOT EXISTS fulfillment_location_market_status_idx ON fulfillment_location(market_id, status);

CREATE TABLE IF NOT EXISTS location_capability (
  location_id TEXT NOT NULL REFERENCES fulfillment_location(id) ON DELETE CASCADE,
  capability TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  PRIMARY KEY (location_id, capability)
);
CREATE INDEX IF NOT EXISTS location_capability_enabled_idx ON location_capability(capability, enabled);

CREATE TABLE IF NOT EXISTS service_area (
  id TEXT PRIMARY KEY NOT NULL,
  market_id TEXT NOT NULL REFERENCES market(id) ON DELETE RESTRICT,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  polygon_geojson TEXT NOT NULL,
  polygon_version INTEGER NOT NULL,
  active_from INTEGER NOT NULL,
  active_to INTEGER,
  status TEXT NOT NULL CHECK (status IN ('active', 'inactive')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (market_id, code, polygon_version),
  CHECK (polygon_version > 0)
);
CREATE INDEX IF NOT EXISTS service_area_active_idx ON service_area(market_id, status, active_from);

CREATE TABLE IF NOT EXISTS delivery_zone (
  id TEXT PRIMARY KEY NOT NULL,
  service_area_id TEXT NOT NULL REFERENCES service_area(id) ON DELETE RESTRICT,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  polygon_geojson TEXT NOT NULL,
  polygon_version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'inactive')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (service_area_id, code, polygon_version),
  CHECK (polygon_version > 0)
);
CREATE INDEX IF NOT EXISTS delivery_zone_active_idx ON delivery_zone(service_area_id, status);

CREATE TABLE IF NOT EXISTS location_serviceability (
  zone_id TEXT NOT NULL REFERENCES delivery_zone(id) ON DELETE CASCADE,
  location_id TEXT NOT NULL REFERENCES fulfillment_location(id) ON DELETE CASCADE,
  priority INTEGER NOT NULL,
  eligible INTEGER NOT NULL DEFAULT 1 CHECK (eligible IN (0, 1)),
  valid_from INTEGER NOT NULL,
  valid_to INTEGER,
  PRIMARY KEY (zone_id, location_id, valid_from)
);
CREATE INDEX IF NOT EXISTS location_serviceability_candidate_idx ON location_serviceability(zone_id, eligible, priority);

INSERT OR IGNORE INTO organization (id, name, status, created_at, updated_at)
VALUES ('org-freshmarkets', 'FreshMarkets', 'active', 0, 0);

INSERT OR IGNORE INTO market (id, organization_id, code, name, currency, timezone, status, created_at, updated_at)
VALUES ('market-metro-cebu', 'org-freshmarkets', 'METRO_CEBU', 'Metro Cebu', 'PHP', 'Asia/Manila', 'active', 0, 0);

INSERT OR IGNORE INTO fulfillment_location
  (id, market_id, code, name, type, address_json, latitude, longitude, status, version, created_at, updated_at)
VALUES
  ('location-cebu-central', 'market-metro-cebu', 'CEBU_CENTRAL', 'Cebu Central', 'FULFILLMENT_CENTER',
   '{"city":"Cebu City","country":"PH"}', 10.3157, 123.8854, 'active', 1, 0, 0);

INSERT OR IGNORE INTO location_capability (location_id, capability, enabled)
VALUES
  ('location-cebu-central', 'RECEIVING', 1),
  ('location-cebu-central', 'INVENTORY', 1),
  ('location-cebu-central', 'PROCUREMENT', 1),
  ('location-cebu-central', 'PICKING', 1),
  ('location-cebu-central', 'PACKING', 1),
  ('location-cebu-central', 'DISPATCH', 1);

INSERT OR IGNORE INTO service_area
  (id, market_id, code, name, polygon_geojson, polygon_version, active_from, status, created_at, updated_at)
VALUES
  ('service-area-cebu-city', 'market-metro-cebu', 'CEBU_CITY', 'Cebu City',
   '{"type":"Polygon","coordinates":[[[123.8000,10.2700],[123.9400,10.2700],[123.9400,10.3800],[123.8000,10.3800],[123.8000,10.2700]]]}',
   1, 0, 'active', 0, 0);

INSERT OR IGNORE INTO delivery_zone
  (id, service_area_id, code, name, polygon_geojson, polygon_version, status, created_at, updated_at)
VALUES
  ('zone-cebu-city-core', 'service-area-cebu-city', 'CEBU_CITY_CORE', 'Cebu City Core',
   '{"type":"Polygon","coordinates":[[[123.8200,10.2850],[123.9200,10.2850],[123.9200,10.3600],[123.8200,10.3600],[123.8200,10.2850]]]}',
   1, 'active', 0, 0);

INSERT OR IGNORE INTO location_serviceability
  (zone_id, location_id, priority, eligible, valid_from)
VALUES ('zone-cebu-city-core', 'location-cebu-central', 1, 1, 0);
