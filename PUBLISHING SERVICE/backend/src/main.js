const express = require('express');
const config = require('./config');
const db = require('./db');
const worker = require('./worker');
const { router } = require('./routes');
const { requestId, notFound, errorHandler } = require('./errors');

const app = express();
app.disable('x-powered-by');
app.use(requestId);
app.use(express.json({ limit: '1mb' }));

app.get('/health', async (_req, res) => {
  try {
    await db.q('SELECT 1');
    res.json({ status: 'ok', service: 'publishing-api', workerEnabled: config.workerEnabled });
  } catch {
    res.status(503).json({ status: 'unavailable' });
  }
});
app.use('/api/v1', router);
app.use(notFound);
app.use(errorHandler);

(async () => {
  await db.migrate();
  if (config.seedDemo) await db.seed();
  if (config.workerEnabled) worker.start();
  const server = app.listen(config.port, () => console.log(`Publishing API listening on :${config.port}`));
  const shutdown = () => { worker.stop(); server.close(() => db.pool.end().then(() => process.exit(0))); };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
})().catch((e) => { console.error(e); process.exit(1); });
