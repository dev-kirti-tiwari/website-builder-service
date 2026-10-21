import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ZodType } from 'zod';
import { badRequest, unprocessable } from './errors';
import { isBigIntId } from './bigint';

/** Wrap an async handler so rejections reach the central error handler (Express 4). */
export const wrap =
  (fn: (req: Request, res: Response) => Promise<void>): RequestHandler =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };

/** PostgreSQL text/jsonb cannot store NUL; reject it up front instead of surfacing a database error. */
function hasNul(v: unknown, depth = 0): boolean {
  if (typeof v === 'string') return v.includes('\u0000');
  if (depth > 32 || !v || typeof v !== 'object') return false;
  return Object.entries(v).some(([k, x]) => k.includes('\u0000') || hasNul(x, depth + 1));
}

export function parseBody<T>(schema: ZodType<T>, body: unknown): T {
  if (hasNul(body)) throw unprocessable('VALIDATION_ERROR', 'Request validation failed', [{ path: '', message: 'NUL characters are not allowed' }]);
  const r = schema.safeParse(body ?? {});
  if (!r.success) {
    throw unprocessable(
      'VALIDATION_ERROR',
      'Request validation failed',
      r.error.issues.slice(0, 20).map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return r.data;
}

export function parseQuery<T>(schema: ZodType<T>, query: unknown): T {
  if (hasNul(query)) throw badRequest('INVALID_QUERY', 'Invalid query parameters', [{ path: '', message: 'NUL characters are not allowed' }]);
  const r = schema.safeParse(query);
  if (!r.success) {
    throw badRequest(
      'INVALID_QUERY',
      'Invalid query parameters',
      r.error.issues.slice(0, 20).map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return r.data;
}

/** Validates a path parameter as a strict BIGINT decimal string; it stays a string end to end. */
export function idParam(req: Request, name: string): string {
  const v = req.params[name];
  if (!isBigIntId(v)) throw badRequest('INVALID_ID', `${name} must be a positive BIGINT decimal string`);
  return v;
}

/** Parses `If-Match: "revision-7"` (weak prefix tolerated). Returns undefined when the header is absent. */
export function ifMatchRevision(req: Request): number | undefined {
  const raw = req.header('if-match');
  if (raw === undefined) return undefined;
  const m = /^(?:W\/)?"?revision-(\d{1,9})"?$/.exec(raw.trim());
  if (!m) throw badRequest('INVALID_IF_MATCH', 'If-Match must look like "revision-<n>"');
  return Number(m[1]);
}

export const etagOf = (revision: number) => `"revision-${revision}"`;

export const ok = (res: Response, data: unknown, status = 200, extra: Record<string, unknown> = {}) => {
  res.status(status).json({ success: true, data, ...extra, requestId: res.locals.requestId });
};
