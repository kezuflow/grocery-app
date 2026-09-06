-- Each fulfillment/store location owns one courier pickup profile. Coordinates
-- remain authoritative on fulfillment_location; this table holds only the
-- sender/contact and structured address facts required to dispatch from it.

CREATE TABLE fulfillment_location_delivery_profile (
  location_id TEXT PRIMARY KEY NOT NULL
    REFERENCES fulfillment_location(id) ON DELETE RESTRICT,
  sender_name TEXT NOT NULL CHECK (length(trim(sender_name)) BETWEEN 1 AND 120),
  phone_e164 TEXT NOT NULL CHECK (
    phone_e164 GLOB '+[1-9][0-9]*' AND length(phone_e164) BETWEEN 9 AND 16
  ),
  email TEXT,
  formatted_address TEXT NOT NULL CHECK (length(trim(formatted_address)) BETWEEN 1 AND 500),
  address_line1 TEXT NOT NULL CHECK (length(trim(address_line1)) BETWEEN 1 AND 200),
  address_line2 TEXT,
  barangay TEXT,
  city TEXT NOT NULL CHECK (length(trim(city)) BETWEEN 1 AND 120),
  region TEXT,
  postal_code TEXT,
  country_code TEXT NOT NULL CHECK (length(country_code) = 2),
  pickup_instructions TEXT CHECK (
    pickup_instructions IS NULL OR length(pickup_instructions) <= 1000
  ),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
