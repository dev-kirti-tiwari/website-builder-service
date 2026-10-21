'use strict';

const crypto = require('node:crypto');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const { rateLimit } = require('express-rate-limit');
const pinoHttp = require('pino-http');

const { AppError } = require('./errors');
const { authenticate } = require('./middleware/auth');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');
const repo = require('./repositories/themeRepository');
const { createThemeService } = require('./services/themeService');
const { createAudit } = require('./audit');
const { themeRoutes } = require('./routes/themes');

const REQUEST_ID_RE = /^[A-Za-z0-9._-]{8,128}$/;

function createApp({ config, pool, logger }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  // Request ID: accept a well-formed inbound X-Request-Id, otherwise generate one.
  app.use((req, res, next) => {
    const inbound = req.get('x-request-id');
    req.id = inbound && REQUEST_ID_RE.test(inbound) ? inbound : crypto.randomUUID();
    res.set('X-Request-Id', req.id);
    next();
  });

  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => req.id,
      // Only safe fields are logged: no headers, no bodies.
      serializers: {
        req: (req) => ({ id: req.id, method: req.method, url: req.url.split('?')[0] }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
      customProps: (req) => ({ userId: req.auth?.userId, workspaceId: req.auth?.workspaceId }),
      autoLogging: { ignore: (req) => req.url === '/health' },
    }),
  );

  app.use(helmet());
  app.use(
    cors({
      origin(origin, cb) {
        // Non-browser callers (no Origin) are allowed; browsers must be on the allowlist.
        if (!origin || config.corsOrigins.includes(origin)) return cb(null, true);
        return cb(null, false);
      },
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Authorization', 'Content-Type', 'X-Workspace-Id', 'X-Request-Id', 'X-Internal-Service-Token', 'If-Match'],
      exposedHeaders: ['X-Request-Id', 'ETag', 'Location'],
      maxAge: 600,
    }),
  );

  // Operational endpoints: no auth, no secrets, no infrastructure details.
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.get('/ready', async (req, res) => {
    try {
      await repo.ping(pool);
      res.json({ status: 'ready' });
    } catch (err) {
      req.log.error({ err: { message: err.message } }, 'Readiness check failed');
      res.status(503).json({ status: 'unavailable' });
    }
  });

  app.use(
    rateLimit({
      windowMs: config.RATE_LIMIT_WINDOW_MS,
      limit: config.RATE_LIMIT_MAX,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      handler: (_req, _res, next) => next(new AppError(429, 'RATE_LIMITED', 'Too many requests, slow down')),
    }),
  );

  // Body limit leaves headroom over the max config size for the surrounding JSON fields.
  app.use(express.json({ limit: config.THEME_MAX_CONFIG_BYTES + 16384 }));

  const service = createThemeService({ pool, config, audit: createAudit(config, logger) });
  app.use('/api/v1/themes', authenticate(config), themeRoutes(service));

  app.use(notFoundHandler);
  app.use(errorHandler(logger));
  return app;
}

module.exports = { createApp };
