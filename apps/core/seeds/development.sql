-- Deterministic local-development data for Admin and customer workflows.
-- Re-runnable: stable seed identities use INSERT OR IGNORE.
-- Deliberately excludes product_media rows and all R2 objects.

-- Synthetic staff actor used by audit, issue-assignment, and inventory fixtures. It has no
-- credential or session and therefore cannot authenticate.
INSERT OR IGNORE INTO user
  (id, name, email, email_verified, image, created_at, updated_at)
VALUES
  ('seed-user-local-admin', 'Local Admin', 'local.admin@example.com', 1, NULL,
   1786000000000, 1786000000000);

INSERT OR IGNORE INTO staff_identity
  (id, auth_user_id, display_name, status, created_at, updated_at, version)
VALUES
  ('staff_local_admin', 'seed-user-local-admin', 'Local Admin', 'active',
   1786000000000, 1786000000000, 1);

INSERT OR IGNORE INTO staff_role (staff_id, role_id)
VALUES ('staff_local_admin', 'role_operations_admin');

INSERT OR IGNORE INTO staff_scope (id, staff_id, scope_kind, market_id, location_id)
VALUES ('seed-scope-local-admin-global', 'staff_local_admin', 'global', NULL, NULL);

-- Commercial configuration used by seeded Instant and delivery snapshots.
INSERT OR IGNORE INTO service_fee_configuration
  (id, fee_type, flat_minor, percentage_basis_points, currency, effective_from, effective_to,
   version, created_by_staff_id, reason, created_at)
VALUES
  ('seed-service-fee-v1', 'FLAT', 1500, 0, 'PHP', 1787184000000, NULL, 1,
   'staff_local_admin', 'Local development seed', 1787184000000);

INSERT OR IGNORE INTO delivery_fee_configuration
  (id, market_id, location_id, currency, minimum_delivery_fee_minor,
   per_kilometer_rate_minor, status, version, effective_from, effective_to, created_at, updated_at)
VALUES
  ('seed-delivery-fee-v1', 'market-metro-cebu', 'location-cebu-central', 'PHP', 5000,
   1500, 'ACTIVE', 1, 1787184000000, NULL, 1787184000000, 1787184000000);

-- Customers are application profiles linked to Better Auth identities. No credentials or sessions
-- are seeded, so these display identities cannot authenticate.
INSERT OR IGNORE INTO user
  (id, name, email, email_verified, image, created_at, updated_at)
VALUES
  ('seed-user-ana', 'Ana Santos', 'ana.santos@example.com', 1, NULL, 1786000000000, 1786000000000),
  ('seed-user-miguel', 'Miguel dela Cruz', 'miguel.delacruz@example.com', 1, NULL, 1786000001000, 1786000001000),
  ('seed-user-carla', 'Carla Lim', 'carla.lim@example.com', 1, NULL, 1786000002000, 1786000002000),
  ('seed-user-ramon', 'Ramon Garcia', 'ramon.garcia@example.com', 1, NULL, 1786000003000, 1786000003000),
  ('seed-user-liza', 'Liza Mendoza', 'liza.mendoza@example.com', 1, NULL, 1786000004000, 1786000004000),
  ('seed-user-jose', 'Jose Villanueva', 'jose.villanueva@example.com', 1, NULL, 1786000005000, 1786000005000),
  ('seed-user-maria', 'Maria Flores', 'maria.flores@example.com', 1, NULL, 1786000006000, 1786000006000),
  ('seed-user-ben', 'Ben Torres', 'ben.torres@example.com', 1, NULL, 1786000007000, 1786000007000);

INSERT OR IGNORE INTO customer_principal (id, auth_user_id, status, created_at, updated_at)
VALUES
  ('seed-principal-ana', 'seed-user-ana', 'active', 1786000000000, 1786000000000),
  ('seed-principal-miguel', 'seed-user-miguel', 'active', 1786000001000, 1786000001000),
  ('seed-principal-carla', 'seed-user-carla', 'active', 1786000002000, 1786000002000),
  ('seed-principal-ramon', 'seed-user-ramon', 'active', 1786000003000, 1786000003000),
  ('seed-principal-liza', 'seed-user-liza', 'active', 1786000004000, 1786000004000),
  ('seed-principal-jose', 'seed-user-jose', 'active', 1786000005000, 1786000005000),
  ('seed-principal-maria', 'seed-user-maria', 'active', 1786000006000, 1786000006000),
  ('seed-principal-ben', 'seed-user-ben', 'disabled', 1786000007000, 1788304500000);

INSERT OR IGNORE INTO customer
  (id, auth_user_id, phone, status, created_at, updated_at, version, principal_id)
VALUES
  ('seed-customer-ana', 'seed-user-ana', '+639171110101', 'active', 1786000000000, 1786000000000, 1, 'seed-principal-ana'),
  ('seed-customer-miguel', 'seed-user-miguel', '+639171110102', 'active', 1786000001000, 1786000001000, 1, 'seed-principal-miguel'),
  ('seed-customer-carla', 'seed-user-carla', '+639171110103', 'active', 1786000002000, 1786000002000, 1, 'seed-principal-carla'),
  ('seed-customer-ramon', 'seed-user-ramon', '+639171110104', 'active', 1786000003000, 1786000003000, 1, 'seed-principal-ramon'),
  ('seed-customer-liza', 'seed-user-liza', '+639171110105', 'active', 1786000004000, 1786000004000, 1, 'seed-principal-liza'),
  ('seed-customer-jose', 'seed-user-jose', '+639171110106', 'active', 1786000005000, 1786000005000, 1, 'seed-principal-jose'),
  ('seed-customer-maria', 'seed-user-maria', '+639171110107', 'active', 1786000006000, 1786000006000, 1, 'seed-principal-maria'),
  ('seed-customer-ben', 'seed-user-ben', '+639171110108', 'active', 1786000007000, 1788304500000, 2, 'seed-principal-ben');

INSERT OR IGNORE INTO customer_address
  (id, customer_id, label, recipient, phone, address_json, latitude, longitude,
   service_area_code, delivery_zone_code, resolution_version, notes, status, version,
   created_at, updated_at, serviceable, serviceability_reason, address_components_json,
   barangay, city, postal_code, confirmation_source, user_confirmed_at,
   delivery_instructions_json)
