CREATE TABLE IF NOT EXISTS customer (id TEXT PRIMARY KEY, auth_user_id TEXT NOT NULL UNIQUE, phone TEXT, status TEXT NOT NULL DEFAULT 'active', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS customer_address (id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES customer(id), label TEXT NOT NULL, recipient TEXT NOT NULL, phone TEXT NOT NULL, address_json TEXT NOT NULL, latitude REAL NOT NULL, longitude REAL NOT NULL, service_area_code TEXT, delivery_zone_code TEXT, resolution_version INTEGER, notes TEXT, status TEXT NOT NULL DEFAULT 'active', version INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS subscription_offer (id TEXT PRIMARY KEY, code TEXT UNIQUE NOT NULL, name TEXT NOT NULL, fee_minor INTEGER NOT NULL, currency TEXT NOT NULL, trial_days INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS subscription (id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES customer(id), offer_id TEXT NOT NULL REFERENCES subscription_offer(id), status TEXT NOT NULL, starts_at INTEGER NOT NULL, ends_at INTEGER, trial_ends_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS delivery_cycle (id TEXT PRIMARY KEY, market_id TEXT NOT NULL REFERENCES market(id), name TEXT NOT NULL, order_opens_at INTEGER NOT NULL, cutoff_at INTEGER NOT NULL, delivery_date INTEGER NOT NULL, status TEXT NOT NULL, capacity INTEGER NOT NULL, allocated INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS cart (id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES customer(id), location_id TEXT NOT NULL REFERENCES fulfillment_location(id), status TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS cart_item (cart_id TEXT NOT NULL REFERENCES cart(id) ON DELETE CASCADE, sku_id TEXT NOT NULL REFERENCES sku(id), quantity INTEGER NOT NULL CHECK(quantity > 0), PRIMARY KEY(cart_id, sku_id));
CREATE TABLE IF NOT EXISTS payment_attempt (id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES customer(id), amount_minor INTEGER NOT NULL, currency TEXT NOT NULL, status TEXT NOT NULL, provider TEXT NOT NULL, provider_reference TEXT, idempotency_key TEXT UNIQUE NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS grocery_order (id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES customer(id), cycle_id TEXT NOT NULL REFERENCES delivery_cycle(id), address_snapshot_json TEXT NOT NULL, status TEXT NOT NULL, total_minor INTEGER NOT NULL, currency TEXT NOT NULL, payment_id TEXT NOT NULL REFERENCES payment_attempt(id), created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS order_item (id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES grocery_order(id) ON DELETE CASCADE, sku_id TEXT NOT NULL, product_name_snapshot TEXT NOT NULL, variant_name_snapshot TEXT NOT NULL, unit_snapshot TEXT NOT NULL, quantity INTEGER NOT NULL, unit_price_minor INTEGER NOT NULL, line_total_minor INTEGER NOT NULL, base_quantity INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS inventory_balance (location_id TEXT NOT NULL REFERENCES fulfillment_location(id), inventory_pool_id TEXT NOT NULL REFERENCES inventory_pool(id), on_hand INTEGER NOT NULL DEFAULT 0, reserved INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(location_id, inventory_pool_id));
CREATE TABLE IF NOT EXISTS inventory_reservation (id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES grocery_order(id), location_id TEXT NOT NULL, inventory_pool_id TEXT NOT NULL, quantity INTEGER NOT NULL, status TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS committed_demand (id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES grocery_order(id), delivery_cycle_id TEXT NOT NULL, location_id TEXT NOT NULL, inventory_pool_id TEXT NOT NULL, quantity INTEGER NOT NULL, status TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS procurement_requirement (id TEXT PRIMARY KEY, delivery_cycle_id TEXT NOT NULL, location_id TEXT NOT NULL, inventory_pool_id TEXT NOT NULL, required_quantity INTEGER NOT NULL, status TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS receiving_record (id TEXT PRIMARY KEY, procurement_requirement_id TEXT NOT NULL, expected_quantity INTEGER NOT NULL, accepted_quantity INTEGER NOT NULL DEFAULT 0, rejected_quantity INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS fulfillment_record (id TEXT PRIMARY KEY, order_id TEXT NOT NULL UNIQUE, location_id TEXT NOT NULL, status TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS delivery_job (id TEXT PRIMARY KEY, order_id TEXT NOT NULL UNIQUE, cycle_id TEXT NOT NULL, rider_user_id TEXT, status TEXT NOT NULL, address_snapshot_json TEXT NOT NULL, delivered_at INTEGER);
INSERT OR IGNORE INTO subscription_offer VALUES ('offer-trial','TRIAL','FreshMarkets trial',0,'PHP',14,'active');
INSERT OR IGNORE INTO delivery_cycle
  (id, market_id, name, order_opens_at, cutoff_at, delivery_date, status, capacity, allocated, version)
VALUES
  ('cycle-next-cebu', 'market-metro-cebu', 'Next Cebu delivery',
   (unixepoch('now') - 86400) * 1000,
   (unixepoch('now') + 604800) * 1000,
   (unixepoch('now') + 777600) * 1000,
   'OPEN', 100, 0, 1);
INSERT OR IGNORE INTO inventory_balance (location_id, inventory_pool_id, on_hand, reserved)
VALUES ('location-cebu-central', 'pool-red-onion', 500000, 0);
INSERT OR IGNORE INTO inventory_balance (location_id, inventory_pool_id, on_hand, reserved)
VALUES ('location-cebu-central', 'pool-eggs', 0, 0);
CREATE INDEX IF NOT EXISTS customer_auth_user_idx ON customer(auth_user_id);
CREATE INDEX IF NOT EXISTS customer_address_customer_idx ON customer_address(customer_id, status);
CREATE INDEX IF NOT EXISTS subscription_customer_status_idx ON subscription(customer_id, status, updated_at);
CREATE INDEX IF NOT EXISTS delivery_cycle_market_status_idx ON delivery_cycle(market_id, status, delivery_date);
CREATE INDEX IF NOT EXISTS cart_customer_status_idx ON cart(customer_id, status);
CREATE INDEX IF NOT EXISTS grocery_order_customer_idx ON grocery_order(customer_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS grocery_order_payment_unique ON grocery_order(payment_id);
CREATE INDEX IF NOT EXISTS inventory_reservation_order_idx ON inventory_reservation(order_id, status);
CREATE INDEX IF NOT EXISTS committed_demand_cycle_idx ON committed_demand(delivery_cycle_id, location_id, inventory_pool_id, status);
CREATE INDEX IF NOT EXISTS procurement_requirement_cycle_idx ON procurement_requirement(delivery_cycle_id, location_id, inventory_pool_id, status);
CREATE TRIGGER IF NOT EXISTS inventory_reservation_guard
BEFORE INSERT ON inventory_reservation
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM inventory_balance
    WHERE location_id = NEW.location_id
      AND inventory_pool_id = NEW.inventory_pool_id
      AND on_hand - reserved >= NEW.quantity
  ) THEN RAISE(ABORT, 'INSUFFICIENT_STOCK') END;
END;
CREATE TRIGGER IF NOT EXISTS inventory_reservation_increment
AFTER INSERT ON inventory_reservation
BEGIN
  UPDATE inventory_balance SET reserved = reserved + NEW.quantity
  WHERE location_id = NEW.location_id AND inventory_pool_id = NEW.inventory_pool_id;
END;
CREATE TRIGGER IF NOT EXISTS grocery_order_capacity_guard
BEFORE INSERT ON grocery_order
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM delivery_cycle
    WHERE id = NEW.cycle_id
      AND status = 'OPEN'
      AND cutoff_at > unixepoch('now') * 1000
      AND allocated < capacity
  ) THEN RAISE(ABORT, 'DELIVERY_CYCLE_UNAVAILABLE') END;
END;
CREATE TRIGGER IF NOT EXISTS grocery_order_allocate_capacity
AFTER INSERT ON grocery_order
BEGIN
  UPDATE delivery_cycle SET allocated = allocated + 1, version = version + 1 WHERE id = NEW.cycle_id;
END;
