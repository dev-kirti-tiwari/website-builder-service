import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import type { Pool } from 'pg';
import swaggerUi from 'swagger-ui-express';
import { buildSpec } from '../openapi/spec';
import type { Config } from './config';
import { log } from './infrastructure/logger';
import { authenticate } from './middleware/authentication';
import { errorHandler, routeNotFound } from './middleware/error-handler';
import { requestId } from './middleware/request-id';
import { automationRoutes } from './modules/automations/routes';
import { fieldRoutes } from './modules/fields/routes';
import { formRoutes } from './modules/forms/routes';
import { publishingRoutes } from './modules/publishing/routes';
import { submissionRoutes } from './modules/submissions/routes';
import { publicRoutes } from './modules/submissions/public-routes';

export function createApp(config: Config, pool: Pool): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.TRUST_PROXY);
  app.use(requestId);
  app.use(helmet({ contentSecurityPolicy: false }));
  if (config.CORS_ORIGINS.length > 0) {
    // Handles preflight before authentication. Only listed origins are reflected; no cookies/credentials.
    app.use(
      cors({
        origin: config.CORS_ORIGINS,
        methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: [
          'Authorization', 'Content-Type', 'Idempotency-Key', 'X-Request-Id', 'X-Software-Id',
          'X-Tenant-Id', 'X-Organization-Id', 'X-User-Id',
        ],
        exposedHeaders: ['X-Request-Id'],
        maxAge: 600,
      }),
    );
  }
  app.use(express.json({ limit: config.BODY_LIMIT }));

  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () =>
      log('info', 'request', {
        requestId: req.requestId, method: req.method, path: req.path,
        status: res.statusCode, ms: Date.now() - start,
      }),
    );
    next();
  });

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });
  app.get('/ready', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ready' });
    } catch {
      res.status(503).json({ status: 'database unavailable' });
    }
  });

  const spec = buildSpec();
  app.get('/api/v1/openapi.json', (_req, res) => {
    res.json(spec);
  });
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(spec));

  // Public runtime routes: mounted BEFORE the authenticated router and never see authentication.
  app.use('/api/v1/public', publicRoutes(pool, config));

  const protectedApi = express.Router();
  protectedApi.use(authenticate(config));
  protectedApi.use(formRoutes(pool));
  protectedApi.use(fieldRoutes(pool));
  protectedApi.use(publishingRoutes(pool));
  protectedApi.use(submissionRoutes(pool));
  protectedApi.use(automationRoutes(pool));
  app.use('/api/v1', protectedApi);

  app.use(routeNotFound);
  app.use(errorHandler);
  return app;
}
