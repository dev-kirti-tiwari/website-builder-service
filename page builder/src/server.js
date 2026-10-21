const app = require('./app');
const env = require('./config/env');
const pool = require('./config/database');

const server = app.listen(env.port, () => {
  console.log(`page-builder-service listening on :${env.port}`);
});

const shutdown = () => server.close(() => pool.end().then(() => process.exit(0)));
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
