-- ==============================================================================
-- Migration: 002_merchant_connector_accounts.sql
-- Description: Merchant connector configurations & encrypted credentials
-- ==============================================================================

CREATE TABLE IF NOT EXISTS merchant_connector_accounts (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id           VARCHAR(64)  NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    connector_name        VARCHAR(64)  NOT NULL,
    connector_label       VARCHAR(128),
    connector_type        VARCHAR(64)  NOT NULL DEFAULT 'payment_processor',
    env_mode              VARCHAR(8)   NOT NULL DEFAULT 'test' CHECK (env_mode IN ('test', 'live')),
    encrypted_credentials TEXT         NOT NULL, -- AES-256-GCM: iv:tag:ciphertext
    metadata              JSONB        NOT NULL DEFAULT '{}',
    is_active             BOOLEAN      NOT NULL DEFAULT true,
    created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (merchant_id, connector_name, env_mode)
);

CREATE INDEX IF NOT EXISTS idx_mca_merchant_env ON merchant_connector_accounts (merchant_id, env_mode, is_active);
CREATE INDEX IF NOT EXISTS idx_mca_connector_name ON merchant_connector_accounts (connector_name, env_mode);

DROP TRIGGER IF EXISTS trg_mca_updated_at ON merchant_connector_accounts;
CREATE TRIGGER trg_mca_updated_at
BEFORE UPDATE ON merchant_connector_accounts
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_timestamp();

-- Compatibility view mapping to connector_credentials table schema
CREATE OR REPLACE VIEW connector_credentials AS
SELECT 
    id,
    connector_name AS connector,
    merchant_id,
    env_mode,
    encrypted_credentials AS encrypted_creds,
    is_active AS active,
    created_at
FROM merchant_connector_accounts;