VALUES
  ('seed-address-ana', 'seed-customer-ana', 'Home', 'Ana Santos', '+639171110101', '{"addressLine1":"Ayala Center Cebu","barangay":"Luz","city":"Cebu City","region":"Central Visayas","postalCode":"6000","countryCode":"PH"}', 10.3173, 123.9058, 'CEBU_CITY', 'CEBU_CITY_CORE', 1, NULL, 'active', 1, 1786000000000, 1786000000000, 1, NULL, '{"addressLine1":"Ayala Center Cebu","barangay":"Luz","city":"Cebu City","region":"Central Visayas","postalCode":"6000","countryCode":"PH"}', 'Luz', 'Cebu City', '6000', 'USER_PIN', 1786000000000, '{"deliveryNote":"Call on arrival"}'),
  ('seed-address-miguel', 'seed-customer-miguel', 'Condo', 'Miguel dela Cruz', '+639171110102', '{"addressLine1":"IT Park","addressLine2":"Tower 2","barangay":"Apas","city":"Cebu City","region":"Central Visayas","postalCode":"6000","countryCode":"PH"}', 10.3307, 123.9066, 'CEBU_CITY', 'CEBU_CITY_CORE', 1, NULL, 'active', 1, 1786000001000, 1786000001000, 1, NULL, '{"addressLine1":"IT Park","addressLine2":"Tower 2","barangay":"Apas","city":"Cebu City","region":"Central Visayas","postalCode":"6000","countryCode":"PH"}', 'Apas', 'Cebu City', '6000', 'USER_PIN', 1786000001000, '{"deliveryNote":"Leave with concierge"}'),
  ('seed-address-carla', 'seed-customer-carla', 'Office', 'Carla Lim', '+639171110103', '{"addressLine1":"Cebu Business Park","barangay":"Luz","city":"Cebu City","region":"Central Visayas","postalCode":"6000","countryCode":"PH"}', 10.3186, 123.9039, 'CEBU_CITY', 'CEBU_CITY_CORE', 1, NULL, 'active', 1, 1786000002000, 1786000002000, 1, NULL, '{"addressLine1":"Cebu Business Park","barangay":"Luz","city":"Cebu City","region":"Central Visayas","postalCode":"6000","countryCode":"PH"}', 'Luz', 'Cebu City', '6000', 'GEOCODER', 1786000002000, '{}'),
  ('seed-address-ramon', 'seed-customer-ramon', 'Home', 'Ramon Garcia', '+639171110104', '{"addressLine1":"Banilad Town Centre","barangay":"Banilad","city":"Cebu City","region":"Central Visayas","postalCode":"6000","countryCode":"PH"}', 10.3440, 123.9122, 'CEBU_CITY', 'CEBU_CITY_CORE', 1, NULL, 'active', 1, 1786000003000, 1786000003000, 1, NULL, '{"addressLine1":"Banilad Town Centre","barangay":"Banilad","city":"Cebu City","region":"Central Visayas","postalCode":"6000","countryCode":"PH"}', 'Banilad', 'Cebu City', '6000', 'USER_PIN', 1786000003000, '{}'),
  ('seed-address-liza', 'seed-customer-liza', 'Home', 'Liza Mendoza', '+639171110105', '{"addressLine1":"Fuente Osmena Circle","barangay":"Capitol Site","city":"Cebu City","region":"Central Visayas","postalCode":"6000","countryCode":"PH"}', 10.3103, 123.8930, 'CEBU_CITY', 'CEBU_CITY_CORE', 1, NULL, 'active', 1, 1786000004000, 1786000004000, 1, NULL, '{"addressLine1":"Fuente Osmena Circle","barangay":"Capitol Site","city":"Cebu City","region":"Central Visayas","postalCode":"6000","countryCode":"PH"}', 'Capitol Site', 'Cebu City', '6000', 'DEVICE_LOCATION', 1786000004000, '{}'),
  ('seed-address-jose', 'seed-customer-jose', 'Home', 'Jose Villanueva', '+639171110106', '{"addressLine1":"V Rama Avenue","barangay":"Guadalupe","city":"Cebu City","region":"Central Visayas","postalCode":"6000","countryCode":"PH"}', 10.3047, 123.8871, 'CEBU_CITY', 'CEBU_CITY_CORE', 1, NULL, 'active', 1, 1786000005000, 1786000005000, 1, NULL, '{"addressLine1":"V Rama Avenue","barangay":"Guadalupe","city":"Cebu City","region":"Central Visayas","postalCode":"6000","countryCode":"PH"}', 'Guadalupe', 'Cebu City', '6000', 'USER_PIN', 1786000005000, '{}'),
  ('seed-address-maria', 'seed-customer-maria', 'Home', 'Maria Flores', '+639171110107', '{"addressLine1":"Escario Street","barangay":"Camputhaw","city":"Cebu City","region":"Central Visayas","postalCode":"6000","countryCode":"PH"}', 10.3170, 123.8956, 'CEBU_CITY', 'CEBU_CITY_CORE', 1, NULL, 'active', 1, 1786000006000, 1786000006000, 1, NULL, '{"addressLine1":"Escario Street","barangay":"Camputhaw","city":"Cebu City","region":"Central Visayas","postalCode":"6000","countryCode":"PH"}', 'Camputhaw', 'Cebu City', '6000', 'GEOCODER', 1786000006000, '{}'),
  ('seed-address-ben', 'seed-customer-ben', 'Home', 'Ben Torres', '+639171110108', '{"addressLine1":"Colon Street","barangay":"Kalubihan","city":"Cebu City","region":"Central Visayas","postalCode":"6000","countryCode":"PH"}', 10.2955, 123.9017, 'CEBU_CITY', 'CEBU_CITY_CORE', 1, NULL, 'inactive', 2, 1786000007000, 1788304500000, 1, NULL, '{"addressLine1":"Colon Street","barangay":"Kalubihan","city":"Cebu City","region":"Central Visayas","postalCode":"6000","countryCode":"PH"}', 'Kalubihan', 'Cebu City', '6000', 'USER_PIN', 1786000007000, '{}');

INSERT OR IGNORE INTO customer_segment (id, code, name, status, version)
VALUES
  ('seed-segment-loyal', 'LOYAL', 'Loyal customers', 'ACTIVE', 1),
  ('seed-segment-new', 'NEW', 'New customers', 'ACTIVE', 1),
  ('seed-segment-at-risk', 'AT_RISK', 'At-risk customers', 'ACTIVE', 1);

INSERT OR IGNORE INTO customer_segment_assignment (customer_id, segment_id, assigned_at)
VALUES
  ('seed-customer-ana', 'seed-segment-loyal', 1787184000000),
  ('seed-customer-miguel', 'seed-segment-new', 1788221400000),
  ('seed-customer-carla', 'seed-segment-at-risk', 1788304500000),
  ('seed-customer-ben', 'seed-segment-at-risk', 1788304500000);

INSERT OR IGNORE INTO privacy_request
  (id, customer_id, request_type, status, requested_at, verified_at, resolved_at,
   assigned_staff_id, reason, resolution, version, idempotency_key, created_at, updated_at)
VALUES
  ('seed-privacy-ben', 'seed-customer-ben', 'CLOSURE', 'SUBMITTED', 1788304500000,
   NULL, NULL, 'staff_local_admin', 'Customer requested account closure', NULL, 1,
   'seed-privacy-ben-key', 1788304500000, 1788304500000);

-- Membership spectrum.
INSERT OR IGNORE INTO payment_authorization
  (id, customer_id, provider, provider_authorization_ref, provider_method_ref,
   recurring_capable, status, established_at, revoked_at, created_at, updated_at)
VALUES
  ('seed-auth-ana', 'seed-customer-ana', 'mock', 'seed-auth-ref-ana', 'seed-method-ana', 1, 'ACTIVE', 1786000000000, NULL, 1786000000000, 1786000000000),
  ('seed-auth-miguel', 'seed-customer-miguel', 'mock', 'seed-auth-ref-miguel', 'seed-method-miguel', 1, 'ACTIVE', 1786000001000, NULL, 1786000001000, 1786000001000),
  ('seed-auth-carla', 'seed-customer-carla', 'mock', 'seed-auth-ref-carla', 'seed-method-carla', 1, 'ACTIVE', 1786000002000, NULL, 1786000002000, 1786000002000),
  ('seed-auth-ramon', 'seed-customer-ramon', 'mock', 'seed-auth-ref-ramon', 'seed-method-ramon', 1, 'ACTIVE', 1786000003000, NULL, 1786000003000, 1786000003000),
  ('seed-auth-jose', 'seed-customer-jose', 'mock', 'seed-auth-ref-jose', 'seed-method-jose', 1, 'REVOKED', 1786000005000, 1788165900000, 1786000005000, 1788165900000),
  ('seed-auth-maria', 'seed-customer-maria', 'mock', 'seed-auth-ref-maria', 'seed-method-maria', 1, 'ACTIVE', 1786000006000, NULL, 1786000006000, 1786000006000);

INSERT OR IGNORE INTO subscription
  (id, customer_id, offer_id, status, starts_at, ends_at, trial_ends_at, created_at,
   updated_at, version, billing_starts_at, current_period_starts_at,
   current_period_ends_at, paused_at, resume_at, cancel_at_period_end,
   cancellation_requested_at, scheduled_cancellation_at, ended_at,
   payment_authorization_id, grace_ends_at, nominal_billing_day,
   agreed_price_version_id, agreed_amount_minor, agreed_currency)
