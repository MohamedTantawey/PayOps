<<<<<<< HEAD
CREATE TABLE IF NOT EXISTS checkout_sessions (
    intent_id   UUID PRIMARY KEY REFERENCES payment_intents(id) ON DELETE CASCADE,
    secret_hash VARCHAR(64) NOT NULL,
    return_url  TEXT NOT NULL,
    cancel_url  TEXT NOT NULL,
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_checkout_sessions_expires_at
    ON checkout_sessions (expires_at);
=======
CREATE TABLE IF NOT EXISTS checkout_sessions (
    intent_id   UUID PRIMARY KEY REFERENCES payment_intents(id) ON DELETE CASCADE,
    secret_hash VARCHAR(64) NOT NULL,
    return_url  TEXT NOT NULL,
    cancel_url  TEXT NOT NULL,
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_checkout_sessions_expires_at
    ON checkout_sessions (expires_at);
>>>>>>> origin/payops-control
