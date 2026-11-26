// backend/src/shared/logger.js
const pino = require('pino');
const config = require('./config');

const isDev = config.env === 'development';

const logger = pino({
  level: process.env.LOG_LEVEL || (isDev ? 'debug' : 'info'),
  transport: isDev
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss Z',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
  base: {
    service: 'payops-platform',
    env: config.env,
    commit: config.gitCommitSha,
  },
});

module.exports = logger;
