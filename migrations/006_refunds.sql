-- ==============================================================================
-- Migration: 006_refunds.sql
-- Description: Refunds — Transaction reversals and connector refunds
-- ==============================================================================

CREATE TABLE IF NOT EXISTS refunds (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    intent_id                UUID         NOT NULL REFERENCES payment_intents(id) ON DELETE CASCADE,
    attempt_id               UUID         NOT NULL REFERENCES payment_attempts(id) ON DELETE CASCADE,
    env_mode                 VARCHAR(8)   NOT NULL CHECK (env_mode IN ('test', 'live')),
    merchant_id              VARCHAR(64)  NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    connector                VARCHAR(64)  NOT NULL,
    connector_transaction_id VARCHAR(255) NOT NULL,
    connector_refund_id      VARCHAR(255),
    amount_cents             BIGINT       NOT NULL CHECK (amount_cents > 0),
    currency                 VARCHAR(8)   NOT NULL,
    refund_status            VARCHAR(32)  NOT NULL DEFAULT 'pending',
    reason                   TEXT,
    metadata                 JSONB        NOT NULL DEFAULT '{}',
    created_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refunds_intent_id ON refunds (intent_id);
CREATE INDEX IF NOT EXISTS idx_refunds_merchant_env ON refunds (merchant_id, env_mode, refund_status);

DROP TRIGGER IF EXISTS trg_refunds_updated_at ON refunds;
CREATE TRIGGER trg_refunds_updated_at
BEFORE UPDATE ON refunds
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_timestamp();
