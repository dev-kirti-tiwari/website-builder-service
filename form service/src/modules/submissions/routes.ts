import { Router } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import { requireActor } from '../../middleware/authentication';
import { requirePermission } from '../../middleware/authorization';
import { withTransaction } from '../../infrastructure/postgres';
import { AppError } from '../../shared/errors';
import { ok } from '../../shared/response';
import { paginationSchema, parse, parseId } from '../../shared/validation/common';
import { recordAudit } from '../audit/repository';
import { requireForm } from '../forms/repository';
import { getSubmission, listSubmissions, updateSubmission } from './repository';

const STATUSES = ['new', 'read', 'spam', 'archived'] as const;

const updateSchema = z
  .object({
    status: z.enum(STATUSES).optional(),
    metadata: z
      .record(z.string().max(64), z.union([z.string().max(500), z.number(), z.boolean(), z.null()]))
      .refine((m) => Object.keys(m).length <= 20, 'at most 20 metadata keys')
      .optional(),
  })
  .strict()
  .refine((v) => v.status !== undefined || v.metadata !== undefined, 'nothing to update');

export function submissionRoutes(pool: Pool): Router {
  const r = Router();

  r.get('/forms/:formId/submissions', requirePermission('submission:read'), async (req, res) => {
    const actor = requireActor(req);
    const formId = parseId(req.params.formId, 'formId');
    const { page, limit } = parse(paginationSchema, req.query);
    const { status } = parse(z.object({ status: z.enum(STATUSES).optional() }), req.query);
    await requireForm(pool, actor, formId);
    const { items, total } = await listSubmissions(pool, actor, formId, { page, limit, status });
    ok(req, res, 'Submissions retrieved', { items, pagination: { page, limit, total } });
  });

  r.get('/forms/:formId/submissions/:submissionId', requirePermission('submission:read'), async (req, res) => {
    const actor = requireActor(req);
    const formId = parseId(req.params.formId, 'formId');
    const id = parseId(req.params.submissionId, 'submissionId');
    await requireForm(pool, actor, formId);
    ok(req, res, 'Submission retrieved', await getSubmission(pool, actor, formId, id));
  });

  r.patch('/forms/:formId/submissions/:submissionId', requirePermission('submission:write'), async (req, res) => {
    const actor = requireActor(req);
    const formId = parseId(req.params.formId, 'formId');
    const id = parseId(req.params.submissionId, 'submissionId');
    const patch = parse(updateSchema, req.body);
    if (patch.metadata && JSON.stringify(patch.metadata).length > 4000) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Request validation failed', [
        { field: 'metadata', message: 'too large' },
      ]);
    }
    const updated = await withTransaction(pool, async (db) => {
      await requireForm(db, actor, formId);
      const s = await updateSubmission(db, actor, actor.userId, formId, id, patch);
      await recordAudit(db, actor, actor, {
        action: 'submission.update', entityType: 'submission', entityId: id, requestId: req.requestId,
        details: { formId, changed: Object.keys(patch) },
      });
      return s;
    });
    ok(req, res, 'Submission updated', updated);
  });

  return r;
}
