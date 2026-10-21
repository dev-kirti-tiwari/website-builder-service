import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { createApp, createServices } from '../src/app';
import { loadConfig } from '../src/config/env';
import { createPool } from '../src/database/pool';
import { migrate } from '../src/database/migrate';
import { createStubIntegrations } from '../src/integrations/clients';
import { createLogger } from '../src/lib/logger';

export const TOKEN = 'test-internal-token-0123456789abcdef';

export async function setup() {
  const config = loadConfig({ ...process.env, STATIC_INTERNAL_TOKEN: TOKEN, LOG_LEVEL: 'error', NODE_ENV: 'test' });
  const pool = createPool(config);
  await migrate(pool, 'up');
  const logger = createLogger('error');
  const integrations = createStubIntegrations();
  const services = createServices({ pool, integrations, logger });
  const app = createApp({ config, pool, integrations, logger }, services);
  return { app, pool, services };
}

/** Unique BIGINT-sized tenant/org per call so tests never collide with each other or with dev data. */
export const randomId = () => (BigInt('0x' + randomBytes(6).toString('hex')) + 9_000_000_000_000_000n).toString();

export type Actor = { tenant: string; org: string; user: string; perms: string };
export const newActor = (perms = '*'): Actor => ({ tenant: randomId(), org: randomId(), user: randomId(), perms });

export function api(app: Parameters<typeof request>[0], a: Actor) {
  const h = (r: request.Test) =>
    r
      .set('Authorization', `Bearer ${TOKEN}`)
      .set('X-Tenant-Id', a.tenant)
      .set('X-Organization-Id', a.org)
      .set('X-User-Id', a.user)
      .set('X-Permissions', a.perms);
  return {
    get: (p: string) => h(request(app).get(p)),
    post: (p: string, body?: unknown) => h(request(app).post(p)).send(body as object),
    patch: (p: string, body?: unknown) => h(request(app).patch(p)).send(body as object),
  };
}

export const snapshot = (name = 'Test Template') => ({
  schemaVersion: 1,
  metadata: { name, locale: 'en' },
  theme: { tokens: { primary: '#234567' } },
  pages: [{ slug: '/', title: 'Home', sections: [{ type: 'hero', props: { heading: 'Hi' }, assetRefs: ['8801'] }] }],
  navigation: [{ label: 'Home', href: '/' }],
});

/** Create + review + publish a template, returning its IDs. */
export async function publishedTemplate(app: Parameters<typeof request>[0], a: Actor, extra: Record<string, unknown> = {}) {
  const c = api(app, a);
  const t = await c.post('/api/v1/templates', { name: 'Tpl', slug: `tpl-${randomId()}`, ...extra });
  const base = `/api/v1/templates/${t.body.data.id}`;
  const v = await c.post(`${base}/versions`, { snapshot: snapshot() });
  const vb = `${base}/versions/${v.body.data.id}`;
  await c.post(`${vb}/submit-review`);
  await c.post(`${vb}/approve`);
  await c.post(`${vb}/publish`);
  return { templateId: t.body.data.id as string, versionId: v.body.data.id as string, base, vb };
}
