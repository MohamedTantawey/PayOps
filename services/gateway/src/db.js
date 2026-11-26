// Database wrapper. Postgres (pg) in production, PGlite (embedded Postgres) for tests and zero-setup runs.
import pg from 'pg';

export async function createDb(url) {
  if (url.startsWith('pglite:')) {
    const { PGlite } = await import('@electric-sql/pglite');
    const dir = url.slice('pglite:'.length);
    const lite = dir ? new PGlite(dir) : new PGlite();
    const wrap = (c) => ({ query: async (sql, params = []) => ({ rows: (await c.query(sql, params)).rows }) });
    return {
      ...wrap(lite),
      exec: (sql) => lite.exec(sql),
      tx: (fn) => lite.transaction((t) => fn(wrap(t))),
      close: () => lite.close(),
    };
  }
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  return {
    query: (sql, params = []) => pool.query(sql, params),
    exec: (sql) => pool.query(sql),
    async tx(fn) {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        const out = await fn({ query: (s, p = []) => c.query(s, p) });
        await c.query('COMMIT');
        return out;
      } catch (e) {
        await c.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        c.release();
      }
    },
    close: () => pool.end(),
  };
}

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS merchants (
  id text PRIMARY KEY, name text NOT NULL, env_mode text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS api_keys (
  id text PRIMARY KEY, key_hash text UNIQUE NOT NULL, key_prefix text NOT NULL, merchant_id text NOT NULL REFERENCES merchants(id),
  env_mode text NOT NULL, role text NOT NULL, active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS vault_tokens (
  token text PRIMARY KEY, merchant_id text NOT NULL, env_mode text NOT NULL, last4 text NOT NULL, card_network text NOT NULL,
  exp_month text, exp_year text, behavior text NOT NULL DEFAULT 'success', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS payment_intents (
  id uuid PRIMARY KEY, merchant_id text NOT NULL, env_mode text NOT NULL, amount_cents integer NOT NULL, currency text NOT NULL,
  capture_method text NOT NULL, status text NOT NULL, active_attempt_id uuid, attempt_count integer NOT NULL DEFAULT 0,
  customer_email text, description text, metadata jsonb NOT NULL DEFAULT '{}', auto_invoice boolean NOT NULL DEFAULT true,
  payment_method_token text, captured_amount_cents integer NOT NULL DEFAULT 0, amount_refunded_cents integer NOT NULL DEFAULT 0,
  client_secret text NOT NULL, return_url text, cancel_url text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pi_scope ON payment_intents (merchant_id, env_mode, created_at DESC);
CREATE TABLE IF NOT EXISTS payment_attempts (
  id uuid PRIMARY KEY, intent_id uuid NOT NULL REFERENCES payment_intents(id), env_mode text NOT NULL, merchant_id text NOT NULL,
  connector text NOT NULL, attempt_index integer NOT NULL, status text NOT NULL, amount_cents integer NOT NULL, currency text NOT NULL,
  connector_transaction_id text, error_code text, error_message text, vault_token text, metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pa_intent ON payment_attempts (intent_id, attempt_index);
CREATE TABLE IF NOT EXISTS refunds (
  id uuid PRIMARY KEY, intent_id uuid NOT NULL REFERENCES payment_intents(id), attempt_id uuid NOT NULL, env_mode text NOT NULL,
  merchant_id text NOT NULL, connector text NOT NULL, connector_transaction_id text, connector_refund_id text,
  amount_cents integer NOT NULL, currency text NOT NULL, refund_status text NOT NULL, reason text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rf_intent ON refunds (intent_id);
CREATE TABLE IF NOT EXISTS invoices (
  id uuid PRIMARY KEY, intent_id uuid NOT NULL, merchant_id text NOT NULL, env_mode text NOT NULL, status text NOT NULL,
  number text, amount_cents integer NOT NULL, currency text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), issued_at timestamptz
);
CREATE TABLE IF NOT EXISTS webhook_endpoints (
  id uuid PRIMARY KEY, merchant_id text NOT NULL, env_mode text NOT NULL, target_url text NOT NULL, signing_secret text NOT NULL,
  events text[] NOT NULL, active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id uuid PRIMARY KEY, endpoint_id uuid NOT NULL, merchant_id text NOT NULL, env_mode text NOT NULL, event_type text NOT NULL,
  body text NOT NULL, status text NOT NULL, attempts integer NOT NULL DEFAULT 0, response_status integer, error text,
  next_attempt_at timestamptz, last_attempt_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wd_due ON webhook_deliveries (status, next_attempt_at);
CREATE TABLE IF NOT EXISTS idempotency_keys (
  scope text PRIMARY KEY, fingerprint text NOT NULL, state text NOT NULL, response_status integer, response_body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL
);
`;
