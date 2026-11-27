-- ==============================================================================
-- Migration: 003_routing_algorithms.sql
-- Description: Dynamic payment routing algorithms and configurations
-- ==============================================================================

CREATE TABLE IF NOT EXISTS routing_algorithms (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id    VARCHAR(64)  NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    env_mode       VARCHAR(8)   NOT NULL DEFAULT 'test' CHECK (env_mode IN ('test', 'live')),
    name           VARCHAR(128) NOT NULL DEFAULT 'default_routing',
    algorithm_type VARCHAR(32)  NOT NULL CHECK (algorithm_type IN ('single', 'priority', 'volume_split', 'rule')),
    config         JSONB        NOT NULL, -- { connectors: [], splits: [], rules: [] }
    active         BOOLEAN      NOT NULL DEFAULT true,
    created_by     VARCHAR(64),
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ra_merchant_env ON routing_algorithms (merchant_id, env_mode, active, created_at DESC);

DROP TRIGGER IF EXISTS trg_ra_updated_at ON routing_algorithms;
CREATE TRIGGER trg_ra_updated_at
BEFORE UPDATE ON routing_algorithms
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_timestamp();

-- Compatibility view mapping to routing_configs table schema
CREATE OR REPLACE VIEW routing_configs AS
SELECT 
    id,
    merchant_id,
    env_mode,
    name,
    algorithm_type,
    config,
    active,
    created_by,
    created_at,
    updated_at
FROM routing_algorithms;
