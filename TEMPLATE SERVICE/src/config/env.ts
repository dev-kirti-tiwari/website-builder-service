import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4018),
  DATABASE_URL: z.string().min(1),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  DB_CONNECTION_TIMEOUT_MS: z.coerce.number().int().min(100).default(5000),
  DB_IDLE_TIMEOUT_MS: z.coerce.number().int().min(1000).default(30000),
  // Trusted BFF -> service model: a private internal Bearer token, never accepted from browsers.
  STATIC_INTERNAL_TOKEN: z.string().min(16, 'STATIC_INTERNAL_TOKEN must be at least 16 characters'),
  // stub = local-development adapters; http = real downstream services (contracts must be confirmed first).
  INTEGRATIONS_MODE: z.enum(['stub', 'http']).default('stub'),
  WEBSITE_SERVICE_URL: z.string().optional(),
  DOCUMENT_SERVICE_URL: z.string().optional(),
  MEDIA_SERVICE_URL: z.string().optional(),
  NAVIGATION_SERVICE_URL: z.string().optional(),
  THEME_SERVICE_URL: z.string().optional(),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(1000),
  RECONCILE_INTERVAL_MS: z.coerce.number().int().min(0).default(30000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${issues}`);
  }
  const cfg = parsed.data;
  if (cfg.NODE_ENV === 'production') {
    if (/change|replace|example|inject/i.test(cfg.STATIC_INTERNAL_TOKEN)) {
      throw new Error('Invalid configuration: STATIC_INTERNAL_TOKEN is still a placeholder');
    }
    if (cfg.INTEGRATIONS_MODE === 'stub') {
      throw new Error('Invalid configuration: INTEGRATIONS_MODE=stub is not allowed in production');
    }
  }
  return cfg;
}
