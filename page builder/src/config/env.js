require('dotenv').config({ quiet: true });

const authMode = process.env.AUTH_MODE || 'jwt';
const jwtKey = (process.env.JWT_PUBLIC_KEY || '').replace(/\\n/g, '\n') || process.env.JWT_SECRET || '';
const nodeEnv = process.env.NODE_ENV || 'development';

if (authMode === 'jwt' && !jwtKey) {
  throw new Error('AUTH_MODE=jwt requires JWT_PUBLIC_KEY or JWT_SECRET (align with the existing auth system).');
}
if (nodeEnv === 'production' && authMode === 'dev') {
  throw new Error('AUTH_MODE=dev is not allowed in production.');
}

module.exports = {
  nodeEnv,
  port: Number(process.env.PORT) || 4070,
  databaseUrl: process.env.DATABASE_URL,
  corsOrigins: (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
  logLevel: process.env.LOG_LEVEL || 'info',
  rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 60000,
  rateLimitMax: Number(process.env.RATE_LIMIT_MAX) || 120,
  bodyLimit: process.env.BODY_LIMIT || '512kb',
  authMode,
  jwtKey,
  jwtAlgorithms: (process.env.JWT_ALGORITHMS || (process.env.JWT_PUBLIC_KEY ? 'RS256' : 'HS256')).split(','),
  jwtIssuer: process.env.JWT_ISSUER || undefined,
  jwtAudience: process.env.JWT_AUDIENCE || undefined,
  internalServiceToken: process.env.INTERNAL_SERVICE_TOKEN || '',
};
