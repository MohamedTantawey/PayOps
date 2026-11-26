// backend/src/shared/seed.js
const path = require('path');
const db = require('./db');
const logger = require('./logger');

async function main() {
  const seedFile = path.resolve(__dirname, '../../../migrations/seed.sql');
  logger.info({ seedFile }, 'Starting database deterministic seeding');
  try {
    await db.runSeed(seedFile);
    logger.info('Database seeded successfully for Test Mode (sk_test_) and Live Mode (sk_live_)');
    process.exit(0);
  } catch (err) {
    logger.error({ err: err.message, stack: err.stack }, 'Seeding failed');
    process.exit(1);
  } finally {
    await db.close().catch(() => {});
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };
