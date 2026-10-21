const rateLimit = require('express-rate-limit');
const env = require('../config/env');

module.exports = rateLimit({
  windowMs: env.rateLimitWindowMs,
  limit: env.rateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      error: { code: 'RATE_LIMITED', message: 'Too many requests.', details: [] },
      meta: { requestId: req.id },
    });
  },
});
