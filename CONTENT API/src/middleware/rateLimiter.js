'use strict';
const rateLimit = require('express-rate-limit');
const env = require('../config/env');
const { E } = require('../utils/errors');

module.exports = rateLimit({
  windowMs: env.rateLimit.windowMs,
  limit: env.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === '/health' || req.path === '/ready',
  handler: (req, res, next) => next(E.rateLimited()),
});
