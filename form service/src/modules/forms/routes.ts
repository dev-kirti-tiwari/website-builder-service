import { Router } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import { requireActor } from '../../middleware/authentication';
import { requirePermission } from '../../middleware/authorization';
import { isUniqueViolation, withTransaction } from '../../infrastructure/postgres';
import { AppError, notFound } from '../../shared/errors';
import { ok } from '../../shared/response';
import { paginationSchema, parse, parseId } from '../../shared/validation/common';
import { SLUG_RE, slugify } from '../../shared/validation/slug';
import { recordAudit } from '../audit/repository';
import { listFields } from '../fields/repository';
import { insertForm, listForms, requireForm, softDeleteForm, updateForm } from './repository';

const slugSchema = z.string().min(1).max(80).regex(SLUG_RE, 'must be lowercase letters, digits and hyphens');
const description = z.string().max(2000).nullable();

const createSchema = z
  .object({ name: z.string().trim().min(1).max(200), slug: slugSchema.optional(), description: description.optional() })
  .strict();

const updateSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    slug: slugSchema.optional(),
    description: description.optional(),
    revision: z.number().int().min(1).optional(),
  })
  .strict()
  .refine((v) => v.name !== undefined || v.slug !== undefined || v.description !== undefined, 'nothing to update');

const slugConflict = () => new AppError(409, 'SLUG_CONFLICT', 'A form with this slug already exists for the website');

export function formRoutes(pool: Pool): Router {
  const r = Router();

  r.post('/websites/:websiteId/forms', requirePermission('form:write'), async (req, res) => {
    const actor = requireActor(req);
    const websiteId = parseId(req.params.websiteId, 'websiteId');
    const body = parse(createSchema, req.body);
    try {
      const form = await withTransaction(pool, async (db) => {
        const created = await insertForm(db, actor, actor.userId, websiteId, {
          name: body.name,
          slug: body.slug ?? slugify(body.name),
          description: body.description,
        });
        await recordAudit(db, actor, actor, {
          action: 'form.create', entityType: 'form', entityId: created.id, requestId: req.requestId,
        });
        return created;
      });
      ok(req, res, 'Form created', form);
    } catch (err) {
      if (isUniqueViolation(err)) throw slugConflict();
      throw err;
    }
  });

  r.get('/websites/:websiteId/forms', requirePermission('form:read'), async (req, res) => {
    const actor = requireActor(req);
    const websiteId = parseId(req.params.websiteId, 'websiteId');
    const { page, limit } = parse(paginationSchema, req.query);
    const { items, total } = await listForms(pool, actor, websiteId, page, limit);
    ok(req, res, 'Forms retrieved', { items, pagination: { page, limit, total } });
  });

  r.get('/forms/:formId', requirePermission('form:read'), async (req, res) => {
    const actor = requireActor(req);
    const form = await requireForm(pool, actor, parseId(req.params.formId, 'formId'));
    const fields = await listFields(pool, actor, form.id);
    ok(req, res, 'Form retrieved', { ...form, fields });
  });

  r.patch('/forms/:formId', requirePermission('form:write'), async (req, res) => {
    const actor = requireActor(req);
    const formId = parseId(req.params.formId, 'formId');
    const body = parse(updateSchema, req.body);
    try {
      const form = await withTransaction(pool, async (db) => {
        const updated = await updateForm(db, actor, actor.userId, formId, body);
        await recordAudit(db, actor, actor, {
          action: 'form.update', entityType: 'form', entityId: formId, requestId: req.requestId,
          details: { changed: Object.keys(body).filter((k) => k !== 'revision') },
        });
        return updated;
      });
      ok(req, res, 'Form updated', form);
    } catch (err) {
      if (isUniqueViolation(err)) throw slugConflict();
      throw err;
    }
  });

  r.delete('/forms/:formId', requirePermission('form:delete'), async (req, res) => {
    const actor = requireActor(req);
    const formId = parseId(req.params.formId, 'formId');
    await withTransaction(pool, async (db) => {
      if (!(await softDeleteForm(db, actor, actor.userId, formId))) throw notFound('Form');
      await recordAudit(db, actor, actor, {
        action: 'form.delete', entityType: 'form', entityId: formId, requestId: req.requestId,
      });
    });
    ok(req, res, 'Form deleted', { id: formId, deleted: true });
  });

  return r;
}
