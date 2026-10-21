const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const pino = require('pino');
const pinoHttp = require('pino-http');
const env = require('./config/env');
const pool = require('./config/database');
const requestId = require('./middleware/requestId');
const rateLimiter = require('./middleware/rateLimiter');
const requireJson = require('./middleware/requireJson');
const authenticate = require('./middleware/authentication');
const workspace = require('./middleware/workspace');
const errorHandler = require('./middleware/errorHandler');
const registry = require('./modules/sectionRegistry/registry');
const { send } = require('./utils/http');

const logger = pino({
  level: env.logLevel,
  redact: ['req.headers.authorization', 'req.headers["x-internal-service-token"]'],
});

const app = express();
app.disable('x-powered-by');
app.use(requestId);
app.use(pinoHttp({ logger, genReqId: (req) => req.id }));
app.use(helmet());
app.use(cors({ origin: env.corsOrigins }));
app.use(express.json({ limit: env.bodyLimit }));

app.get('/health', (req, res) => send(req, res, { status: 'ok' }));

app.get('/ready', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    send(req, res, { status: 'ready' });
  } catch (e) {
    req.log.error({ err: e }, 'readiness check failed');
    res.status(503).json({
      success: false,
      error: { code: 'NOT_READY', message: 'Database unavailable.', details: [] },
      meta: { requestId: req.id },
    });
  }
});

const api = express.Router();
api.use(rateLimiter, requireJson, authenticate);
api.get('/section-types', (req, res) => send(req, res, registry.list()));
api.use(workspace);
api.use('/pages', require('./modules/pages/page.routes'));
app.use('/api/v1', api);

app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: 'Route not found.', details: [] },
    meta: { requestId: req.id },
  });
});
app.use(errorHandler);

module.exports = app;
