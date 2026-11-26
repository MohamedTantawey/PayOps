-- ==============================================================================
-- Migration: 011_billing_and_invoices.sql
-- Description: Scheduled billing runs and PDF invoice document management
-- ==============================================================================

CREATE TABLE IF NOT EXISTS billing_schedules (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id    VARCHAR(64)  NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    env_mode       VARCHAR(8)   NOT NULL DEFAULT 'test' CHECK (env_mode IN ('test', 'live')),
    name           VARCHAR(128) NOT NULL,
    cron_expr      VARCHAR(64)  NOT NULL, -- e.g. '0 0 1 * *'
    amount_cents   BIGINT       NOT NULL CHECK (amount_cents > 0),
    currency       VARCHAR(8)   NOT NULL DEFAULT 'USD',
    customer_email VARCHAR(255) NOT NULL,
    active         BOOLEAN      NOT NULL DEFAULT true,
    last_run_at    TIMESTAMPTZ,
    next_run_at    TIMESTAMPTZ,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS billing_runs (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    schedule_id    UUID         NOT NULL REFERENCES billing_schedules(id) ON DELETE CASCADE,
    merchant_id    VARCHAR(64)  NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    env_mode       VARCHAR(8)   NOT NULL CHECK (env_mode IN ('test', 'live')),
    status         VARCHAR(32)  NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    intent_id      UUID         REFERENCES payment_intents(id) ON DELETE SET NULL,
    error_message  TEXT,
    executed_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS invoices (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_number  VARCHAR(64)  UNIQUE NOT NULL,
    intent_id       UUID         REFERENCES payment_intents(id) ON DELETE CASCADE,
    merchant_id     VARCHAR(64)  NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    env_mode        VARCHAR(8)   NOT NULL CHECK (env_mode IN ('test', 'live')),
    status          VARCHAR(32)  NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'failed')),
    amount_cents    BIGINT       NOT NULL,
    currency        VARCHAR(8)   NOT NULL DEFAULT 'USD',
    customer_email  VARCHAR(255),
    object_key      VARCHAR(255), -- S3 / local storage path
    storage_driver  VARCHAR(32)  NOT NULL DEFAULT 'local', -- 's3' or 'local'
    s3_bucket       VARCHAR(128),
    file_size_bytes BIGINT,
    generated_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invoices_merchant_env ON invoices (merchant_id, env_mode, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_intent_id    ON invoices (intent_id);

DROP TRIGGER IF EXISTS trg_invoices_updated_at ON invoices;
CREATE TRIGGER trg_invoices_updated_at
BEFORE UPDATE ON invoices
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_timestamp();
