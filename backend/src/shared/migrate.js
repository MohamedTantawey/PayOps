// backend/src/shared/migrate.js
const path = require('path');
const db = require('./db');
const logger = require('./logger');

async function main() {
  const migrationsDir = path.resolve(__dirname, '../../../migrations');
  logger.info({ migrationsDir }, 'Starting database migrations');
  try {
    await db.runMigrations(migrationsDir);
    logger.info('Migrations completed successfully');
    process.exit(0);
  } catch (err) {
    logger.error({ err: err.message, stack: err.stack }, 'Migration failed');
    process.exit(1);
  } finally {
    await db.close().catch(() => {});
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };
