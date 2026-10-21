import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { OPERATIONS, buildSpec } from '../../openapi/spec';
import { bearer, buildApp, newPool } from '../helpers';

const pool = newPool();
const app = buildApp(pool);
afterAll(() => pool.end());

describe('OpenAPI contract', () => {
  it('documents every operation as a route that exists', async () => {
    for (const op of OPERATIONS) {
      const url = '/api/v1' + op.path.replace(/\{\w+\}/g, '1');
      const res = await request(app)[op.method](url).set(bearer()).send({});
      expect(res.body?.error?.code, `${op.method.toUpperCase()} ${op.path}`).not.toBe('ROUTE_NOT_FOUND');
      expect(res.status, `${op.method.toUpperCase()} ${op.path}`).not.toBe(405);
    }
  });
  it('declares bearer auth for protected operations only', () => {
    const spec = buildSpec() as { paths: Record<string, Record<string, { security: unknown[] }>> };
    expect(spec.paths['/public/forms/{formId}/submissions'].post.security).toEqual([]);
    expect(spec.paths['/forms/{formId}'].get.security).toEqual([{ bearerAuth: [] }]);
  });
});
