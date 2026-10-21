'use strict';
const env = require('./config/env');
env.validate();
const app = require('./app');
const { pool } = require('./config/database');
const logger = require('./utils/logger');

const server = app.listen(env.port, () => logger.info({ port: env.port, env: env.nodeEnv }, 'content-api listening'));

let closing = false;
function shutdown(signal) {
  if (closing) return;
  closing = true;
  logger.info({ signal }, 'shutting down');
  server.close(async () => {
    await pool.end().catch(() => {});
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
