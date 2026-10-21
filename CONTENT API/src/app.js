'use strict';
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const env = require('./config/env');
const { pool } = require('./config/database');
const requestId = require('./middleware/requestId');
const requestLogger = require('./middleware/requestLogger');
const rateLimiter = require('./middleware/rateLimiter');
const { errorHandler, notFound } = require('./middleware/errorHandler');
const { E } = require('./utils/errors');
const contentRoutes = require('./modules/content/content.routes');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(requestId);
app.use(requestLogger);
app.use(helmet());
app.use(cors({
  origin: env.corsOrigins,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Authorization', 'Content-Type', 'X-Workspace-Id', 'X-Request-Id'],
  exposedHeaders: ['X-Request-Id'],
}));

app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.get('/ready', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ready', checks: { postgres: 'up' } });
  } catch {
    res.status(503).json({ status: 'not_ready', checks: { postgres: 'down' } });
  }
});

app.use(rateLimiter);

// reject non-JSON bodies explicitly instead of silently ignoring them
app.use((req, res, next) => {
  const hasBody = Number(req.get('content-length') || 0) > 0 || req.get('transfer-encoding');
  if (hasBody && !req.is('application/json')) return next(E.unsupportedMedia());
  next();
});
app.use(express.json({ limit: env.bodyLimit, strict: true }));

app.use('/api/v1', contentRoutes);
app.use(notFound);
app.use(errorHandler);

module.exports = app;
