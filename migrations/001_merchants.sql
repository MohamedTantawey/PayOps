-- ==============================================================================
-- Migration: 001_merchants.sql
-- Description: Core schema extensions and merchant root entity
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Updated_at trigger helper function
CREATE OR REPLACE FUNCTION set_updated_at_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 1. Merchants Table
CREATE TABLE IF NOT EXISTS merchants (
    id          VARCHAR(64) PRIMARY KEY,
    name        VARCHAR(255) NOT NULL,
    email       VARCHAR(255),
    env_mode    VARCHAR(8)   NOT NULL DEFAULT 'test' CHECK (env_mode IN ('test', 'live')),
    is_active   BOOLEAN      NOT NULL DEFAULT true,
    metadata    JSONB        NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_merchants_env_active ON merchants (env_mode, is_active);

DROP TRIGGER IF EXISTS trg_merchants_updated_at ON merchants;
CREATE TRIGGER trg_merchants_updated_at
BEFORE UPDATE ON merchants
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_timestamp();
