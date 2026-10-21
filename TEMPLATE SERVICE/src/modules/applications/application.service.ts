import type { Pool } from 'pg';
import { z } from 'zod';
import { audit } from '../../lib/audit';
import { withTx } from '../../database/tx';
import { AppError, badRequest, conflict, notFound, unprocessable } from '../../lib/errors';
import { canonicalJson, sha256Hex } from '../../lib/hash';
import type { Logger } from '../../lib/logger';
import type { Integrations } from '../../integrations/clients';
import type { RequestContext } from '../../types';
import { findReadable } from '../templates/template.repository';
import { bigintId } from '../templates/template.schemas';
import { collectAssetRefs, validateSnapshot } from '../versions/snapshot';

export const applyTemplateSchema = z
  .object({
    websiteId: bigintId,
    websiteName: z.string().trim().min(1).max(160).optional(),
    includeDemoContent: z.boolean().default(false),
    options: z.object({ locale: z.string().trim().min(2).max(20).optional() }).strict().default({}),
  })
  .strict();
export type ApplyTemplateInput = z.infer<typeof applyTemplateSchema>;

type ApplicationRow = {
  id: string;
  idempotency_key: string;
  request_fingerprint: string;
  tenant_id: string;
  organization_id: string;
  website_id: string;
  template_id: string;
  template_version_id: string;
  request: ApplyTemplateInput;
  status: 'PENDING' | 'VALIDATING' | 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED';
  attempts: number;
  target_document_id: string | null;
  result: unknown;
  error_code: string | null;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
};

const MAX_ATTEMPTS = 5;
const STALE_SECONDS = 60;
const KEY_PATTERN = /^[A-Za-z0-9._:-]{8,200}$/;

export function mapApplication(a: ApplicationRow) {
  return {
    applicationId: a.id,
    status: a.status,
    statusUrl: `/api/v1/template-applications/${a.id}`,
    templateId: a.template_id,
    templateVersionId: a.template_version_id,
    websiteId: a.website_id,
    targetDocumentId: a.target_document_id,
    result: a.result,
    errorCode: a.error_code,
    createdAt: a.created_at.toISOString(),
    updatedAt: a.updated_at.toISOString(),
  };
}

export class ApplicationService {
  constructor(
    private readonly pool: Pool,
    private readonly integrations: Integrations,
    private readonly logger: Logger,
  ) {}

  private async byKey(ctx: RequestContext, key: string): Promise<ApplicationRow | undefined> {
    const r = await this.pool.query<ApplicationRow>(
      'SELECT * FROM template_applications WHERE tenant_id = $1 AND organization_id = $2 AND idempotency_key = $3',
      [ctx.tenantId, ctx.organizationId, key],
    );
    return r.rows[0];
  }

  private replayOrConflict(existing: ApplicationRow, fingerprint: string) {
    if (existing.request_fingerprint !== fingerprint) {
      throw conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key was already used with a different request');
    }
    return existing;
  }

  /** Accepts an apply request. Returns the application and whether a background run should be started. */
  async accept(ctx: RequestContext, templateId: string, input: ApplyTemplateInput, idempotencyKey: string | undefined) {
    if (!idempotencyKey || !KEY_PATTERN.test(idempotencyKey)) {
      throw badRequest('INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key header is required (8-200 chars: letters, digits, . _ : -)');
    }
    const fingerprint = sha256Hex(canonicalJson({ templateId, ...input }));

    // A replay returns the original operation even if the template has since changed.
    const prior = await this.byKey(ctx, idempotencyKey);
    if (prior) return { application: this.replayOrConflict(prior, fingerprint), isNew: false };

    const tpl = await findReadable(this.pool, ctx, templateId);
    if (!tpl) throw notFound();
    const unavailable = () => unprocessable('TEMPLATE_VERSION_NOT_PUBLISHED', 'The selected template version is not available.');
    if (!tpl.published_version_id) throw unavailable();
    const ver = await this.pool.query<{ id: string; snapshot: unknown }>(
      `SELECT id, snapshot FROM template_versions WHERE id = $1 AND template_id = $2 AND state = 'PUBLISHED'`,
      [tpl.published_version_id, templateId],
    );
    if (!ver.rows[0]) throw unavailable();

    const assets = collectAssetRefs(validateSnapshot(ver.rows[0].snapshot));
    await this.integrations.website.assertWebsiteInScope(ctx, input.websiteId); // fails closed
    if (assets.length) await this.integrations.media.assertAssetsAccessible(ctx, assets);

    const created = await withTx(this.pool, async (client) => {
      const ins = await client.query<ApplicationRow>(
        `INSERT INTO template_applications (idempotency_key, request_fingerprint, tenant_id, organization_id, website_id,
                                            template_id, template_version_id, request, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (tenant_id, organization_id, idempotency_key) DO NOTHING RETURNING *`,
        [idempotencyKey, fingerprint, ctx.tenantId, ctx.organizationId, input.websiteId, templateId, ver.rows[0].id, JSON.stringify(input), ctx.userId],
      );
      if (ins.rows[0]) await audit(client, ctx, 'template.apply.accepted', 'template_application', ins.rows[0].id, { templateId, websiteId: input.websiteId });
      return ins.rows[0];
    });
    if (created) return { application: created, isNew: true };

    // Lost a race with a concurrent request using the same key.
    const winner = (await this.byKey(ctx, idempotencyKey)) as ApplicationRow;
    return { application: this.replayOrConflict(winner, fingerprint), isNew: false };
  }

