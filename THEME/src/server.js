'use strict';

const { loadConfig } = require('./config');
const { createLogger } = require('./logger');
const { createPool } = require('./db');
const { createApp } = require('./app');

const config = loadConfig();
const logger = createLogger(config);
const pool = createPool(config, logger);
const app = createApp({ config, pool, logger });

const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT, env: config.NODE_ENV }, 'Theme API listening');
});

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down');
  server.close(async () => {
    await pool.end().catch(() => {});
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  logger.error({ err: { message: String(reason && reason.message ? reason.message : reason) } }, 'Unhandled rejection');
});
