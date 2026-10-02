CREATE TABLE customer_saved_product (
  customer_id TEXT NOT NULL REFERENCES customer(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES product(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (customer_id, product_id)
);
CREATE INDEX customer_saved_product_recent_idx
  ON customer_saved_product(customer_id, created_at DESC, product_id);

CREATE TABLE customer_order_feedback (
  order_id TEXT PRIMARY KEY NOT NULL REFERENCES grocery_order(id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL REFERENCES customer(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT CHECK (comment IS NULL OR length(comment) <= 1000),
  submitted_at INTEGER NOT NULL
);
CREATE INDEX customer_order_feedback_customer_idx
  ON customer_order_feedback(customer_id, submitted_at DESC);