VALUES
  ('seed-sub-ana', 'seed-customer-ana', 'offer-membership-monthly', 'ACTIVE', 1786000000000, NULL, NULL, 1786000000000, 1788304500000, 2, 1786000000000, 1788220800000, 1790899200000, NULL, NULL, 0, NULL, NULL, NULL, 'seed-auth-ana', NULL, 2, 'membership-price-version-1', 29900, 'PHP'),
  ('seed-sub-miguel', 'seed-customer-miguel', 'offer-membership-monthly', 'TRIALING', 1788221400000, NULL, 1790899200000, 1788221400000, 1788221400000, 1, 1790899200000, 1788221400000, 1790899200000, NULL, NULL, 0, NULL, NULL, NULL, 'seed-auth-miguel', NULL, 1, 'membership-price-version-1', 29900, 'PHP'),
  ('seed-sub-carla', 'seed-customer-carla', 'offer-membership-monthly', 'PAST_DUE', 1786000002000, NULL, NULL, 1786000002000, 1788304500000, 4, 1786000002000, 1787535000000, 1788220800000, NULL, NULL, 0, NULL, NULL, NULL, 'seed-auth-carla', 1788825600000, 24, 'membership-price-version-1', 29900, 'PHP'),
  ('seed-sub-ramon', 'seed-customer-ramon', 'offer-membership-monthly', 'UNPAID', 1786000003000, NULL, NULL, 1786000003000, 1788165900000, 3, 1786000003000, 1787535000000, 1790208000000, NULL, NULL, 0, NULL, NULL, NULL, 'seed-auth-ramon', NULL, 24, 'membership-price-version-1', 29900, 'PHP'),
  ('seed-sub-jose', 'seed-customer-jose', 'offer-membership-monthly', 'CANCELED', 1786000005000, 1788165900000, NULL, 1786000005000, 1788165900000, 3, 1786000005000, 1786000005000, 1788165900000, NULL, NULL, 0, 1787968800000, NULL, 1788165900000, 'seed-auth-jose', NULL, 20, 'membership-price-version-1', 29900, 'PHP'),
  ('seed-sub-maria', 'seed-customer-maria', 'offer-membership-monthly', 'ACTIVE', 1786000006000, NULL, NULL, 1786000006000, 1788304500000, 2, 1786000006000, 1788220800000, 1790899200000, NULL, NULL, 1, 1788304500000, 1790899200000, NULL, 'seed-auth-maria', NULL, 2, 'membership-price-version-1', 29900, 'PHP');

-- Carts and checkout evidence for nine committed Orders plus one action-required checkout.
INSERT OR IGNORE INTO cart (id, customer_id, location_id, status, version, created_at, updated_at)
VALUES
  ('seed-cart-101', 'seed-customer-ana', 'location-cebu-central', 'CHECKED_OUT', 2, 1787184000000, 1787184000000),
  ('seed-cart-102', 'seed-customer-miguel', 'location-cebu-central', 'CHECKED_OUT', 2, 1787535000000, 1787535000000),
  ('seed-cart-103', 'seed-customer-carla', 'location-cebu-central', 'CHECKED_OUT', 2, 1787811300000, 1787811300000),
  ('seed-cart-104', 'seed-customer-ramon', 'location-cebu-central', 'CHECKED_OUT', 2, 1787968800000, 1787968800000),
  ('seed-cart-105', 'seed-customer-liza', 'location-cebu-central', 'CHECKED_OUT', 2, 1788165900000, 1788165900000),
  ('seed-cart-106', 'seed-customer-jose', 'location-cebu-central', 'CHECKED_OUT', 2, 1788221400000, 1788221400000),
  ('seed-cart-107', 'seed-customer-maria', 'location-cebu-central', 'CHECKED_OUT', 2, 1788237000000, 1788237000000),
  ('seed-cart-108', 'seed-customer-ben', 'location-cebu-central', 'CHECKED_OUT', 2, 1788258000000, 1788258000000),
  ('seed-cart-109', 'seed-customer-ana', 'location-cebu-central', 'CHECKED_OUT', 2, 1788304500000, 1788304500000),
  ('seed-cart-action', 'seed-customer-liza', 'location-cebu-central', 'ACTIVE', 1, 1788310800000, 1788310800000);

INSERT OR IGNORE INTO cart_item (cart_id, sku_id, quantity)
VALUES ('seed-cart-action', 'sku-abiu-1pc', 1);

INSERT OR IGNORE INTO checkout_attempts
  (id, customer_id, cart_id, address_id, cycle_id, fulfillment_mode, zone_id,
   location_id, quote_version, status, idempotency_key, expires_at, version,
   created_at, updated_at)
VALUES
  ('seed-attempt-101','seed-customer-ana','seed-cart-101','seed-address-ana','cycle-next-cebu','SCHEDULED','zone-cebu-city-core','location-cebu-central',1,'SUCCEEDED','seed-attempt-key-101',1788445035000,1,1787184000000,1787184000000),
  ('seed-attempt-102','seed-customer-miguel','seed-cart-102','seed-address-miguel','cycle-next-cebu','SCHEDULED','zone-cebu-city-core','location-cebu-central',1,'SUCCEEDED','seed-attempt-key-102',1788445035000,1,1787535000000,1787535000000),
  ('seed-attempt-103','seed-customer-carla','seed-cart-103','seed-address-carla','cycle-next-cebu','SCHEDULED','zone-cebu-city-core','location-cebu-central',1,'SUCCEEDED','seed-attempt-key-103',1788445035000,1,1787811300000,1787811300000),
  ('seed-attempt-104','seed-customer-ramon','seed-cart-104','seed-address-ramon','cycle-next-cebu','SCHEDULED','zone-cebu-city-core','location-cebu-central',1,'SUCCEEDED','seed-attempt-key-104',1788445035000,1,1787968800000,1787968800000),
  ('seed-attempt-105','seed-customer-liza','seed-cart-105','seed-address-liza',NULL,'INSTANT','zone-cebu-city-core','location-cebu-central',1,'SUCCEEDED','seed-attempt-key-105',1788173100000,1,1788165900000,1788165900000),
  ('seed-attempt-106','seed-customer-jose','seed-cart-106','seed-address-jose',NULL,'INSTANT','zone-cebu-city-core','location-cebu-central',1,'SUCCEEDED','seed-attempt-key-106',1788228600000,1,1788221400000,1788221400000),
  ('seed-attempt-107','seed-customer-maria','seed-cart-107','seed-address-maria','cycle-next-cebu','SCHEDULED','zone-cebu-city-core','location-cebu-central',1,'SUCCEEDED','seed-attempt-key-107',1788445035000,1,1788237000000,1788237000000),
  ('seed-attempt-108','seed-customer-ben','seed-cart-108','seed-address-ben','cycle-next-cebu','SCHEDULED','zone-cebu-city-core','location-cebu-central',1,'SUCCEEDED','seed-attempt-key-108',1788445035000,1,1788258000000,1788258000000),
  ('seed-attempt-109','seed-customer-ana','seed-cart-109','seed-address-ana',NULL,'INSTANT','zone-cebu-city-core','location-cebu-central',1,'SUCCEEDED','seed-attempt-key-109',1788311700000,1,1788304500000,1788304500000),
  ('seed-attempt-action','seed-customer-liza','seed-cart-action','seed-address-liza',NULL,'INSTANT','zone-cebu-city-core','location-cebu-central',1,'PROCESSING','seed-attempt-key-action',1788328800000,1,1788310800000,1788310800000);

INSERT OR IGNORE INTO checkout_quote
  (id, attempt_id, customer_id, cart_id, address_id, delivery_cycle_id,
   fulfillment_mode, currency, subtotal_minor, discount_minor, delivery_fee_minor,
   total_minor, lines_json, address_snapshot_json, cycle_snapshot_json,
   fulfillment_snapshot_json, status, version, expires_at, idempotency_key,
   created_at, updated_at, merchandise_subtotal_minor, delivery_subtotal_minor,
   service_fee_minor, pre_service_fee_total_minor, service_fee_configuration_id,
   service_fee_snapshot_json)
