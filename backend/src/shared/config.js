// backend/src/shared/config.js
const path = require('path');
const dotenv = require('dotenv');

// Load .env from project root if present
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
const projectRoot = path.resolve(__dirname, '../../../');
const localStoragePath = process.env.LOCAL_STORAGE_PATH
  ? path.resolve(projectRoot, process.env.LOCAL_STORAGE_PATH)
  : path.resolve(projectRoot, 'storage/invoices');

const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  workerPort: parseInt(process.env.WORKER_PORT || '3001', 10),
  mockPspPort: parseInt(process.env.MOCK_PSP_PORT || '4001', 10),
  appDefaultMode: process.env.APP_DEFAULT_MODE || 'test',
  gitCommitSha: process.env.GIT_COMMIT_SHA || 'local-dev',
  jenkinsBuildNumber: process.env.JENKINS_BUILD_NUMBER || '0',
  awsRegion: process.env.AWS_REGION || 'eu-north-1',
  awsAvailabilityZone: process.env.AWS_AVAILABILITY_ZONE || 'local-dev-az',
  autoMigrate: process.env.AUTO_MIGRATE === 'true',

  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    name: process.env.DB_NAME || 'payops',
    user: process.env.DB_USER || 'payops_admin',
    password: process.env.DB_PASSWORD || 'change_me_in_secrets_manager',
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
    max: parseInt(process.env.DB_MAX_CONNECTIONS || '20', 10),
    idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT_MS || '30000', 10),
    connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT_MS || '5000', 10),
  },

  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
  },

  queue: {
    driver: process.env.QUEUE_DRIVER || 'redis',
    sqsUrl: process.env.SQS_QUEUE_URL || null,
  },

  security: {
    vaultEncryptionKey:
      process.env.VAULT_ENCRYPTION_KEY ||
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    webhookSigningSecret:
      process.env.WEBHOOK_SIGNING_SECRET || 'whsec_payops_test_master_secret_key_32bytes!',
  },

  connectors: {
    mockStripeUrl: process.env.MOCK_STRIPE_URL || 'http://localhost:4001',
    mockPaymoUrl: process.env.MOCK_PAYMO_URL || 'http://localhost:4002',
  },

  storage: {
    s3Bucket: process.env.S3_BUCKET_NAME || null,
    s3PresignedTtlSeconds: parseInt(process.env.S3_PRESIGNED_TTL_SECONDS || '900', 10),
    localStoragePath,
  },
};

module.exports = config;
