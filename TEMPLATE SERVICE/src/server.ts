import { createApp, createServices } from './app';
import { loadConfig } from './config/env';
import { createPool } from './database/pool';
import { createHttpIntegrations, createStubIntegrations } from './integrations/clients';
import { createLogger } from './lib/logger';

function main() {
  const config = loadConfig();
  const logger = createLogger(config.LOG_LEVEL);
  const pool = createPool(config);
  pool.on('error', (e) => logger.error('pg_pool_error', { error: e.message }));

  const integrations = config.INTEGRATIONS_MODE === 'stub' ? createStubIntegrations() : createHttpIntegrations();
  if (config.INTEGRATIONS_MODE === 'stub') logger.warn('integrations_stub_mode', { note: 'local-development adapters in use' });

  const services = createServices({ pool, integrations, logger });
  const app = createApp({ config, pool, integrations, logger }, services);
  const server = app.listen(config.PORT, () => logger.info('listening', { port: config.PORT, env: config.NODE_ENV }));

  // Resume applications left in flight by a crash or downstream outage.
  let timer: NodeJS.Timeout | undefined;
  if (config.RECONCILE_INTERVAL_MS > 0) {
    timer = setInterval(() => {
      services.applications.reconcile().catch((e) => logger.error('reconcile_error', { error: String(e) }));
    }, config.RECONCILE_INTERVAL_MS);
    timer.unref();
  }

  let closing = false;
  const shutdown = (signal: string) => {
    if (closing) return;
    closing = true;
    logger.info('shutdown_started', { signal });
    if (timer) clearInterval(timer);
    const force = setTimeout(() => process.exit(1), 10_000);
    force.unref();
    server.close(() => {
      pool.end().finally(() => {
        logger.info('shutdown_complete');
        process.exit(0);
      });
    });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

try {
  main();
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