VALUES
  ('seed-quote-101','seed-attempt-101','seed-customer-ana','seed-cart-101','seed-address-ana','cycle-next-cebu','SCHEDULED','PHP',40700,0,5000,45700,'[]',NULL,'{}','{}','CONSUMED',1,1788445035000,'seed-quote-key-101',1787184000000,1787184000000,40700,5000,0,45700,NULL,NULL),
  ('seed-quote-102','seed-attempt-102','seed-customer-miguel','seed-cart-102','seed-address-miguel','cycle-next-cebu','SCHEDULED','PHP',30900,0,4500,35400,'[]',NULL,'{}','{}','CONSUMED',1,1788445035000,'seed-quote-key-102',1787535000000,1787535000000,30900,4500,0,35400,NULL,NULL),
  ('seed-quote-103','seed-attempt-103','seed-customer-carla','seed-cart-103','seed-address-carla','cycle-next-cebu','SCHEDULED','PHP',26450,0,5000,31450,'[]',NULL,'{}','{}','CONSUMED',1,1788445035000,'seed-quote-key-103',1787811300000,1787811300000,26450,5000,0,31450,NULL,NULL),
  ('seed-quote-104','seed-attempt-104','seed-customer-ramon','seed-cart-104','seed-address-ramon','cycle-next-cebu','SCHEDULED','PHP',24900,0,4500,29400,'[]',NULL,'{}','{}','CONSUMED',1,1788445035000,'seed-quote-key-104',1787968800000,1787968800000,24900,4500,0,29400,NULL,NULL),
  ('seed-quote-105','seed-attempt-105','seed-customer-liza','seed-cart-105','seed-address-liza',NULL,'INSTANT','PHP',20700,0,5000,27200,'[]',NULL,NULL,'{}','CONSUMED',1,1788173100000,'seed-quote-key-105',1788165900000,1788165900000,20700,5000,1500,25700,'seed-service-fee-v1','{"feeType":"FLAT","flatMinor":1500}'),
  ('seed-quote-106','seed-attempt-106','seed-customer-jose','seed-cart-106','seed-address-jose',NULL,'INSTANT','PHP',27400,0,5000,33900,'[]',NULL,NULL,'{}','CONSUMED',1,1788228600000,'seed-quote-key-106',1788221400000,1788221400000,27400,5000,1500,32400,'seed-service-fee-v1','{"feeType":"FLAT","flatMinor":1500}'),
  ('seed-quote-107','seed-attempt-107','seed-customer-maria','seed-cart-107','seed-address-maria','cycle-next-cebu','SCHEDULED','PHP',40700,0,5000,45700,'[]',NULL,'{}','{}','CONSUMED',1,1788445035000,'seed-quote-key-107',1788237000000,1788237000000,40700,5000,0,45700,NULL,NULL),
  ('seed-quote-108','seed-attempt-108','seed-customer-ben','seed-cart-108','seed-address-ben','cycle-next-cebu','SCHEDULED','PHP',32500,0,5000,37500,'[]',NULL,'{}','{}','CONSUMED',1,1788445035000,'seed-quote-key-108',1788258000000,1788258000000,32500,5000,0,37500,NULL,NULL),
  ('seed-quote-109','seed-attempt-109','seed-customer-ana','seed-cart-109','seed-address-ana',NULL,'INSTANT','PHP',22350,0,5000,28850,'[]',NULL,NULL,'{}','CONSUMED',1,1788311700000,'seed-quote-key-109',1788304500000,1788304500000,22350,5000,1500,27350,'seed-service-fee-v1','{"feeType":"FLAT","flatMinor":1500}'),
  ('seed-quote-action','seed-attempt-action','seed-customer-liza','seed-cart-action','seed-address-liza',NULL,'INSTANT','PHP',8500,0,5000,15000,'[]',NULL,NULL,'{}','ACTIVE',1,1788328800000,'seed-quote-key-action',1788310800000,1788310800000,8500,5000,1500,13500,'seed-service-fee-v1','{"feeType":"FLAT","flatMinor":1500}');

-- Payment intents and provider-neutral attempts.
INSERT OR IGNORE INTO payment_intent
  (id, purpose, subject_type, subject_id, customer_id, amount_minor, currency,
   status, idempotency_key, version, created_at, updated_at)
VALUES
  ('seed-pi-101','GROCERY_CHECKOUT','checkout_quote','seed-quote-101','seed-customer-ana',45700,'PHP','SUCCEEDED','seed-pi-key-101',1,1787184000000,1787184000000),
  ('seed-pi-102','GROCERY_CHECKOUT','checkout_quote','seed-quote-102','seed-customer-miguel',35400,'PHP','SUCCEEDED','seed-pi-key-102',1,1787535000000,1787535000000),
  ('seed-pi-103','GROCERY_CHECKOUT','checkout_quote','seed-quote-103','seed-customer-carla',31450,'PHP','SUCCEEDED','seed-pi-key-103',1,1787811300000,1787811300000),
  ('seed-pi-104','GROCERY_CHECKOUT','checkout_quote','seed-quote-104','seed-customer-ramon',29400,'PHP','SUCCEEDED','seed-pi-key-104',1,1787968800000,1787968800000),
  ('seed-pi-105','GROCERY_CHECKOUT','checkout_quote','seed-quote-105','seed-customer-liza',27200,'PHP','SUCCEEDED','seed-pi-key-105',1,1788165900000,1788165900000),
  ('seed-pi-106','GROCERY_CHECKOUT','checkout_quote','seed-quote-106','seed-customer-jose',33900,'PHP','SUCCEEDED','seed-pi-key-106',2,1788221400000,1788328800000),
  ('seed-pi-107','GROCERY_CHECKOUT','checkout_quote','seed-quote-107','seed-customer-maria',45700,'PHP','REFUNDED','seed-pi-key-107',3,1788237000000,1788328800000),
  ('seed-pi-108','GROCERY_CHECKOUT','checkout_quote','seed-quote-108','seed-customer-ben',37500,'PHP','SUCCEEDED','seed-pi-key-108',1,1788258000000,1788258000000),
  ('seed-pi-109','GROCERY_CHECKOUT','checkout_quote','seed-quote-109','seed-customer-ana',28850,'PHP','PARTIALLY_REFUNDED','seed-pi-key-109',2,1788304500000,1788328800000),
  ('seed-pi-membership-ana','MEMBERSHIP_ENROLLMENT','subscription','seed-sub-ana','seed-customer-ana',29900,'PHP','SUCCEEDED','seed-pi-key-membership-ana',1,1786000000000,1786000000000),
  ('seed-pi-renewal-carla','MEMBERSHIP_RENEWAL','subscription','seed-sub-carla','seed-customer-carla',29900,'PHP','FAILED','seed-pi-key-renewal-carla',2,1788221400000,1788237000000),
  ('seed-pi-action-liza','GROCERY_CHECKOUT','checkout_quote','seed-quote-action','seed-customer-liza',15000,'PHP','REQUIRES_ACTION','seed-pi-key-action-liza',1,1788310800000,1788310800000),
  ('seed-pi-processing-miguel','MEMBERSHIP_RENEWAL','subscription','seed-sub-miguel','seed-customer-miguel',29900,'PHP','PROCESSING','seed-pi-key-processing-miguel',1,1788310800000,1788310800000);

INSERT OR IGNORE INTO payment_attempt
  (id, customer_id, amount_minor, currency, status, provider, provider_reference,
   idempotency_key, created_at, updated_at, version, checkout_attempt_id,
   payment_intent_id)
VALUES
  ('seed-pay-101','seed-customer-ana',45700,'PHP','SUCCEEDED','mock','seed-provider-101','seed-pay-key-101',1787184000000,1787184000000,1,'seed-attempt-101','seed-pi-101'),
  ('seed-pay-102','seed-customer-miguel',35400,'PHP','SUCCEEDED','mock','seed-provider-102','seed-pay-key-102',1787535000000,1787535000000,1,'seed-attempt-102','seed-pi-102'),
  ('seed-pay-103','seed-customer-carla',31450,'PHP','SUCCEEDED','mock','seed-provider-103','seed-pay-key-103',1787811300000,1787811300000,1,'seed-attempt-103','seed-pi-103'),
  ('seed-pay-104','seed-customer-ramon',29400,'PHP','SUCCEEDED','mock','seed-provider-104','seed-pay-key-104',1787968800000,1787968800000,1,'seed-attempt-104','seed-pi-104'),
  ('seed-pay-105','seed-customer-liza',27200,'PHP','SUCCEEDED','mock','seed-provider-105','seed-pay-key-105',1788165900000,1788165900000,1,'seed-attempt-105','seed-pi-105'),
  ('seed-pay-106','seed-customer-jose',33900,'PHP','SUCCEEDED','mock','seed-provider-106','seed-pay-key-106',1788221400000,1788221400000,1,'seed-attempt-106','seed-pi-106'),
  ('seed-pay-107','seed-customer-maria',45700,'PHP','SUCCEEDED','mock','seed-provider-107','seed-pay-key-107',1788237000000,1788237000000,1,'seed-attempt-107','seed-pi-107'),
  ('seed-pay-108','seed-customer-ben',37500,'PHP','SUCCEEDED','mock','seed-provider-108','seed-pay-key-108',1788258000000,1788258000000,1,'seed-attempt-108','seed-pi-108'),
  ('seed-pay-109','seed-customer-ana',28850,'PHP','SUCCEEDED','mock','seed-provider-109','seed-pay-key-109',1788304500000,1788304500000,1,'seed-attempt-109','seed-pi-109'),
  ('seed-pay-membership-ana','seed-customer-ana',29900,'PHP','SUCCEEDED','mock','seed-provider-membership-ana','seed-pay-key-membership-ana',1786000000000,1786000000000,1,NULL,'seed-pi-membership-ana'),
  ('seed-pay-renewal-carla','seed-customer-carla',29900,'PHP','FAILED','mock','seed-provider-renewal-carla','seed-pay-key-renewal-carla',1788221400000,1788237000000,2,NULL,'seed-pi-renewal-carla'),
  ('seed-pay-action-liza','seed-customer-liza',15000,'PHP','REQUIRES_ACTION','mock','seed-provider-action-liza','seed-pay-key-action-liza',1788310800000,1788310800000,1,'seed-attempt-action','seed-pi-action-liza'),
  ('seed-pay-processing-miguel','seed-customer-miguel',29900,'PHP','PROCESSING','mock','seed-provider-processing-miguel','seed-pay-key-processing-miguel',1788310800000,1788310800000,1,NULL,'seed-pi-processing-miguel');

