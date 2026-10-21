import express from 'express';
import type { Pool } from 'pg';
import type { Config } from './config/env';
import type { Integrations } from './integrations/clients';
import type { Logger } from './lib/logger';
import { authenticate } from './middleware/authenticate';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { rateLimit } from './middleware/rate-limit';
import { requestId } from './middleware/request-id';
import { trustedContext } from './middleware/trusted-context';
import { ApplicationService } from './modules/applications/application.service';
import { CatalogService } from './modules/catalog/catalog.service';
import { type Services, apiRoutes } from './modules/routes';
import { TemplateService } from './modules/templates/template.service';
import { VersionService } from './modules/versions/version.service';

export type AppDeps = { config: Config; pool: Pool; integrations: Integrations; logger: Logger };

export function createServices({ pool, integrations, logger }: Pick<AppDeps, 'pool' | 'integrations' | 'logger'>): Services {
  return {
    templates: new TemplateService(pool, integrations),
    versions: new VersionService(pool, integrations),
    catalog: new CatalogService(pool),
    applications: new ApplicationService(pool, integrations, logger),
  };
}

export function createApp(deps: AppDeps, services: Services = createServices(deps)) {
  const { config, pool, integrations, logger } = deps;
  const app = express();
  app.disable('x-powered-by');
  app.use(requestId);
  app.use((req, res, next) => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      logger.info('request', {
        requestId: res.locals.requestId,
        method: req.method,
        route: req.baseUrl + (req.route?.path ?? req.path),
        status: res.statusCode,
        latencyMs: Number(process.hrtime.bigint() - start) / 1e6,
      });
    });
    next();
  });
  app.use(rateLimit(config.RATE_LIMIT_PER_MINUTE));

  // Unauthenticated operational endpoints (no tenant data).
  app.get('/health', (_req, res) => {
    res.status(200).json({ success: true, data: { status: 'ok' }, requestId: res.locals.requestId });
  });
  app.get('/ready', async (_req, res) => {
    const checks = { database: false, integrations: false };
    try {
      await pool.query('SELECT 1');
      checks.database = true;
    } catch {
      /* reported via checks */
    }
    try {
      checks.integrations = await integrations.ready();
    } catch {
      /* reported via checks */
    }
    const ready = checks.database && checks.integrations;
    res.status(ready ? 200 : 503).json({ success: ready, data: { status: ready ? 'ready' : 'not_ready', checks }, requestId: res.locals.requestId });
  });

  const api = express.Router();
  api.use(authenticate(config.STATIC_INTERNAL_TOKEN));
  api.use(trustedContext);
  api.use(express.json({ limit: '2mb' }));
  api.use(apiRoutes(services, logger));
  app.use('/api/v1', api);

  app.use(notFoundHandler);
  app.use(errorHandler(logger));
  return app;
}
