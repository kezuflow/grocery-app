-- Contact preferences belong to Customers; Better Auth remains the name/identity owner.
ALTER TABLE customer ADD COLUMN account_phone TEXT;
ALTER TABLE customer ADD COLUMN default_address_id TEXT REFERENCES customer_address(id);
