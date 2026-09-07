ALTER TABLE fulfillment_location ADD COLUMN purpose TEXT NOT NULL DEFAULT 'CUSTOMER_FULFILLMENT'
  CHECK (purpose IN ('CUSTOMER_FULFILLMENT','CENTRAL_WAREHOUSE'));

INSERT INTO permission(id,code,description,created_at) VALUES
  ('permission-locations-read','locations.read','Read Global location setup',0),
  ('permission-locations-manage','locations.manage','Manage Global location setup',0);
