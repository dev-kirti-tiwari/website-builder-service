import { Router } from 'express';
import type { Pool } from 'pg';
import { requireActor } from '../../middleware/authentication';
import { requirePermission } from '../../middleware/authorization';
import { isUniqueViolation, withTransaction } from '../../infrastructure/postgres';
import { AppError } from '../../shared/errors';
import { ok } from '../../shared/response';
import { parse, parseId } from '../../shared/validation/common';
import { recordAudit } from '../audit/repository';
import { requireForm } from '../forms/repository';
import { findField, insertField, updateField } from './repository';
import { checkFieldRules, fieldCreateSchema, fieldUpdateSchema } from './schemas';

const invalid = (field: string, message: string) =>
  new AppError(400, 'VALIDATION_ERROR', 'Request validation failed', [{ field, message }]);

export function fieldRoutes(pool: Pool): Router {
  const r = Router();

  r.post('/forms/:formId/fields', requirePermission('form:write'), async (req, res) => {
    const actor = requireActor(req);
    const formId = parseId(req.params.formId, 'formId');
    const body = parse(fieldCreateSchema, req.body);
    const rule = checkFieldRules(body);
    if (rule) throw invalid('field', rule);
    try {
      const field = await withTransaction(pool, async (db) => {
        await requireForm(db, actor, formId, true);
        const created = await insertField(db, actor, actor.userId, formId, body);
        await recordAudit(db, actor, actor, {
          action: 'field.create', entityType: 'field', entityId: created.id, requestId: req.requestId,
          details: { formId },
        });
        return created;
      });
      ok(req, res, 'Field created', field);
    } catch (err) {
      if (isUniqueViolation(err)) throw new AppError(409, 'FIELD_CONFLICT', 'A field with this name already exists');
      throw err;
    }
  });

  r.patch('/forms/:formId/fields/:fieldId', requirePermission('form:write'), async (req, res) => {
    const actor = requireActor(req);
    const formId = parseId(req.params.formId, 'formId');
    const fieldId = parseId(req.params.fieldId, 'fieldId');
    const patch = parse(fieldUpdateSchema, req.body);
    const field = await withTransaction(pool, async (db) => {
      await requireForm(db, actor, formId, true);
      const current = await findField(db, actor, formId, fieldId);
      const merged = {
        label: patch.label ?? current.label,
        type: patch.type ?? current.type,
        required: patch.required ?? current.required,
        options: patch.options === undefined ? current.options : patch.options,
        validation: patch.validation === undefined ? current.validation : patch.validation,
        position: patch.position ?? current.position,
      };
      const rule = checkFieldRules(merged);
      if (rule) throw invalid('field', rule);
      const updated = await updateField(db, actor, actor.userId, formId, fieldId, merged);
      await recordAudit(db, actor, actor, {
        action: 'field.update', entityType: 'field', entityId: fieldId, requestId: req.requestId,
        details: { formId, changed: Object.keys(patch) },
      });
      return updated;
    });
    ok(req, res, 'Field updated', field);
  });

  return r;
}
