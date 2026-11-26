-- ==============================================================================
-- Migration: 009_payment_analytics_events.sql
-- Description: Payment Analytics Events — Real-time event stream logging
-- ==============================================================================

CREATE TABLE IF NOT EXISTS payment_analytics_events (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    env_mode     VARCHAR(8)   NOT NULL CHECK (env_mode IN ('test', 'live')),
    merchant_id  VARCHAR(64)  NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    event_type   VARCHAR(64)  NOT NULL, -- 'payment.created', 'payment.succeeded', 'payment.failed'
    intent_id    UUID         REFERENCES payment_intents(id) ON DELETE SET NULL,
    connector    VARCHAR(64),
    amount_cents BIGINT,
    currency     VARCHAR(8),
    latency_ms   INTEGER,
    payload      JSONB        NOT NULL DEFAULT '{}',
    recorded_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pae_merchant_env_type ON payment_analytics_events (merchant_id, env_mode, event_type, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_pae_recorded_at       ON payment_analytics_events (recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_pae_intent_id         ON payment_analytics_events (intent_id) WHERE intent_id IS NOT NULL;
