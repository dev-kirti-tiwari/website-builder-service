'use strict';
require('dotenv').config({ quiet: true });

const int = (name, def) => {
  const v = process.env[name];
  if (v === undefined || v === '') return def;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${name} must be a non-negative integer`);
  return n;
};
const str = (name, def = '') => (process.env[name] ?? def).trim();
const list = (name) => str(name).split(',').map((s) => s.trim()).filter(Boolean);

const env = {
  nodeEnv: str('NODE_ENV', 'development'),
  port: int('PORT', 4080),
  logLevel: str('LOG_LEVEL', 'info'),
  databaseUrl: str('DATABASE_URL'),
  jwt: {
    secret: str('JWT_SECRET'),
    publicKey: str('JWT_PUBLIC_KEY').replace(/\n/g, '\n'),
    issuer: str('JWT_ISSUER'),
    audience: str('JWT_AUDIENCE'),
  },
  internalServiceToken: str('INTERNAL_SERVICE_TOKEN'),
  corsOrigins: list('CORS_ORIGINS'),
  rateLimit: { windowMs: int('RATE_LIMIT_WINDOW_MS', 60000), max: int('RATE_LIMIT_MAX', 120) },
  bodyLimit: str('BODY_LIMIT', '512kb'),
  pageBuilder: {
    enabled: str('PAGE_BUILDER_VALIDATION', 'disabled') === 'enabled',
    baseUrl: str('PAGE_BUILDER_BASE_URL'),
    sectionPath: str('PAGE_BUILDER_SECTION_PATH', '/api/v1/internal/sections/{sectionId}'),
  },
  media: { enabled: str('MEDIA_VALIDATION', 'disabled') === 'enabled', baseUrl: str('MEDIA_BASE_URL') },
  audit: { baseUrl: str('AUDIT_BASE_URL'), eventsPath: str('AUDIT_EVENTS_PATH', '/api/v1/events') },
};

env.validate = () => {
  const problems = [];
  if (!env.databaseUrl) problems.push('DATABASE_URL is required');
  if (!env.jwt.secret && !env.jwt.publicKey) problems.push('JWT_SECRET or JWT_PUBLIC_KEY is required');
  if (env.nodeEnv === 'production' && !env.internalServiceToken) problems.push('INTERNAL_SERVICE_TOKEN is required');
  if (env.pageBuilder.enabled && !env.pageBuilder.baseUrl) problems.push('PAGE_BUILDER_BASE_URL is required when validation is enabled');
  if (problems.length) throw new Error(`Invalid configuration: ${problems.join('; ')}`);
};

module.exports = env;
