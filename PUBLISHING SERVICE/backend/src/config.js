const secret = process.env.JWT_SECRET;
if (!secret || secret.length < 32) {
  throw new Error('JWT_SECRET must be set (min 32 chars)');
}

module.exports = {
  port: Number(process.env.PORT || 4010),
  databaseUrl: process.env.DATABASE_URL,
  jwt: {
    secret,
    issuer: process.env.JWT_ISSUER || 'triostackone-identity',
    audience: process.env.JWT_AUDIENCE || 'publishing-api',
  },
  workerEnabled: process.env.PUBLISHING_WORKER_ENABLED !== 'false',
  maxRetries: Number(process.env.PUBLISHING_MAX_RETRIES || 5),
  stageDelayMs: Number(process.env.PUBLISHING_STAGE_DELAY_MS || 150),
  leaseSeconds: Number(process.env.PUBLISHING_JOB_TIMEOUT_SECONDS || 900),
  seedDemo: process.env.SEED_DEMO === 'true',
};
