import { z } from 'zod';

const bool = (def: 'true' | 'false') =>
  z.enum(['true', 'false']).default(def).transform((v) => v === 'true');

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    DATABASE_URL: z.string().min(1),
    DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
    AUTH_MODE: z.enum(['direct-jwt', 'gateway-context']).default('direct-jwt'),
    JWT_SECRET: z.string().min(32).optional(),
    JWT_ISSUER: z.string().min(1).optional(),
    JWT_AUDIENCE: z.string().min(1).optional(),
    INTERNAL_SERVICE_TOKEN: z.string().min(32).optional(),
    PUBLIC_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),
    PUBLIC_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
    BODY_LIMIT: z.string().default('100kb'),
    // Comma-separated browser origins allowed to call the API (empty = CORS disabled).
    CORS_ORIGINS: z
      .string()
      .default('')
      .transform((v) => v.split(',').map((o) => o.trim()).filter(Boolean)),
    TRUST_PROXY: z.coerce.number().int().min(0).default(0),
    OUTBOX_WORKER_ENABLED: bool('true'),
    OUTBOX_POLL_MS: z.coerce.number().int().positive().default(5000),
  })
  .superRefine((v, ctx) => {
    const need = (key: string, ok: boolean) =>
      ok ||
      ctx.addIssue({ code: 'custom', path: [key], message: `${key} is required for AUTH_MODE=${v.AUTH_MODE}` });
    if (v.AUTH_MODE === 'direct-jwt') {
      need('JWT_SECRET', !!v.JWT_SECRET);
      need('JWT_ISSUER', !!v.JWT_ISSUER);
      need('JWT_AUDIENCE', !!v.JWT_AUDIENCE);
    } else {
      need('INTERNAL_SERVICE_TOKEN', !!v.INTERNAL_SERVICE_TOKEN);
    }
  });

export type Config = z.infer<typeof schema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${msg}`);
  }
  return parsed.data;
}
