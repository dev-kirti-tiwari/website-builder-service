import { Router } from 'express';
import type { Pool } from 'pg';
import { requireActor } from '../../middleware/authentication';
import { requirePermission } from '../../middleware/authorization';
import { withTransaction } from '../../infrastructure/postgres';
import { AppError } from '../../shared/errors';
import { ok } from '../../shared/response';
import { parseId } from '../../shared/validation/common';
import type { PublishedSchema, SchemaField } from '../../shared/validation/submission';
import { recordAudit } from '../audit/repository';
import { listFields } from '../fields/repository';
import { requireForm } from '../forms/repository';

export function publishingRoutes(pool: Pool): Router {
  const r = Router();

  r.post('/forms/:formId/publish', requirePermission('form:publish'), async (req, res) => {
    const actor = requireActor(req);
    const formId = parseId(req.params.formId, 'formId');

    const result = await withTransaction(pool, async (db) => {
      const form = await requireForm(db, actor, formId, true); // row lock serialises concurrent publishes
      const fields = await listFields(db, actor, formId);
      if (fields.length === 0) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Request validation failed', [
          { field: 'fields', message: 'a form needs at least one field before it can be published' },
        ]);
      }
      const schema: PublishedSchema = {
        fields: fields.map(
          (f): SchemaField => ({
            name: f.name,
            label: f.label,
            type: f.type as SchemaField['type'],
            required: f.required,
            options: f.options,
            validation: f.validation,
          }),
        ),
      };
      const next = await db.query(
        'SELECT COALESCE(MAX(version_number), 0) + 1 AS n FROM form_schema_versions WHERE form_id = $1 AND tenant_id = $2 AND organization_id = $3',
        [formId, actor.tenantId, actor.organizationId],
      );
      const versionNumber: number = next.rows[0].n;
      const ins = await db.query(
        `INSERT INTO form_schema_versions (tenant_id, organization_id, form_id, version_number, schema, published_by)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, published_at`,
        [actor.tenantId, actor.organizationId, formId, versionNumber, JSON.stringify(schema), actor.userId],
      );
      await db.query(
        `UPDATE forms SET status = 'published', published_version_id = $1, updated_by = $2, updated_at = NOW(), revision = revision + 1
          WHERE id = $3 AND tenant_id = $4 AND organization_id = $5`,
        [ins.rows[0].id, actor.userId, form.id, actor.tenantId, actor.organizationId],
      );
      await recordAudit(db, actor, actor, {
        action: 'form.publish', entityType: 'form', entityId: formId, requestId: req.requestId,
        details: { versionId: ins.rows[0].id, versionNumber },
      });
      return { formId, versionId: ins.rows[0].id as string, versionNumber, publishedAt: ins.rows[0].published_at as Date };
    });
    ok(req, res, 'Form published', result);
  });

  return r;
}
