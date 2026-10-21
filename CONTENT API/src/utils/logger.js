'use strict';
const pino = require('pino');
const env = require('../config/env');

module.exports = pino({
  level: env.logLevel,
  base: { service: 'content-api' },
  redact: {
    paths: [
      'req.headers.authorization',
      'headers.authorization',
      'headers["x-internal-service-token"]',
      'authorization',
      'token',
      'password',
      'content',
      'body',
    ],
    censor: '[REDACTED]',
  },
});
