'use strict';

const pino = require('pino');

// `destination` is optional (used by tests to capture output).
function createLogger(config, destination) {
  return pino(
    {
      level: config.LOG_LEVEL,
      base: { service: 'theme-api' },
      timestamp: pino.stdTimeFunctions.isoTime,
      // Never let credentials reach the logs, even if a header/body is logged by mistake.
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.headers["x-internal-service-token"]',
          'headers.authorization',
          'headers["x-internal-service-token"]',
          'authorization',
          'token',
          '*.token',
          '*.secret',
          '*.password',
        ],
        censor: '[REDACTED]',
      },
    },
    destination,
  );
}

module.exports = { createLogger };