-- Immutable Order snapshots. Scheduled rows retain the launch cycle; Instant rows have no cycle.
INSERT OR IGNORE INTO grocery_order
  (id, customer_id, cycle_id, fulfillment_mode, address_snapshot_json, status,
   total_minor, currency, payment_id, version, created_at, merchandise_subtotal_minor,
   delivery_subtotal_minor, service_fee_minor, order_number, committed_at,
   pre_service_fee_total_minor, service_fee_configuration_id, service_fee_snapshot_json)
VALUES
  ('seed-order-101','seed-customer-ana','cycle-next-cebu','SCHEDULED','{"recipient":"Ana Santos","phone":"+639171110101","address_json":"{\"addressLine1\":\"Ayala Center Cebu\",\"barangay\":\"Luz\",\"city\":\"Cebu City\",\"region\":\"Central Visayas\",\"postalCode\":\"6000\"}"}','DELIVERED',45700,'PHP','seed-pay-101',6,1787184000000,40700,5000,0,'FM-2026-000101',1787184000000,45700,NULL,NULL),
  ('seed-order-102','seed-customer-miguel','cycle-next-cebu','SCHEDULED','{"recipient":"Miguel dela Cruz","phone":"+639171110102","address_json":"{\"addressLine1\":\"IT Park\",\"addressLine2\":\"Tower 2\",\"barangay\":\"Apas\",\"city\":\"Cebu City\",\"postalCode\":\"6000\"}"}','OUT_FOR_DELIVERY',35400,'PHP','seed-pay-102',5,1787535000000,30900,4500,0,'FM-2026-000102',1787535000000,35400,NULL,NULL),
  ('seed-order-103','seed-customer-carla','cycle-next-cebu','SCHEDULED','{"recipient":"Carla Lim","phone":"+639171110103","address_json":"{\"addressLine1\":\"Cebu Business Park\",\"barangay\":\"Luz\",\"city\":\"Cebu City\",\"postalCode\":\"6000\"}"}','FULFILLMENT_READY',31450,'PHP','seed-pay-103',4,1787811300000,26450,5000,0,'FM-2026-000103',1787811300000,31450,NULL,NULL),
  ('seed-order-104','seed-customer-ramon','cycle-next-cebu','SCHEDULED','{"recipient":"Ramon Garcia","phone":"+639171110104","address_json":"{\"addressLine1\":\"Banilad Town Centre\",\"barangay\":\"Banilad\",\"city\":\"Cebu City\",\"postalCode\":\"6000\"}"}','FULFILLMENT_PENDING',29400,'PHP','seed-pay-104',3,1787968800000,24900,4500,0,'FM-2026-000104',1787968800000,29400,NULL,NULL),
  ('seed-order-105','seed-customer-liza',NULL,'INSTANT','{"recipient":"Liza Mendoza","phone":"+639171110105","address_json":"{\"addressLine1\":\"Fuente Osmena Circle\",\"barangay\":\"Capitol Site\",\"city\":\"Cebu City\",\"postalCode\":\"6000\"}"}','COMMITTED',27200,'PHP','seed-pay-105',1,1788165900000,20700,5000,1500,'FM-2026-000105',1788165900000,25700,'seed-service-fee-v1','{"feeType":"FLAT","flatMinor":1500}'),
  ('seed-order-106','seed-customer-jose',NULL,'INSTANT','{"recipient":"Jose Villanueva","phone":"+639171110106","address_json":"{\"addressLine1\":\"V Rama Avenue\",\"barangay\":\"Guadalupe\",\"city\":\"Cebu City\",\"postalCode\":\"6000\"}"}','CANCELLATION_REQUESTED',33900,'PHP','seed-pay-106',3,1788221400000,27400,5000,1500,'FM-2026-000106',1788221400000,32400,'seed-service-fee-v1','{"feeType":"FLAT","flatMinor":1500}'),
  ('seed-order-107','seed-customer-maria','cycle-next-cebu','SCHEDULED','{"recipient":"Maria Flores","phone":"+639171110107","address_json":"{\"addressLine1\":\"Escario Street\",\"barangay\":\"Camputhaw\",\"city\":\"Cebu City\",\"postalCode\":\"6000\"}"}','CANCELED',45700,'PHP','seed-pay-107',4,1788237000000,40700,5000,0,'FM-2026-000107',1788237000000,45700,NULL,NULL),
  ('seed-order-108','seed-customer-ben','cycle-next-cebu','SCHEDULED','{"recipient":"Ben Torres","phone":"+639171110108","address_json":"{\"addressLine1\":\"Colon Street\",\"barangay\":\"Kalubihan\",\"city\":\"Cebu City\",\"postalCode\":\"6000\"}"}','EXCEPTION',37500,'PHP','seed-pay-108',3,1788258000000,32500,5000,0,'FM-2026-000108',1788258000000,37500,NULL,NULL),
  ('seed-order-109','seed-customer-ana',NULL,'INSTANT','{"recipient":"Ana Santos","phone":"+639171110101","address_json":"{\"addressLine1\":\"Ayala Center Cebu\",\"barangay\":\"Luz\",\"city\":\"Cebu City\",\"postalCode\":\"6000\"}"}','DELIVERED',28850,'PHP','seed-pay-109',6,1788304500000,22350,5000,1500,'FM-2026-000109',1788304500000,27350,'seed-service-fee-v1','{"feeType":"FLAT","flatMinor":1500}');

INSERT OR IGNORE INTO order_item
  (id, order_id, sku_id, product_name_snapshot, variant_name_snapshot, unit_snapshot,
   quantity, unit_price_minor, line_total_minor, base_quantity)
VALUES
  ('seed-item-101-a','seed-order-101','sku-red-onion-500g','Red onion','500 g','GRAM',2,12900,25800,1000),
  ('seed-item-101-b','seed-order-101','sku-eggs-12','Farm eggs','12 pack','PIECE',1,14900,14900,12),
  ('seed-item-102-a','seed-order-102','sku-avocado-500g','Creamy Avocado','500 g','GRAM',2,9450,18900,1000),
  ('seed-item-102-b','seed-order-102','sku-asparagus-500g','Asparagus','500 g','GRAM',1,12000,12000,500),
  ('seed-item-103-a','seed-order-103','sku-abiu-1pc','Abiu','1 piece','PIECE',2,8500,17000,2),
  ('seed-item-103-b','seed-order-103','sku-avocado-500g','Creamy Avocado','500 g','GRAM',1,9450,9450,500),
  ('seed-item-104-a','seed-order-104','sku-red-onion-500g','Red onion','500 g','GRAM',1,12900,12900,500),
  ('seed-item-104-b','seed-order-104','sku-asparagus-500g','Asparagus','500 g','GRAM',1,12000,12000,500),
  ('seed-item-105-a','seed-order-105','sku-eggs-6','Farm eggs','6 pack','PIECE',1,7800,7800,6),
  ('seed-item-105-b','seed-order-105','sku-red-onion-500g','Red onion','500 g','GRAM',1,12900,12900,500),
  ('seed-item-106-a','seed-order-106','sku-avocado-500g','Creamy Avocado','500 g','GRAM',2,9450,18900,1000),
  ('seed-item-106-b','seed-order-106','sku-abiu-1pc','Abiu','1 piece','PIECE',1,8500,8500,1),
  ('seed-item-107-a','seed-order-107','sku-red-onion-1kg','Red onion','1 kg','GRAM',1,25800,25800,1000),
  ('seed-item-107-b','seed-order-107','sku-eggs-12','Farm eggs','12 pack','PIECE',1,14900,14900,12),
  ('seed-item-108-a','seed-order-108','sku-asparagus-500g','Asparagus','500 g','GRAM',2,12000,24000,1000),
  ('seed-item-108-b','seed-order-108','sku-abiu-1pc','Abiu','1 piece','PIECE',1,8500,8500,1),
  ('seed-item-109-a','seed-order-109','sku-red-onion-500g','Red onion','500 g','GRAM',1,12900,12900,500),
  ('seed-item-109-b','seed-order-109','sku-avocado-500g','Creamy Avocado','500 g','GRAM',1,9450,9450,500);

