-- ==============================================================================
-- PayOps Deterministic Seed Script
-- Test Mode (sk_test_...) & Live Mode (sk_live_...)
-- ==============================================================================

-- 1. RBAC Roles
INSERT INTO rbac_roles (id, name, description)
VALUES 
    ('10000000-0000-0000-0000-000000000001', 'admin', 'Full platform administrative access'),
    ('10000000-0000-0000-0000-000000000002', 'operator', 'Operations management and payments view/refund'),
    ('10000000-0000-0000-0000-000000000003', 'viewer', 'Read-only access for dashboards and logs'),
    ('10000000-0000-0000-0000-000000000004', 'finance', 'Invoices, billing schedules, and ledger access')
ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description;

-- 2. RBAC Permissions (Assign to admin role)
INSERT INTO rbac_permissions (role_id, resource, action)
VALUES
    ('10000000-0000-0000-0000-000000000001', 'payments', 'read'),
    ('10000000-0000-0000-0000-000000000001', 'payments', 'write'),
    ('10000000-0000-0000-0000-000000000001', 'payments', 'delete'),
    ('10000000-0000-0000-0000-000000000001', 'billing', 'read'),
    ('10000000-0000-0000-0000-000000000001', 'billing', 'write'),
    ('10000000-0000-0000-0000-000000000001', 'invoices', 'read'),
    ('10000000-0000-0000-0000-000000000001', 'invoices', 'write'),
    ('10000000-0000-0000-0000-000000000001', 'routing', 'read'),
    ('10000000-0000-0000-0000-000000000001', 'routing', 'write'),
    ('10000000-0000-0000-0000-000000000001', 'webhooks', 'read'),
    ('10000000-0000-0000-0000-000000000001', 'webhooks', 'write'),
    ('10000000-0000-0000-0000-000000000001', 'webhooks', 'replay'),
    ('10000000-0000-0000-0000-000000000001', 'admin', 'read'),
    ('10000000-0000-0000-0000-000000000001', 'admin', 'write')
ON CONFLICT (role_id, resource, action) DO NOTHING;

-- 3. Merchants (Deterministic test & live tenants)
INSERT INTO merchants (id, name, email, env_mode, is_active, metadata)
VALUES
    ('merch_test_default', 'PayOps Test Merchant', 'merchant-test@payops.dev', 'test', true, '{"tier":"enterprise","partner":"acme"}'::jsonb),
    ('merch_live_default', 'PayOps Live Merchant', 'merchant-live@payops.com', 'live', true, '{"tier":"enterprise","partner":"acme"}'::jsonb)
ON CONFLICT (id) DO UPDATE SET 
    name = EXCLUDED.name,
    email = EXCLUDED.email,
    env_mode = EXCLUDED.env_mode,
    is_active = EXCLUDED.is_active;

-- 4. API Keys (Deterministic bcrypt hashes for Test and Live mode)
-- sk_test_demo_000000000000000000000000 -> hash: $2a$10$b9Beaiw0KvqKr0SMnTnWrOC9piu5ERi1p2xTKJXZEmo0jtgbtFNZG
-- sk_live_demo_000000000000000000000000 -> hash: $2a$10$H9i6L3G7u2Kw03D92C2LXumE9ZJUToK86S7EusaMQSX86ERSCodyG
INSERT INTO api_keys (id, key_prefix, key_hash, env_mode, merchant_id, role_id, name, active)
VALUES
    (
        '20000000-0000-0000-0000-000000000001',
        'sk_test_demo',
        '$2a$10$b9Beaiw0KvqKr0SMnTnWrOC9piu5ERi1p2xTKJXZEmo0jtgbtFNZG',
        'test',
        'merch_test_default',
        '10000000-0000-0000-0000-000000000001',
        'Default Test Secret Key',
        true
    ),
    (
        '20000000-0000-0000-0000-000000000002',
        'sk_live_demo',
        '$2a$10$H9i6L3G7u2Kw03D92C2LXumE9ZJUToK86S7EusaMQSX86ERSCodyG',
        'live',
        'merch_live_default',
        '10000000-0000-0000-0000-000000000001',
        'Default Live Secret Key',
        true
    )
ON CONFLICT (key_hash) DO NOTHING;

