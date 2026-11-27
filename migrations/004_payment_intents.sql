-- ==============================================================================
-- Migration: 004_payment_intents.sql
-- Description: Payment Intents — Core business transaction contract
-- ==============================================================================

CREATE TABLE IF NOT EXISTS payment_intents (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    idempotency_key   VARCHAR(128) UNIQUE,
    env_mode          VARCHAR(8)   NOT NULL DEFAULT 'test' CHECK (env_mode IN ('test', 'live')),
    merchant_id       VARCHAR(64)  NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    amount_cents      BIGINT       NOT NULL CHECK (amount_cents > 0),
    currency          VARCHAR(8)   NOT NULL DEFAULT 'USD',
    capture_method    VARCHAR(32)  NOT NULL DEFAULT 'automatic',
    status            VARCHAR(64)  NOT NULL DEFAULT 'requires_confirmation',
    active_attempt_id UUID,
    attempt_count     SMALLINT     NOT NULL DEFAULT 0,
    customer_email    TEXT,
    description       TEXT,
    metadata          JSONB        NOT NULL DEFAULT '{}',
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pi_merchant_env_status ON payment_intents (merchant_id, env_mode, status);
CREATE INDEX IF NOT EXISTS idx_pi_idempotency        ON payment_intents (idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pi_created_at         ON payment_intents (created_at DESC);

DROP TRIGGER IF EXISTS trg_payment_intents_updated_at ON payment_intents;
CREATE TRIGGER trg_payment_intents_updated_at
BEFORE UPDATE ON payment_intents
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_timestamp();