INSERT OR IGNORE INTO payment_reaction
  (id, payment_intent_id, reaction_type, subject_type, subject_id, status,
   idempotency_key, attempts, last_error_code, available_at, created_at, updated_at)
SELECT 'seed-reaction-' || substr(id, 9), id, 'COMMIT_ORDER', 'checkout_quote', subject_id,
       'SUCCEEDED', 'seed-reaction-key-' || substr(id, 9), 1, NULL, created_at, created_at, updated_at
FROM payment_intent WHERE id BETWEEN 'seed-pi-101' AND 'seed-pi-109';

INSERT OR IGNORE INTO order_payment_reaction
  (id, payment_intent_id, reaction_id, order_id, applied_at, checkout_quote_id)
VALUES
  ('seed-opr-101','seed-pi-101','seed-reaction-101','seed-order-101',1787184000000,'seed-quote-101'),
  ('seed-opr-102','seed-pi-102','seed-reaction-102','seed-order-102',1787535000000,'seed-quote-102'),
  ('seed-opr-103','seed-pi-103','seed-reaction-103','seed-order-103',1787811300000,'seed-quote-103'),
  ('seed-opr-104','seed-pi-104','seed-reaction-104','seed-order-104',1787968800000,'seed-quote-104'),
  ('seed-opr-105','seed-pi-105','seed-reaction-105','seed-order-105',1788165900000,'seed-quote-105'),
  ('seed-opr-106','seed-pi-106','seed-reaction-106','seed-order-106',1788221400000,'seed-quote-106'),
  ('seed-opr-107','seed-pi-107','seed-reaction-107','seed-order-107',1788237000000,'seed-quote-107'),
  ('seed-opr-108','seed-pi-108','seed-reaction-108','seed-order-108',1788258000000,'seed-quote-108'),
  ('seed-opr-109','seed-pi-109','seed-reaction-109','seed-order-109',1788304500000,'seed-quote-109');

INSERT OR IGNORE INTO order_invoice_readiness
  (id, order_id, payment_id, payment_intent_id, status, invoice_identifier, issued_at,
   seller_snapshot_json, buyer_snapshot_json, financial_snapshot_json, blocked_reason,
   created_at, updated_at, version)
SELECT 'seed-invoice-' || substr(o.id, 12), o.id, o.payment_id, opr.payment_intent_id,
       'PENDING_TAX_CONFIGURATION', NULL, NULL, NULL,
       json_object('recipient', json_extract(o.address_snapshot_json, '$.recipient')),
       json_object('totalMinor', o.total_minor, 'currency', o.currency),
       'Official accounting policy is not configured', o.committed_at, o.committed_at, 1
FROM grocery_order o JOIN order_payment_reaction opr ON opr.order_id=o.id
WHERE o.id LIKE 'seed-order-%';

-- Fulfillment and delivery read models.
INSERT OR IGNORE INTO order_fulfillment_snapshot
  (order_id, location_id, cycle_id, zone_id, cutoff_at, delivery_date, promised_at,
   fulfillment_mode, sourcing_modes_json, created_at, delivery_fee_snapshot_json)
VALUES
  ('seed-order-101','location-cebu-central','cycle-next-cebu','zone-cebu-city-core',1788445035000,1788617835000,NULL,'SCHEDULED','["PLANNED"]',1787184000000,'{"amountMinor":5000}'),
  ('seed-order-102','location-cebu-central','cycle-next-cebu','zone-cebu-city-core',1788445035000,1788617835000,NULL,'SCHEDULED','["PLANNED"]',1787535000000,'{"amountMinor":4500}'),
  ('seed-order-103','location-cebu-central','cycle-next-cebu','zone-cebu-city-core',1788445035000,1788617835000,NULL,'SCHEDULED','["PLANNED"]',1787811300000,'{"amountMinor":5000}'),
  ('seed-order-104','location-cebu-central','cycle-next-cebu','zone-cebu-city-core',1788445035000,1788617835000,NULL,'SCHEDULED','["PLANNED"]',1787968800000,'{"amountMinor":4500}'),
  ('seed-order-105','location-cebu-central',NULL,'zone-cebu-city-core',NULL,NULL,1788173100000,'INSTANT','["STOCKED"]',1788165900000,'{"amountMinor":5000}'),
  ('seed-order-106','location-cebu-central',NULL,'zone-cebu-city-core',NULL,NULL,1788228600000,'INSTANT','["STOCKED"]',1788221400000,'{"amountMinor":5000}'),
  ('seed-order-107','location-cebu-central','cycle-next-cebu','zone-cebu-city-core',1788445035000,1788617835000,NULL,'SCHEDULED','["PLANNED"]',1788237000000,'{"amountMinor":5000}'),
  ('seed-order-108','location-cebu-central','cycle-next-cebu','zone-cebu-city-core',1788445035000,1788617835000,NULL,'SCHEDULED','["PLANNED"]',1788258000000,'{"amountMinor":5000}'),
  ('seed-order-109','location-cebu-central',NULL,'zone-cebu-city-core',NULL,NULL,1788311700000,'INSTANT','["STOCKED"]',1788304500000,'{"amountMinor":5000}');

INSERT OR IGNORE INTO fulfillment_record (id, order_id, location_id, status, updated_at, version)
VALUES
  ('seed-fulfillment-101','seed-order-101','location-cebu-central','COMPLETED',1787535000000,7),
  ('seed-fulfillment-102','seed-order-102','location-cebu-central','HANDED_OFF',1788310800000,6),
  ('seed-fulfillment-103','seed-order-103','location-cebu-central','PACKED',1788304500000,5),
  ('seed-fulfillment-104','seed-order-104','location-cebu-central','PICKING',1788304500000,2),
  ('seed-fulfillment-105','seed-order-105','location-cebu-central','NOT_STARTED',1788165900000,1),
  ('seed-fulfillment-106','seed-order-106','location-cebu-central','CANCELED',1788328800000,3),
  ('seed-fulfillment-107','seed-order-107','location-cebu-central','CANCELED',1788328800000,3),
  ('seed-fulfillment-108','seed-order-108','location-cebu-central','SHORTED',1788328800000,3),
  ('seed-fulfillment-109','seed-order-109','location-cebu-central','COMPLETED',1788328800000,7);

INSERT OR IGNORE INTO delivery_job
  (id, order_id, cycle_id, fulfillment_mode, location_id, zone_id, rider_user_id,
   promised_at, status, address_snapshot_json, delivered_at, version, created_at, updated_at)
SELECT 'seed-delivery-' || substr(o.id, 12), o.id, o.cycle_id, o.fulfillment_mode,
       'location-cebu-central', 'zone-cebu-city-core',
       CASE WHEN o.status IN ('OUT_FOR_DELIVERY','DELIVERED') THEN 'seed-rider-local' ELSE NULL END,
       ofs.promised_at,
       CASE o.status WHEN 'DELIVERED' THEN 'DELIVERED' WHEN 'OUT_FOR_DELIVERY' THEN 'EN_ROUTE'
         WHEN 'CANCELED' THEN 'CANCELED' WHEN 'CANCELLATION_REQUESTED' THEN 'CANCELED'
         WHEN 'EXCEPTION' THEN 'ESCALATED' ELSE 'UNASSIGNED' END,
       o.address_snapshot_json,
       CASE WHEN o.status='DELIVERED' THEN o.committed_at + 14400000 ELSE NULL END,
       CASE WHEN o.status='DELIVERED' THEN 5 WHEN o.status='OUT_FOR_DELIVERY' THEN 3 ELSE 1 END,
       o.committed_at, CASE WHEN o.status='DELIVERED' THEN o.committed_at + 14400000 ELSE 1788328800000 END
FROM grocery_order o JOIN order_fulfillment_snapshot ofs ON ofs.order_id=o.id
WHERE o.id LIKE 'seed-order-%';

