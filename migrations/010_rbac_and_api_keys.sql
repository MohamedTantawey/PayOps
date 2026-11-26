-- ==============================================================================
-- Migration: 010_rbac_and_api_keys.sql
-- Description: Role-Based Access Control (RBAC) & Mode-Isolated API Keys
-- ==============================================================================

CREATE TABLE IF NOT EXISTS rbac_roles (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(64) UNIQUE NOT NULL, -- 'admin', 'operator', 'viewer', 'finance'
    description TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rbac_permissions (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role_id    UUID        NOT NULL REFERENCES rbac_roles(id) ON DELETE CASCADE,
    resource   VARCHAR(64) NOT NULL, -- 'payments', 'billing', 'routing', 'webhooks', 'admin', 'invoices'
    action     VARCHAR(32) NOT NULL, -- 'read', 'write', 'delete', 'replay'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (role_id, resource, action)
);

CREATE TABLE IF NOT EXISTS api_keys (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key_prefix  VARCHAR(32)  NOT NULL, -- 'sk_test_...', 'sk_live_...'
    key_hash    VARCHAR(255) UNIQUE NOT NULL, -- bcrypt hash of sk_test_xxx / sk_live_xxx
    env_mode    VARCHAR(8)   NOT NULL CHECK (env_mode IN ('test', 'live')),
    merchant_id VARCHAR(64)  NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    role_id     UUID         REFERENCES rbac_roles(id) ON DELETE SET NULL,
    name        VARCHAR(128) NOT NULL DEFAULT 'Default Key',
    active      BOOLEAN      NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_api_keys_lookup ON api_keys (key_hash, env_mode, active);
CREATE INDEX IF NOT EXISTS idx_api_keys_merchant ON api_keys (merchant_id, env_mode);
