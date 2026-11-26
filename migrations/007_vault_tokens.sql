-- ==============================================================================
-- Migration: 007_vault_tokens.sql
-- Description: PCI Vault Token Boundary — Isolated encrypted card tokens
-- ==============================================================================

CREATE TABLE IF NOT EXISTS vault_tokens (
    token          VARCHAR(128) PRIMARY KEY, -- vault_tok_<uuid>
    merchant_id    VARCHAR(64)  REFERENCES merchants(id) ON DELETE SET NULL,
    encrypted_data TEXT         NOT NULL,    -- AES-256-GCM encrypted PAN + CVV + Expiry
    last4          VARCHAR(4)   NOT NULL,
    card_network   VARCHAR(32),              -- 'visa', 'mastercard', 'amex', etc.
    env_mode       VARCHAR(8)   NOT NULL DEFAULT 'test' CHECK (env_mode IN ('test', 'live')),
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    expires_at     TIMESTAMPTZ  NOT NULL DEFAULT (NOW() + INTERVAL '1 year')
);

CREATE INDEX IF NOT EXISTS idx_vt_env_created ON vault_tokens (env_mode, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vt_merchant_env ON vault_tokens (merchant_id, env_mode);