INSERT OR IGNORE INTO delivery_stop
  (id, delivery_job_id, latitude, longitude, address_snapshot_json,
   contact_snapshot_json, instructions_snapshot, status, delivered_at, version,
   created_at, updated_at)
SELECT 'seed-stop-' || substr(o.id, 12), d.id, a.latitude, a.longitude,
       o.address_snapshot_json,
       json_object('recipient', json_extract(o.address_snapshot_json,'$.recipient'),
                   'phone', json_extract(o.address_snapshot_json,'$.phone')),
       NULL, d.status, d.delivered_at, d.version, d.created_at, d.updated_at
FROM grocery_order o
JOIN delivery_job d ON d.order_id=o.id
JOIN customer_address a ON a.customer_id=o.customer_id
WHERE o.id LIKE 'seed-order-%';

INSERT OR IGNORE INTO delivery_event
  (id, delivery_job_id, delivery_stop_id, rider_id, event_type, occurred_at,
   recorded_at, metadata_json, idempotency_key)
VALUES
  ('seed-event-101-delivered','seed-delivery-101','seed-stop-101',NULL,'DELIVERED',1787198400000,1787198400000,'{}','seed-event-key-101'),
  ('seed-event-102-en-route','seed-delivery-102','seed-stop-102',NULL,'EN_ROUTE',1788310800000,1788310800000,'{}','seed-event-key-102'),
  ('seed-event-109-delivered','seed-delivery-109','seed-stop-109',NULL,'DELIVERED',1788318900000,1788318900000,'{}','seed-event-key-109');

-- Refunds, cancellation coordination, reconciliation, and issues.
INSERT OR IGNORE INTO payment_refund
  (id, payment_intent_id, amount_minor, currency, status, reason, idempotency_key,
   provider_refund_reference, version, created_at, updated_at)
VALUES
  ('seed-refund-106','seed-pi-106',32400,'PHP','PROCESSING','Customer requested cancellation','seed-refund-key-106','seed-provider-refund-106',2,1788328800000,1788328800000),
  ('seed-refund-107','seed-pi-107',45700,'PHP','SUCCEEDED','Scheduled order canceled before cutoff','seed-refund-key-107','seed-provider-refund-107',3,1788304500000,1788328800000),
  ('seed-refund-109','seed-pi-109',5000,'PHP','SUCCEEDED','Post-delivery quality adjustment','seed-refund-key-109','seed-provider-refund-109',2,1788328800000,1788328800000);

INSERT OR IGNORE INTO order_cancellation
  (id, order_id, actor_type, cause, reason, status, retained_service_fee_minor,
   required_refund_minor, currency, version, created_at, updated_at)
VALUES
  ('seed-cancel-106','seed-order-106','CUSTOMER','CUSTOMER_REQUEST','Customer changed delivery plans','REFUNDS_PROCESSING',1500,32400,'PHP',2,1788328800000,1788328800000),
  ('seed-cancel-107','seed-order-107','BUSINESS','OPERATIONAL_FAILURE','Delivery capacity was withdrawn','COMPLETED',0,45700,'PHP',3,1788304500000,1788328800000);

INSERT OR IGNORE INTO order_cancellation_refund_member
  (id, cancellation_id, payment_intent_id, required_amount_minor, currency,
   refund_id, status, attempts, created_at, updated_at)
VALUES
  ('seed-cancel-member-106','seed-cancel-106','seed-pi-106',32400,'PHP','seed-refund-106','PROCESSING',1,1788328800000,1788328800000),
  ('seed-cancel-member-107','seed-cancel-107','seed-pi-107',45700,'PHP','seed-refund-107','SUCCEEDED',1,1788304500000,1788328800000);

INSERT OR IGNORE INTO payment_reconciliation_case
  (id, payment_intent_id, category, status, details_json, created_at, resolved_at)
VALUES
  ('seed-recon-processing','seed-pi-processing-miguel','PROVIDER_TIMEOUT','OPEN','{"summary":"Renewal confirmation has not arrived"}',1788328800000,NULL),
  ('seed-recon-failed','seed-pi-renewal-carla','AMBIGUOUS_OUTCOME','RESOLVED','{"summary":"Provider confirmed decline"}',1788237000000,1788304500000);

INSERT OR IGNORE INTO finance_exception
  (id, kind, payment_intent_id, reaction_id, order_id, details_json, attempts,
   last_error_code, status, created_at, resolved_at)
VALUES
  ('seed-finance-exception-108','STOCK_UNAVAILABLE','seed-pi-108','seed-reaction-108','seed-order-108','{"summary":"One packed line was shorted after payment"}',2,'STOCK_SHORT','OPEN',1788328800000,NULL);

INSERT OR IGNORE INTO order_issue
  (id, order_id, customer_id, category, status, details, assigned_staff_id,
   resolution, version, idempotency_key, created_at, updated_at)
VALUES
  ('seed-issue-101','seed-order-101','seed-customer-ana','QUALITY','RESOLVED','One avocado was overripe','staff_local_admin','Partial goodwill refund approved',3,'seed-issue-key-101',1787535000000,1787811300000),
  ('seed-issue-102','seed-order-102','seed-customer-miguel','DELIVERY','SUBMITTED','Please confirm the latest rider ETA',NULL,NULL,1,'seed-issue-key-102',1788328800000,1788328800000),
  ('seed-issue-108','seed-order-108','seed-customer-ben','MISSING_ITEM','ESCALATED','Asparagus line was shorted after payment','staff_local_admin',NULL,3,'seed-issue-key-108',1788304500000,1788328800000),
  ('seed-issue-109','seed-order-109','seed-customer-ana','DAMAGED','INVESTIGATING','Produce packaging arrived crushed','staff_local_admin',NULL,2,'seed-issue-key-109',1788328800000,1788328800000);

INSERT OR IGNORE INTO order_issue_line (issue_id, order_item_id)
VALUES
  ('seed-issue-101','seed-item-101-b'),
  ('seed-issue-108','seed-item-108-a'),
  ('seed-issue-109','seed-item-109-b');

-- Subscription events are inserted after their optional Payment references.
INSERT OR IGNORE INTO subscription_event
  (id, subscription_id, event_type, payment_intent_id, promotion_redemption_id,
   actor_type, details_json, occurred_at, created_at)
VALUES
  ('seed-sub-event-ana','seed-sub-ana','ACTIVATED','seed-pi-membership-ana',NULL,'SYSTEM','{}',1786000000000,1786000000000),
  ('seed-sub-event-miguel','seed-sub-miguel','TRIAL_STARTED',NULL,NULL,'SYSTEM','{}',1788221400000,1788221400000),
  ('seed-sub-event-carla','seed-sub-carla','RENEWAL_FAILED','seed-pi-renewal-carla',NULL,'SYSTEM','{}',1788237000000,1788237000000),
  ('seed-sub-event-ramon','seed-sub-ramon','PROVIDER_SUBSCRIPTION_UNPAID',NULL,NULL,'SYSTEM','{"provider":"mock","reason":"PROVIDER_RETRIES_EXHAUSTED"}',1788165900000,1788165900000),
  ('seed-sub-event-jose','seed-sub-jose','CANCELED',NULL,NULL,'CUSTOMER','{}',1788165900000,1788165900000),
  ('seed-sub-event-maria','seed-sub-maria','CANCELLATION_SCHEDULED',NULL,NULL,'CUSTOMER','{}',1788304500000,1788304500000);

-- Inventory and supply examples. Existing migration balances are never overwritten.
INSERT OR IGNORE INTO inventory_balance
  (location_id, inventory_pool_id, on_hand, reserved, version)
VALUES
  ('location-cebu-central','pool-avocado',125000,2500,2),
  ('location-cebu-central','pool-asparagus',48000,3000,2),
  ('location-cebu-central','pool-abiu',240,8,2);

INSERT OR IGNORE INTO inventory_ledger_entries
  (id, inventory_pool_id, location_id, movement_type, quantity_delta_base,
   reservation_delta_base, reference_type, reference_id, actor_type, actor_id,
   reason_code, metadata_json, created_at, idempotency_key)
