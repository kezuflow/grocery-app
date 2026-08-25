ALTER TABLE account ADD COLUMN issuer TEXT NOT NULL DEFAULT 'credential';
DROP INDEX IF EXISTS account_provider_identity_unique;
CREATE UNIQUE INDEX IF NOT EXISTS account_issuer_account_id_unique ON account(issuer, account_id);