  async getStatus(ctx: RequestContext, applicationId: string) {
    const r = await this.pool.query<ApplicationRow>(
      'SELECT * FROM template_applications WHERE id = $1 AND tenant_id = $2 AND organization_id = $3',
      [applicationId, ctx.tenantId, ctx.organizationId],
    );
    if (!r.rows[0]) throw notFound('TEMPLATE_APPLICATION_NOT_FOUND', 'Template application not found');
    return mapApplication(r.rows[0]);
  }

  /**
   * Runs (or resumes) one application. Safe to call repeatedly: only a PENDING or stale in-flight row is claimed,
   * and the downstream call always carries the same operationId so a retry after an ambiguous timeout is reconciled
   * by the Document service instead of creating duplicate pages. Never publishes.
   */
  async process(applicationId: string): Promise<void> {
    const claimed = await this.pool.query<ApplicationRow>(
      `UPDATE template_applications SET status = 'IN_PROGRESS', attempts = attempts + 1, updated_at = NOW()
       WHERE id = $1 AND (status = 'PENDING' OR (status IN ('VALIDATING','IN_PROGRESS') AND updated_at < NOW() - make_interval(secs => $2)))
       RETURNING *`,
      [applicationId, STALE_SECONDS],
    );
    const app = claimed.rows[0];
    if (!app) return;

    const ctx: RequestContext = {
      tenantId: app.tenant_id,
      organizationId: app.organization_id,
      userId: app.created_by ?? '0',
      requestId: `req_application_${app.id}`,
      permissions: [],
    };
    try {
      const v = await this.pool.query<{ snapshot: unknown; checksum: string; version_number: number }>(
        'SELECT snapshot, checksum, version_number FROM template_versions WHERE id = $1',
        [app.template_version_id],
      );
      const out = await this.integrations.documents.createDraftFromTemplate(ctx, {
        operationId: app.id,
        websiteId: app.website_id,
        websiteName: app.request.websiteName,
        templateId: app.template_id,
        templateVersionId: app.template_version_id,
        checksum: v.rows[0].checksum,
        snapshot: v.rows[0].snapshot,
        includeDemoContent: app.request.includeDemoContent,
        locale: app.request.options?.locale,
      });
      const result = { documentId: out.documentId, templateVersionId: app.template_version_id, versionNumber: v.rows[0].version_number, published: false };
      await this.pool.query(
        `UPDATE template_applications SET status = 'SUCCEEDED', target_document_id = $2, result = $3, error_code = NULL, updated_at = NOW() WHERE id = $1`,
        [app.id, out.documentId, JSON.stringify(result)],
      );
      await audit(this.pool, ctx, 'template.apply.succeeded', 'template_application', app.id, { documentId: out.documentId });
    } catch (e) {
      const permanent = e instanceof AppError && e.status < 500;
      const exhausted = app.attempts >= MAX_ATTEMPTS; // attempts already includes this try
      const code = e instanceof AppError ? e.code : 'DOWNSTREAM_ERROR';
      this.logger.warn('template_apply_failed', { applicationId: app.id, code, permanent, exhausted });
      await this.pool.query(
        `UPDATE template_applications SET status = $2, error_code = $3, updated_at = NOW() WHERE id = $1`,
        [app.id, permanent || exhausted ? 'FAILED' : 'PENDING', code],
      );
    }
  }

  /** Re-drives applications that were left PENDING or in flight (crash, timeout, downstream outage). */
  async reconcile(): Promise<number> {
    const r = await this.pool.query<{ id: string }>(
      `SELECT id FROM template_applications
       WHERE (status = 'PENDING' AND updated_at < NOW() - INTERVAL '5 seconds')
          OR (status IN ('VALIDATING','IN_PROGRESS') AND updated_at < NOW() - make_interval(secs => $1))
       ORDER BY updated_at LIMIT 50`,
      [STALE_SECONDS],
    );
    for (const row of r.rows) await this.process(row.id);
    return r.rows.length;
  }
}
