-- Existing rows retain their original stored bytes and null input evidence.
-- New rows keep the submitted image identity separate from the normalized R2 object.
ALTER TABLE order_message_upload ADD COLUMN input_mime_type TEXT
  CHECK (input_mime_type IS NULL OR input_mime_type IN
    ('image/jpeg','image/png','image/webp','image/heic','image/heif'));
ALTER TABLE order_message_upload ADD COLUMN input_byte_size INTEGER
  CHECK (input_byte_size IS NULL OR input_byte_size BETWEEN 1 AND 18000000);
ALTER TABLE order_message_upload ADD COLUMN input_digest TEXT;
