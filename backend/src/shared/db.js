// backend/src/shared/db.js
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const logger = require('./logger');

const pool = new Pool({
  host: config.db.host,
  port: config.db.port,
  database: config.db.name,
  user: config.db.user,
  password: config.db.password,
  ssl: config.db.ssl,
  max: config.db.max,
  idleTimeoutMillis: config.db.idleTimeoutMillis,
  connectionTimeoutMillis: config.db.connectionTimeoutMillis,
});

pool.on('error', (err) => {
  logger.error({ err: err.message }, 'Unexpected PostgreSQL pool error');
});

/**
 * Execute a parameterized SQL query
 * @param {string} text - SQL statement
 * @param {Array} [params] - Query parameters
 * @returns {Promise<import('pg').QueryResult>}
 */
async function query(text, params = []) {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    logger.debug({ text, duration, rows: res.rowCount }, 'Executed PostgreSQL query');
    return res;
  } catch (err) {
    logger.error({ text, err: err.message }, 'PostgreSQL query error');
    throw err;
  }
}

/**
 * Execute a query and return only the first row or null
 * @param {string} text - SQL statement
 * @param {Array} [params] - Query parameters
 * @returns {Promise<object|null>}
 */
async function queryOne(text, params = []) {
  const res = await query(text, params);
  return res.rows.length > 0 ? res.rows[0] : null;
}

/**
 * Acquire a client from the pool for manual transactions
 * Remember to call client.release() when done!
 * @returns {Promise<import('pg').PoolClient>}
 */
async function getClient() {
  return pool.connect();
}

/**
 * Execute a unit of work inside a managed transaction
 * @param {function(import('pg').PoolClient): Promise<any>} callback
 * @returns {Promise<any>}
 */
async function withTransaction(callback) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Health check probe: returns round-trip latency in milliseconds
 * @returns {Promise<number>}
 */
async function pingDatabase() {
  const start = Date.now();
  await pool.query('SELECT 1');
  return Date.now() - start;
}

/**
 * Apply pending PostgreSQL migrations from directory
 * Tracks executed migrations in `schema_migrations` table
 * @param {string} [migrationsDir]
 */
async function runMigrations(migrationsDir) {
  const targetDir = migrationsDir || path.resolve(__dirname, '../../../migrations');
  logger.info({ targetDir }, 'Checking database migrations');

  // Ensure migration tracking table exists
  await query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  const appliedRows = await query('SELECT filename FROM schema_migrations');
  const applied = new Set(appliedRows.rows.map((r) => r.filename));

  const allFiles = fs
    .readdirSync(targetDir)
    .filter((f) => f.endsWith('.sql') && !f.includes('seed'))
    .sort();

  for (const file of allFiles) {
    if (applied.has(file)) {
      continue;
    }

    const filePath = path.join(targetDir, file);
    const sql = fs.readFileSync(filePath, 'utf8');

    logger.info({ file }, 'Applying migration');
    await withTransaction(async (client) => {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
    });
    logger.info({ file }, 'Migration applied successfully');
  }

  logger.info('Database migrations up to date');
}

/**
 * Execute a SQL seed file
 * @param {string} [seedFilePath]
 */
async function runSeed(seedFilePath) {
  const targetFile = seedFilePath || path.resolve(__dirname, '../../../migrations/seed.sql');
  if (!fs.existsSync(targetFile)) {
    throw new Error(`Seed file not found at: ${targetFile}`);
  }

  logger.info({ targetFile }, 'Applying database seed');
  const sql = fs.readFileSync(targetFile, 'utf8');
  await withTransaction(async (client) => {
    await client.query(sql);
  });
  logger.info('Database seed executed successfully');
}

// -----------------------------------------------------------------------------
// Domain Helpers (Hyperswitch-style Payment Intent & Attempt State Mutators)
// -----------------------------------------------------------------------------

/**
 * Create a new Payment Intent
 * @param {object} param0
 */
async function createPaymentIntent({
  envMode = 'test',
  merchantId,
  amountCents,
  currency = 'USD',
  captureMethod = 'automatic',
  customerEmail = null,
  description = null,
  status = 'requires_confirmation',
  idempotencyKey = null,
  metadata = {},
}) {
  const row = await queryOne(
    `INSERT INTO payment_intents 
      (env_mode, merchant_id, amount_cents, currency, capture_method, 
       customer_email, description, status, idempotency_key, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
     RETURNING *`,
    [
      envMode,
      merchantId,
      amountCents,
      currency,
      captureMethod,
      customerEmail,
      description,
      status,
      idempotencyKey,
      JSON.stringify(metadata),
    ]
  );
  return row;
}

/**
 * Update payment intent status and link active attempt
 * @param {string} intentId
 * @param {string} status
 * @param {string} [activeAttemptId]
 */
async function updatePaymentIntentStatus(intentId, status, activeAttemptId = null) {
  const row = await queryOne(
    `UPDATE payment_intents
     SET status = $1,
         active_attempt_id = COALESCE($2, active_attempt_id),
         attempt_count = CASE WHEN $2 IS NOT NULL THEN attempt_count + 1 ELSE attempt_count END,
         updated_at = NOW()
     WHERE id = $3
     RETURNING *`,
    [status, activeAttemptId, intentId]
  );
  return row;
}

/**
 * Create a new payment attempt row
 * @param {object} param0
 */
async function createPaymentAttempt({
  intentId,
  merchantId,
  envMode = 'test',
  connector,
  amountCents,
  currency = 'USD',
  attemptIndex = 1,
  status = 'started',
  vaultToken = null,
  metadata = {},
}) {
  const row = await queryOne(
    `INSERT INTO payment_attempts
      (intent_id, merchant_id, env_mode, connector, amount_cents, currency,
       attempt_index, status, vault_token, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
     RETURNING *`,
    [
      intentId,
      merchantId,
      envMode,
      connector,
      amountCents,
      currency,
      attemptIndex,
      status,
      vaultToken,
      JSON.stringify(metadata),
    ]
  );
  return row;
}

/**
 * Update an existing payment attempt with connector execution result
 * @param {string} attemptId
 * @param {object} updates
 */
async function updatePaymentAttempt(attemptId, {
  status,
  connectorTransactionId = null,
  errorCode = null,
  errorMessage = null,
  metadata = null,
}) {
  const row = await queryOne(
    `UPDATE payment_attempts
     SET status = COALESCE($1, status),
         connector_transaction_id = COALESCE($2, connector_transaction_id),
         error_code = COALESCE($3, error_code),
         error_message = COALESCE($4, error_message),
         metadata = CASE WHEN $5::jsonb IS NOT NULL THEN $5::jsonb ELSE metadata END,
         updated_at = NOW()
     WHERE id = $6
     RETURNING *`,
    [
      status,
      connectorTransactionId,
      errorCode,
      errorMessage,
      metadata ? JSON.stringify(metadata) : null,
      attemptId,
    ]
  );
  return row;
}

/**
 * Close database pool cleanly
 */
async function close() {
  await pool.end();
  logger.info('PostgreSQL pool connection drained');
}

module.exports = {
  pool,
  query,
  queryOne,
  getClient,
  withTransaction,
  pingDatabase,
  runMigrations,
  runSeed,
  createPaymentIntent,
  updatePaymentIntentStatus,
  createPaymentAttempt,
  updatePaymentAttempt,
  close,
};
