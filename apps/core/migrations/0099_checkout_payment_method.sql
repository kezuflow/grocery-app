-- Retain the customer's provider-neutral payment-method choice with the intent.
-- Historical intents remain nullable and continue through their saved provider action.
ALTER TABLE payment_intent ADD COLUMN payment_method_token TEXT;
