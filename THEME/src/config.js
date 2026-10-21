'use strict';

require('dotenv').config({ quiet: true });
const { z } = require('zod');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4065),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),

  // Auth: HS256 JWT in "Authorization: Bearer <jwt>".
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_ISSUER: z.string().min(1).optional(),
  JWT_AUDIENCE: z.string().min(1).optional(),
  // Optional BFF-to-service shared secret. When set, X-Internal-Service-Token is mandatory.
  INTERNAL_SERVICE_TOKEN: z.string().min(16).optional(),

  CORS_ORIGINS: z.string().default(''),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(60000),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(300),
  THEME_MAX_CONFIG_BYTES: z.coerce.number().int().min(1024).default(262144),

  AUDIT_SERVICE_URL: z.string().url().optional(),
  AUDIT_SERVICE_TOKEN: z.string().min(1).optional(),
});

function loadConfig(env = process.env) {
  // Treat empty strings (e.g. "KEY=" in .env) as "not set".
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v !== ''));
  const parsed = schema.safeParse(cleaned);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  const cfg = parsed.data;
  return {
    ...cfg,
    corsOrigins: cfg.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
    isProduction: cfg.NODE_ENV === 'production',
  };
}

module.exports = { loadConfig };
