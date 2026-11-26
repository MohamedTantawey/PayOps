-- ==============================================================================
-- Migration: 008_webhook_deliveries.sql
-- Description: Webhook subscriptions and signed event delivery audit logs
-- ==============================================================================

CREATE TABLE IF NOT EXISTS webhook_endpoints (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id    VARCHAR(64)  NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    env_mode       VARCHAR(8)   NOT NULL DEFAULT 'test' CHECK (env_mode IN ('test', 'live')),
    target_url     TEXT         NOT NULL,
    signing_secret VARCHAR(255) NOT NULL,
    events         TEXT[]       NOT NULL DEFAULT '{"payment.succeeded", "payment.failed"}',
    active         BOOLEAN      NOT NULL DEFAULT true,
    metadata       JSONB        NOT NULL DEFAULT '{}',
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_we_merchant_env ON webhook_endpoints (merchant_id, env_mode, active);

DROP TRIGGER IF EXISTS trg_we_updated_at ON webhook_endpoints;
CREATE TRIGGER trg_we_updated_at
BEFORE UPDATE ON webhook_endpoints
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_timestamp();

CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    endpoint_id   UUID         REFERENCES webhook_endpoints(id) ON DELETE SET NULL,
    merchant_id   VARCHAR(64)  NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    env_mode      VARCHAR(8)   NOT NULL CHECK (env_mode IN ('test', 'live')),
    event_type    VARCHAR(64)  NOT NULL,
    target_url    TEXT         NOT NULL,
    payload       JSONB        NOT NULL,
    status_code   INTEGER,
    status        VARCHAR(32)  NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed', 'replaying')),
    attempt_count SMALLINT     NOT NULL DEFAULT 1,
    response_body TEXT,
    error_message TEXT,
    duration_ms   INTEGER,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    delivered_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_wd_merchant_env_created ON webhook_deliveries (merchant_id, env_mode, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wd_status              ON webhook_deliveries (status, created_at DESC);