-- 5. Merchant Connector Accounts (Encrypted credentials with AES-256-GCM dev master key)
INSERT INTO merchant_connector_accounts (
    id, merchant_id, connector_name, connector_label, connector_type, env_mode, encrypted_credentials, is_active
)
VALUES
    -- Test Mode Connectors
    (
        '30000000-0000-0000-0000-000000000001',
        'merch_test_default',
        'mock_stripe',
        'Mock Stripe Test Connector',
        'payment_processor',
        'test',
        '010101010101010101010101:6160d3515de71ae79734826eef3febd2:9ab349b4a24fc968aa07c4a7a6ab95cbe0c62b93b6257044ea40f50f04b952c517209ffd3ee75a68ac2381fa47c6ad6619dc6754d2893ee338b7521e1345d65e9d1ff1a0f7da',
        true
    ),
    (
        '30000000-0000-0000-0000-000000000002',
        'merch_test_default',
        'mock_paymo',
        'Mock Paymob Test Connector',
        'payment_processor',
        'test',
        '010101010101010101010101:2160b6ae1523d9076b12e962a277f1be:9ab349b4a24fc968aa07c4a4b3a091d4e7c62b93b6257044ea40f50f04b952c517209ffd3ee75a68ac2381fa47c6ad6619dc6754d2893ee338b7521e1345d65e9d1ff1a3f7da',
        true
    ),
    -- Live Mode Connectors
    (
        '30000000-0000-0000-0000-000000000003',
        'merch_live_default',
        'mock_stripe',
        'Stripe Production Connector',
        'payment_processor',
        'live',
        '010101010101010101010101:6160d3515de71ae79734826eef3febd2:9ab349b4a24fc968aa07c4a7a6ab95cbe0c62b93b6257044ea40f50f04b952c517209ffd3ee75a68ac2381fa47c6ad6619dc6754d2893ee338b7521e1345d65e9d1ff1a0f7da',
        true
    ),
    (
        '30000000-0000-0000-0000-000000000004',
        'merch_live_default',
        'mock_paymo',
        'Paymob Production Connector',
        'payment_processor',
        'live',
        '010101010101010101010101:2160b6ae1523d9076b12e962a277f1be:9ab349b4a24fc968aa07c4a4b3a091d4e7c62b93b6257044ea40f50f04b952c517209ffd3ee75a68ac2381fa47c6ad6619dc6754d2893ee338b7521e1345d65e9d1ff1a3f7da',
        true
    )
ON CONFLICT (merchant_id, connector_name, env_mode) DO NOTHING;

-- 6. Routing Algorithms
INSERT INTO routing_algorithms (id, merchant_id, env_mode, name, algorithm_type, config, active, created_by)
VALUES
    -- Test Mode: Priority Routing
    (
        '40000000-0000-0000-0000-000000000001',
        'merch_test_default',
        'test',
        'Priority: Stripe -> Paymob',
        'priority',
        '{"connectors": ["mock_stripe", "mock_paymo"]}'::jsonb,
        true,
        'system_seed'
    ),
    -- Live Mode: Priority Routing
    (
        '40000000-0000-0000-0000-000000000002',
        'merch_live_default',
        'live',
        'Production Priority Routing',
        'priority',
        '{"connectors": ["mock_stripe", "mock_paymo"]}'::jsonb,
        true,
        'system_seed'
    )
ON CONFLICT DO NOTHING;

-- 7. Webhook Endpoints
INSERT INTO webhook_endpoints (id, merchant_id, env_mode, target_url, signing_secret, events, active)
VALUES
    (
        '50000000-0000-0000-0000-000000000001',
        'merch_test_default',
        'test',
        'http://mock-psp:4001/webhook',
        'whsec_test_secret_key_2026',
        '{"payment.succeeded", "payment.failed", "refund.succeeded"}',
        true
    ),
    (
        '50000000-0000-0000-0000-000000000002',
        'merch_live_default',
        'live',
        'https://api.merchant.com/payops-webhooks',
        'whsec_live_secret_key_2026',
        '{"payment.succeeded", "payment.failed"}',
        true
    )
ON CONFLICT DO NOTHING;

-- 8. Deterministic Vault Token (Card ending in 4242)
INSERT INTO vault_tokens (token, merchant_id, encrypted_data, last4, card_network, env_mode)
VALUES
    (
        'vault_tok_test_4242424242424242',
        'merch_test_default',
        '010101010101010101010101:a1a2a3a4a5a6a7a8a9b0b1b2b3b4b5b6:c1c2c3c4c5c6c7c8c9d0d1d2d3d4d5d6',
        '4242',
        'visa',
        'test'
    )
ON CONFLICT (token) DO NOTHING;
