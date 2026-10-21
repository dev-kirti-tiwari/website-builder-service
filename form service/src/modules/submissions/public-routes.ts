import { createHash } from 'node:crypto';
import { Router, type Request } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { Pool } from 'pg';
import { z } from 'zod';
import type { Config } from '../../config';
import { isUniqueViolation, withTransaction } from '../../infrastructure/postgres';
import { enqueueOutbox } from '../../infrastructure/outbox/repository';
import { routeNotFound } from '../../middleware/error-handler';
import { AppError, notFound } from '../../shared/errors';
import { ok } from '../../shared/response';
import { parse, parseId } from '../../shared/validation/common';
import { validateSubmission, type PublishedSchema } from '../../shared/validation/submission';
import { recordAudit } from '../audit/repository';

const bodySchema = z
  .object({
    data: z.record(z.string().max(64), z.unknown()),
    honeypot: z.string().max(200).optional(),
  })
  .strict();

const IDEM_RE = /^[A-Za-z0-9_-]{8,128}$/;
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

function visitorMeta(req: Request) {
  return {
    ipHash: sha256(req.ip ?? 'unknown').slice(0, 32),
    userAgent: (req.header('user-agent') ?? '').slice(0, 200),
  };
}

/**
 * Public runtime routes. No user JWT. Tenant/organization/schema/destinations are always taken
 * from the stored published form, never from the request.
 */
export function publicRoutes(pool: Pool, config: Config): Router {
  const r = Router();

  const limiter = rateLimit({
    windowMs: config.PUBLIC_RATE_LIMIT_WINDOW_MS,
    limit: config.PUBLIC_RATE_LIMIT_MAX,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (req, res) => {
      res.status(429).json({
        success: false,
        error: { code: 'RATE_LIMITED', message: 'Too many requests, please try again later', details: [] },
        meta: { requestId: req.requestId },
      });
    },
  });

  r.post('/forms/:formId/submissions', limiter, async (req, res) => {
    const formId = parseId(req.params.formId, 'formId');
    const body = parse(bodySchema, req.body);
    if (body.honeypot) throw new AppError(400, 'SPAM_DETECTED', 'Submission rejected');

    const idemKey = req.header('idempotency-key');
    if (idemKey !== undefined && !IDEM_RE.test(idemKey)) {
      throw new AppError(400, 'INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key must be 8-128 chars of [A-Za-z0-9_-]');
    }

    const found = await pool.query(
      `SELECT f.id, f.tenant_id, f.organization_id, v.id AS version_id, v.schema
         FROM forms f JOIN form_schema_versions v ON v.id = f.published_version_id
        WHERE f.id = $1 AND f.status = 'published' AND f.deleted_at IS NULL`,
      [formId],
    );
    if (!found.rows[0]) throw notFound('Form');
    const form = found.rows[0];
    const scope = { tenantId: form.tenant_id as string, organizationId: form.organization_id as string };

    const issues = validateSubmission(form.schema as PublishedSchema, body.data);
    if (issues.length) throw new AppError(400, 'VALIDATION_ERROR', 'Submission validation failed', issues);

    const requestHash = sha256(JSON.stringify(body.data));
    const replay = async () => {
      const prev = await pool.query(
        `SELECT k.request_hash, s.id, s.created_at
           FROM idempotency_keys k JOIN form_submissions s ON s.id = k.submission_id
          WHERE k.tenant_id = $1 AND k.organization_id = $2 AND k.form_id = $3 AND k.idem_key = $4`,
        [scope.tenantId, scope.organizationId, formId, idemKey],
      );
      if (!prev.rows[0]) return null;
      if (prev.rows[0].request_hash !== requestHash) {
        throw new AppError(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency-Key was already used with a different payload');
      }
      return { submissionId: prev.rows[0].id as string, receivedAt: prev.rows[0].created_at as Date };
    };

    if (idemKey) {
      const prev = await replay();
      if (prev) return ok(req, res, 'Submission received', prev);
    }

    try {
      const result = await withTransaction(pool, async (db) => {
        const ins = await db.query(
          `INSERT INTO form_submissions
             (tenant_id, organization_id, form_id, schema_version_id, data, actor_type, user_id, request_id, visitor_meta)
           VALUES ($1, $2, $3, $4, $5, 'ANONYMOUS_VISITOR', NULL, $6, $7)
           RETURNING id, created_at`,
          [scope.tenantId, scope.organizationId, formId, form.version_id, JSON.stringify(body.data), req.requestId, JSON.stringify(visitorMeta(req))],
        );
        const submissionId: string = ins.rows[0].id;
        if (idemKey) {
          await db.query(
            `INSERT INTO idempotency_keys (tenant_id, organization_id, form_id, idem_key, request_hash, submission_id)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [scope.tenantId, scope.organizationId, formId, idemKey, requestHash, submissionId],
          );
        }
        await recordAudit(db, scope, null, {
          action: 'submission.create', entityType: 'submission', entityId: submissionId, requestId: req.requestId,
          details: { formId },
        });
        // Same transaction as the submission: a committed submission always has its event.
        await enqueueOutbox(db, scope, 'form.submission.created', {
          submissionId, formId, schemaVersionId: form.version_id,
        }, req.requestId);
        return { submissionId, receivedAt: ins.rows[0].created_at as Date };
      });
      ok(req, res, 'Submission received', result);
    } catch (err) {
      if (idemKey && isUniqueViolation(err)) {
        const prev = await replay(); // concurrent request with the same key won the race
        if (prev) return ok(req, res, 'Submission received', prev);
      }
      throw err;
    }
  });

  r.use(routeNotFound);
  return r;
}
