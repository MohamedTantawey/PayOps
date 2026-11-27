-- ==============================================================================
-- Migration: 005_payment_attempts.sql
-- Description: Payment Attempts — Per-connector immutable execution attempts
-- ==============================================================================

CREATE TABLE IF NOT EXISTS payment_attempts (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    intent_id                UUID         NOT NULL REFERENCES payment_intents(id) ON DELETE CASCADE,
    env_mode                 VARCHAR(8)   NOT NULL CHECK (env_mode IN ('test', 'live')),
    merchant_id              VARCHAR(64)  NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    connector                VARCHAR(64)  NOT NULL,
    attempt_index            SMALLINT     NOT NULL DEFAULT 1,
    status                   VARCHAR(64)  NOT NULL DEFAULT 'started',
    amount_cents             BIGINT       NOT NULL,
    currency                 VARCHAR(8)   NOT NULL,
    connector_transaction_id VARCHAR(255),
    error_code               VARCHAR(255),
    error_message            TEXT,
    vault_token              VARCHAR(128),
    metadata                 JSONB        NOT NULL DEFAULT '{}',
    created_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pa_intent_id       ON payment_attempts (intent_id);
CREATE INDEX IF NOT EXISTS idx_pa_connector_env   ON payment_attempts (connector, env_mode, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pa_connector_tx_id ON payment_attempts (connector_transaction_id) WHERE connector_transaction_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_payment_attempts_updated_at ON payment_attempts;
CREATE TRIGGER trg_payment_attempts_updated_at
BEFORE UPDATE ON payment_attempts
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_timestamp();

-- Link active_attempt_id from payment_intents to payment_attempts
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_payment_intents_active_attempt'
    ) THEN
        ALTER TABLE payment_intents
        ADD CONSTRAINT fk_payment_intents_active_attempt
        FOREIGN KEY (active_attempt_id)
        REFERENCES payment_attempts(id)
        ON DELETE SET NULL;
    END IF;
END $$;