VALUES
  ('seed-ledger-avocado','pool-avocado','location-cebu-central','RECEIPT',125000,0,'SEED','seed-receiving-avocado','STAFF','staff_local_admin','DEVELOPMENT_SEED','{}',1787184000000,'seed-ledger-key-avocado'),
  ('seed-ledger-asparagus','pool-asparagus','location-cebu-central','RECEIPT',48000,0,'SEED','seed-receiving-asparagus','STAFF','staff_local_admin','DEVELOPMENT_SEED','{}',1787184000000,'seed-ledger-key-asparagus'),
  ('seed-ledger-abiu','pool-abiu','location-cebu-central','RECEIPT',240,0,'SEED','seed-receiving-abiu','STAFF','staff_local_admin','DEVELOPMENT_SEED','{}',1787184000000,'seed-ledger-key-abiu');

INSERT OR IGNORE INTO inventory_reservation
  (id, order_id, location_id, inventory_pool_id, quantity, status, version)
VALUES
  ('seed-reservation-105','seed-order-105','location-cebu-central','pool-red-onion',500,'ACTIVE',1),
  ('seed-reservation-109','seed-order-109','location-cebu-central','pool-avocado',500,'CONSUMED',2);

INSERT OR IGNORE INTO committed_demand
  (id, order_id, delivery_cycle_id, location_id, inventory_pool_id, quantity, status, version)
VALUES
  ('seed-demand-103','seed-order-103','cycle-next-cebu','location-cebu-central','pool-avocado',500,'COMMITTED',1),
  ('seed-demand-104','seed-order-104','cycle-next-cebu','location-cebu-central','pool-asparagus',500,'COMMITTED',1),
  ('seed-demand-108','seed-order-108','cycle-next-cebu','location-cebu-central','pool-asparagus',1000,'EXCEPTION',2);

INSERT OR IGNORE INTO supplier (id, name, status)
VALUES
  ('seed-supplier-cebu-growers','Cebu Growers Cooperative','active'),
  ('seed-supplier-island-produce','Island Produce Trading','active');

INSERT OR IGNORE INTO procurement_requirement
  (id, delivery_cycle_id, location_id, inventory_pool_id, required_quantity,
   status, version, created_at, updated_at)
VALUES
  ('seed-procurement-asparagus','cycle-next-cebu','location-cebu-central','pool-asparagus',12000,'PARTIALLY_RECEIVED',4,1788237000000,1788328800000),
  ('seed-procurement-avocado','cycle-next-cebu','location-cebu-central','pool-avocado',8000,'ORDERED',3,1788237000000,1788328800000);

INSERT OR IGNORE INTO purchase_order
  (id, requirement_id, supplier_id, status, ordered_quantity, created_at, version)
VALUES
  ('seed-po-asparagus','seed-procurement-asparagus','seed-supplier-cebu-growers','PARTIALLY_RECEIVED',12000,1788237000000,3),
  ('seed-po-avocado','seed-procurement-avocado','seed-supplier-island-produce','ORDERED',8000,1788237000000,2);

INSERT OR IGNORE INTO receiving_record
  (id, procurement_requirement_id, expected_quantity, accepted_quantity,
   rejected_quantity, status, version, created_at, updated_at)
VALUES
  ('seed-receiving-asparagus','seed-procurement-asparagus',12000,8000,500,'IN_PROGRESS',3,1788304500000,1788328800000);

INSERT OR IGNORE INTO receiving_event
  (id, receiving_record_id, procurement_requirement_id, location_id,
   inventory_pool_id, accepted_delta, rejected_delta, reason, idempotency_key,
   occurred_at)
VALUES
  ('seed-receiving-event-asparagus','seed-receiving-asparagus','seed-procurement-asparagus','location-cebu-central','pool-asparagus',8000,500,'Quality rejection at receiving','seed-receiving-event-key-asparagus',1788328800000);

-- Representative notification and audit histories.
INSERT OR IGNORE INTO notification_outbox
  (id, event_type, aggregate_type, aggregate_id, customer_id, channel,
   recipient_snapshot, template_data_json, status, scheduled_at, available_at,
   attempts, last_error_code, sent_at, idempotency_key, created_at, updated_at)
VALUES
  ('seed-notification-101','ORDER_CONFIRMED','order','seed-order-101','seed-customer-ana','EMAIL','ana.santos@example.com','{"orderNumber":"FM-2026-000101"}','SENT',1787184000000,1787184000000,1,NULL,1787184060000,'seed-notification-key-101',1787184000000,1787184060000),
  ('seed-notification-102','OUT_FOR_DELIVERY','order','seed-order-102','seed-customer-miguel','EMAIL','miguel.delacruz@example.com','{"orderNumber":"FM-2026-000102"}','PENDING',1788310800000,1788310800000,0,NULL,NULL,'seed-notification-key-102',1788310800000,1788310800000),
  ('seed-notification-carla','RENEWAL_PAYMENT_FAILED','subscription','seed-sub-carla','seed-customer-carla','EMAIL','carla.lim@example.com','{}','FAILED',1788237000000,1788237000000,3,'LOCAL_EMAIL_UNAVAILABLE',NULL,'seed-notification-key-carla',1788237000000,1788328800000);

INSERT OR IGNORE INTO audit_event
  (id, actor_user_id, action, aggregate_type, aggregate_id, details_json,
   idempotency_key, occurred_at, market_id, location_id, reason, before_json,
   after_json, correlation_id)
VALUES
  ('seed-audit-order-101',NULL,'order.committed','order','seed-order-101','{}','seed-audit-key-order-101',1787184000000,'market-metro-cebu','location-cebu-central',NULL,NULL,'{"status":"COMMITTED"}','seed-correlation-101'),
  ('seed-audit-delivery-101',NULL,'order.delivered','order','seed-order-101','{}','seed-audit-key-delivery-101',1787198400000,'market-metro-cebu','location-cebu-central',NULL,'{"status":"OUT_FOR_DELIVERY"}','{"status":"DELIVERED"}','seed-correlation-101'),
  ('seed-audit-order-102',NULL,'order.out_for_delivery','order','seed-order-102','{}','seed-audit-key-order-102',1788310800000,'market-metro-cebu','location-cebu-central',NULL,'{"status":"FULFILLMENT_READY"}','{"status":"OUT_FOR_DELIVERY"}','seed-correlation-102'),
  ('seed-audit-refund-107','staff_local_admin','refund.completed','payment','seed-pi-107','{}','seed-audit-key-refund-107',1788328800000,'market-metro-cebu','location-cebu-central','Operational cancellation',NULL,'{"status":"REFUNDED"}','seed-correlation-107'),
  ('seed-audit-customer-ben','staff_local_admin','customer.access_disabled','customer','seed-customer-ben','{}','seed-audit-key-customer-ben',1788304500000,NULL,NULL,'Closure request received','{"status":"active"}','{"status":"disabled"}','seed-correlation-ben'),
  ('seed-audit-membership-carla',NULL,'membership.renewal_failed','subscription','seed-sub-carla','{}','seed-audit-key-membership-carla',1788237000000,NULL,NULL,NULL,'{"status":"ACTIVE"}','{"status":"PAST_DUE"}','seed-correlation-carla'),
  ('seed-audit-order-108',NULL,'order.exception_recorded','order','seed-order-108','{}','seed-audit-key-order-108',1788328800000,'market-metro-cebu','location-cebu-central','Stock short after payment','{"status":"FULFILLMENT_PENDING"}','{"status":"EXCEPTION"}','seed-correlation-108'),
  ('seed-audit-order-109','staff_local_admin','refund.completed','order','seed-order-109','{}','seed-audit-key-order-109',1788328800000,'market-metro-cebu','location-cebu-central','Post-delivery quality adjustment',NULL,'{"refundMinor":5000}','seed-correlation-109');

-- Verification summary emitted by Wrangler after the seed completes.
SELECT
  (SELECT COUNT(*) FROM customer WHERE id LIKE 'seed-customer-%') AS seeded_customers,
  (SELECT COUNT(*) FROM subscription WHERE id LIKE 'seed-sub-%') AS seeded_subscriptions,
  (SELECT COUNT(*) FROM grocery_order WHERE id LIKE 'seed-order-%') AS seeded_orders,
  (SELECT COUNT(*) FROM payment_intent WHERE id LIKE 'seed-pi-%') AS seeded_payment_intents,
  (SELECT COUNT(*) FROM payment_refund WHERE id LIKE 'seed-refund-%') AS seeded_refunds,
  (SELECT COUNT(*) FROM order_issue WHERE id LIKE 'seed-issue-%') AS seeded_order_issues,
  (SELECT COUNT(*) FROM product_media) AS product_media_rows;
