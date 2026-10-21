import jwt from 'jsonwebtoken';
import { Pool } from 'pg';
import request from 'supertest';
import { createApp } from '../src/app';
import { loadConfig, type Config } from '../src/config';

export const SECRET = 'test-secret-test-secret-test-secret-1234';
export const ISSUER = 'test-issuer';
export const AUDIENCE = 'form-api';
export const INTERNAL_TOKEN = 'internal-token-internal-token-123456789';

export function testConfig(overrides: Record<string, string> = {}): Config {
  return loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: process.env.DATABASE_URL,
    JWT_SECRET: SECRET,
    JWT_ISSUER: ISSUER,
    JWT_AUDIENCE: AUDIENCE,
    INTERNAL_SERVICE_TOKEN: INTERNAL_TOKEN,
    OUTBOX_WORKER_ENABLED: 'false',
    PUBLIC_RATE_LIMIT_MAX: '1000',
    ...overrides,
  });
}

export function newPool(): Pool {
  return new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
}

export function buildApp(pool: Pool, overrides: Record<string, string> = {}) {
  return createApp(testConfig(overrides), pool);
}

export async function resetDb(pool: Pool): Promise<void> {
  await pool.query(`TRUNCATE forms, form_fields, form_schema_versions, form_submissions,
    form_automations, audit_events, outbox_events, idempotency_keys RESTART IDENTITY CASCADE`);
}

export interface Identity {
  tenant?: string;
  org?: string;
  user?: string;
  roles?: string[];
}

export function token(id: Identity = {}, extra: jwt.SignOptions = {}, claims: Record<string, unknown> = {}): string {
  return jwt.sign(
    {
      tenant_id: id.tenant ?? '1',
      organization_id: id.org ?? '10',
      roles: id.roles ?? ['form_admin'],
      ...claims,
    },
    SECRET,
    { algorithm: 'HS256', subject: id.user ?? '100', issuer: ISSUER, audience: AUDIENCE, expiresIn: '5m', ...extra },
  );
}

export function bearer(id: Identity = {}): Record<string, string> {
  return { Authorization: `Bearer ${token(id)}` };
}

export const A: Identity = { tenant: '1', org: '10', user: '100' };
export const OTHER_TENANT: Identity = { tenant: '2', org: '10', user: '200' };
export const OTHER_ORG: Identity = { tenant: '1', org: '11', user: '300' };

type App = ReturnType<typeof buildApp>;

export async function createForm(app: App, id: Identity = A, body: Record<string, unknown> = { name: 'Contact us' }) {
  const res = await request(app).post('/api/v1/websites/5/forms').set(bearer(id)).send(body);
  return res.body.data as { id: string };
}

export async function addField(app: App, formId: string, field: Record<string, unknown>, id: Identity = A) {
  const res = await request(app).post(`/api/v1/forms/${formId}/fields`).set(bearer(id)).send(field);
  return res.body.data as { id: string };
}

/** Creates a published form with name(text,required), email(email,required), topic(select). */
export async function seedPublishedForm(app: App, id: Identity = A): Promise<string> {
  const form = await createForm(app, id);
  await addField(app, form.id, { name: 'name', label: 'Name', type: 'text', required: true, validation: { maxLength: 50 } }, id);
  await addField(app, form.id, { name: 'email', label: 'Email', type: 'email', required: true }, id);
  await addField(app, form.id, { name: 'topic', label: 'Topic', type: 'select', options: ['sales', 'support'] }, id);
  const pub = await request(app).post(`/api/v1/forms/${form.id}/publish`).set(bearer(id));
  if (pub.status !== 200) throw new Error(`publish failed: ${JSON.stringify(pub.body)}`);
  return form.id;
}
