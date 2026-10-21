import { Router } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import { requireActor } from '../../middleware/authentication';
import { requirePermission } from '../../middleware/authorization';
import { withTransaction } from '../../infrastructure/postgres';
import { AppError } from '../../shared/errors';
import { ok } from '../../shared/response';
import { parse, parseId } from '../../shared/validation/common';
import { recordAudit } from '../audit/repository';
import { listFields } from '../fields/repository';
import { requireForm } from '../forms/repository';

const templateKey = z.string().regex(/^[a-z0-9_.-]{1,64}$/i, 'must be a template key, not a URL');
const fieldName = z.string().regex(/^[a-z][a-z0-9_]{0,62}$/);

/**
 * Only allow-listed action types with fixed, strict configs. There is deliberately no URL,
 * endpoint, header or code property: destinations are resolved by the owning service from keys.
 */
const createSchema = z.discriminatedUnion('actionType', [
  z.object({
    actionType: z.literal('crm_lead'),
    enabled: z.boolean().default(true),
    config: z
      .object({
        fieldMapping: z
          .record(fieldName, fieldName)
          .refine((m) => Object.keys(m).length >= 1 && Object.keys(m).length <= 30, '1-30 mappings'),
      })
      .strict(),
  }).strict(),
  z.object({
    actionType: z.literal('email'),
    enabled: z.boolean().default(true),
    config: z.object({ templateKey, recipientField: fieldName }).strict(),
  }).strict(),
  z.object({
    actionType: z.literal('whatsapp'),
    enabled: z.boolean().default(true),
    config: z.object({ templateKey, recipientField: fieldName }).strict(),
  }).strict(),
  z.object({
    actionType: z.literal('notification'),
    enabled: z.boolean().default(true),
    config: z.object({ templateKey }).strict(),
  }).strict(),
]);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toAutomation = (r: any) => ({
  id: r.id,
  formId: r.form_id,
  actionType: r.action_type,
  config: r.config,
  enabled: r.enabled,
  createdBy: r.created_by,
  createdAt: r.created_at,
});

export function automationRoutes(pool: Pool): Router {
  const r = Router();

  r.get('/forms/:formId/automations', requirePermission('automation:read'), async (req, res) => {
    const actor = requireActor(req);
    const formId = parseId(req.params.formId, 'formId');
    await requireForm(pool, actor, formId);
    const { rows } = await pool.query(
      `SELECT id, form_id, action_type, config, enabled, created_by, created_at FROM form_automations
        WHERE form_id = $1 AND tenant_id = $2 AND organization_id = $3 ORDER BY id`,
      [formId, actor.tenantId, actor.organizationId],
    );
    ok(req, res, 'Automations retrieved', rows.map(toAutomation));
  });

  r.post('/forms/:formId/automations', requirePermission('automation:write'), async (req, res) => {
    const actor = requireActor(req);
    const formId = parseId(req.params.formId, 'formId');
    const body = parse(createSchema, req.body);

    const created = await withTransaction(pool, async (db) => {
      await requireForm(db, actor, formId, true);
      const fields = new Map((await listFields(db, actor, formId)).map((f) => [f.name, f.type]));

      // Every referenced form field must exist; recipients must be the right kind of field.
      const issues: Array<{ field: string; message: string }> = [];
      const cfg = body.config as Record<string, unknown>;
      const refs =
        body.actionType === 'crm_lead'
          ? Object.values(cfg.fieldMapping as Record<string, string>)
          : body.actionType === 'notification'
            ? []
            : [cfg.recipientField as string];
      for (const ref of refs) if (!fields.has(ref)) issues.push({ field: 'config', message: `unknown form field "${ref}"` });
      if (body.actionType === 'email' && fields.get(cfg.recipientField as string) !== undefined && fields.get(cfg.recipientField as string) !== 'email') {
        issues.push({ field: 'config.recipientField', message: 'must reference an email field' });
      }
      if (body.actionType === 'whatsapp' && fields.get(cfg.recipientField as string) !== undefined && fields.get(cfg.recipientField as string) !== 'phone') {
        issues.push({ field: 'config.recipientField', message: 'must reference a phone field' });
      }
      if (issues.length) throw new AppError(400, 'VALIDATION_ERROR', 'Request validation failed', issues);

      const ins = await db.query(
        `INSERT INTO form_automations (tenant_id, organization_id, form_id, action_type, config, enabled, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, form_id, action_type, config, enabled, created_by, created_at`,
        [actor.tenantId, actor.organizationId, formId, body.actionType, JSON.stringify(body.config), body.enabled, actor.userId],
      );
      await recordAudit(db, actor, actor, {
        action: 'automation.create', entityType: 'automation', entityId: ins.rows[0].id, requestId: req.requestId,
        details: { formId, actionType: body.actionType },
      });
      return toAutomation(ins.rows[0]);
    });
    ok(req, res, 'Automation created', created);
  });

  return r;
}
