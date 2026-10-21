import { createApp } from './app';
import { loadConfig } from './config';
import { runMigrations } from './infrastructure/migrate';
import { log } from './infrastructure/logger';
import { startOutboxWorker } from './infrastructure/outbox/worker';
import { createPool } from './infrastructure/postgres';

async function main() {
  const config = loadConfig();
  const pool = createPool(config.DATABASE_URL, config.DATABASE_POOL_MAX);

  for (let attempt = 1; ; attempt++) {
    try {
      const applied = await runMigrations(pool);
      log('info', 'migrations complete', { applied });
      break;
    } catch (err) {
      if (attempt >= 20) throw err;
      log('warn', 'database not ready, retrying', { attempt, error: String((err as Error).message) });
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  const app = createApp(config, pool);
  const server = app.listen(config.PORT, () => log('info', 'form-api listening', { port: config.PORT }));
  const worker = config.OUTBOX_WORKER_ENABLED ? startOutboxWorker(pool, config.OUTBOX_POLL_MS) : null;

  const shutdown = (signal: string) => {
    log('info', 'shutting down', { signal });
    worker?.stop();
    server.close(async () => {
      await pool.end();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
