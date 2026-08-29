-- Enforce cart aggregate identity and prepare the provider inbox for durable,
-- provider-neutral redrive. Existing duplicate carts are preserved as
-- SUPERSEDED history; no cart or line is deleted.

-- cart_item has no item-level update timestamp in the compatibility schema.
-- The newest ACTIVE cart is therefore the authoritative source when it carries
-- a SKU; otherwise the newest older cart carrying that SKU supplies the line.
WITH ranked_carts AS (
  SELECT
    id,
    customer_id,
    updated_at,
    created_at,
    ROW_NUMBER() OVER (
      PARTITION BY customer_id
      ORDER BY updated_at DESC, created_at DESC, id DESC
    ) AS cart_rank
  FROM cart
  WHERE status = 'ACTIVE'
),
winners AS (
  SELECT id, customer_id FROM ranked_carts WHERE cart_rank = 1
),
ranked_items AS (
  SELECT
    ranked_carts.customer_id,
    cart_item.sku_id,
    cart_item.quantity,
    ROW_NUMBER() OVER (
      PARTITION BY ranked_carts.customer_id, cart_item.sku_id
      ORDER BY ranked_carts.updated_at DESC, ranked_carts.created_at DESC, ranked_carts.id DESC
    ) AS item_rank
  FROM ranked_carts
  JOIN cart_item ON cart_item.cart_id = ranked_carts.id
)
INSERT OR REPLACE INTO cart_item (cart_id, sku_id, quantity)
SELECT winners.id, ranked_items.sku_id, ranked_items.quantity
FROM ranked_items
JOIN winners ON winners.customer_id = ranked_items.customer_id
WHERE ranked_items.item_rank = 1;

WITH ranked_carts AS (
  SELECT
    id,
    customer_id,
    ROW_NUMBER() OVER (
      PARTITION BY customer_id
      ORDER BY updated_at DESC, created_at DESC, id DESC
    ) AS cart_rank,
    COUNT(*) OVER (PARTITION BY customer_id) AS cart_count
  FROM cart
  WHERE status = 'ACTIVE'
)
INSERT OR IGNORE INTO domain_event (
  id, aggregate_type, aggregate_id, event_type, payload_json, occurred_at
)
SELECT
  'cart-reconciliation:' || id,
  'CART',
  id,
  'DUPLICATE_ACTIVE_CARTS_RECONCILED',
  json_object('reason', 'DUPLICATE_ACTIVE_CARTS', 'supersededCount', cart_count - 1),
  unixepoch('now') * 1000
FROM ranked_carts
WHERE cart_rank = 1 AND cart_count > 1;

WITH ranked_carts AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY customer_id
      ORDER BY updated_at DESC, created_at DESC, id DESC
    ) AS cart_rank
  FROM cart
  WHERE status = 'ACTIVE'
)
UPDATE cart
SET
  status = 'SUPERSEDED',
  version = version + 1,
  updated_at = unixepoch('now') * 1000
WHERE id IN (SELECT id FROM ranked_carts WHERE cart_rank > 1);

CREATE UNIQUE INDEX cart_one_active_per_customer_unique
  ON cart(customer_id)
  WHERE status = 'ACTIVE';

ALTER TABLE payment_provider_event_inbox ADD COLUMN provider_reference TEXT;
ALTER TABLE payment_provider_event_inbox ADD COLUMN event_type TEXT;
ALTER TABLE payment_provider_event_inbox ADD COLUMN normalized_observation_json TEXT
  CHECK (
    normalized_observation_json IS NULL
    OR length(normalized_observation_json) <= 16384
  );
ALTER TABLE payment_provider_event_inbox ADD COLUMN lease_owner TEXT;
ALTER TABLE payment_provider_event_inbox ADD COLUMN lease_expires_at INTEGER;
ALTER TABLE payment_provider_event_inbox ADD COLUMN available_at INTEGER;
ALTER TABLE payment_provider_event_inbox ADD COLUMN first_failed_at INTEGER;

CREATE INDEX payment_provider_event_inbox_redrive_idx
  ON payment_provider_event_inbox(processing_status, available_at, lease_expires_at, updated_at);
CREATE INDEX payment_provider_event_inbox_reference_idx
  ON payment_provider_event_inbox(provider, provider_reference, received_at);
