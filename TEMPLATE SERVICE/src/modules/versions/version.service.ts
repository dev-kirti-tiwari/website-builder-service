import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { audit } from '../../lib/audit';
import { withTx } from '../../database/tx';
import { checksumOf } from '../../lib/hash';
import { conflict, notFound } from '../../lib/errors';
import type { Integrations } from '../../integrations/clients';
import type { RequestContext } from '../../types';
import { isGlobalAdmin } from '../../types';
import { findReadable, lockWritable } from '../templates/template.repository';
import { SCHEMA_VERSION, collectAssetRefs, validateSnapshot } from './snapshot';

export const createVersionSchema = z
  .object({
    snapshot: z.unknown(),
    changelog: z.string().max(5000).nullish(),
  })
  .strict();
export type CreateVersionInput = z.infer<typeof createVersionSchema>;

export type VersionRow = {
  id: string;
  template_id: string;
  version_number: number;
  state: string;
  schema_version: number;
  snapshot: unknown;
  checksum: string;
  changelog: string | null;
  created_by: string | null;
  reviewed_by: string | null;
  published_by: string | null;
  created_at: Date;
  reviewed_at: Date | null;
  published_at: Date | null;
};

const COLS = `v.id, v.template_id, v.version_number, v.state, v.schema_version, v.checksum, v.changelog, v.created_by,
              v.reviewed_by, v.published_by, v.created_at, v.reviewed_at, v.published_at`;

export function mapVersion(r: VersionRow, withSnapshot: boolean) {
  return {
    id: r.id,
    templateId: r.template_id,
    versionNumber: r.version_number,
    state: r.state,
    schemaVersion: r.schema_version,
    checksum: r.checksum,
    changelog: r.changelog,
    createdBy: r.created_by,
    reviewedBy: r.reviewed_by,
    publishedBy: r.published_by,
    createdAt: r.created_at.toISOString(),
    reviewedAt: r.reviewed_at?.toISOString() ?? null,
    publishedAt: r.published_at?.toISOString() ?? null,
    ...(withSnapshot ? { snapshot: r.snapshot } : {}),
  };
}

const ALLOWED: Record<string, string[]> = {
  submit: ['DRAFT'],
  approve: ['IN_REVIEW'],
  publish: ['APPROVED'],
  deprecate: ['PUBLISHED', 'APPROVED'],
};

export class VersionService {
  constructor(
    private readonly pool: Pool,
    private readonly integrations: Integrations,
  ) {}

  /** Versions of a GLOBAL template are visible to non-admins only once PUBLISHED; tenant owners see every version. */
  private async visibleStates(ctx: RequestContext, templateId: string) {
    const t = await findReadable(this.pool, ctx, templateId);
    if (!t) throw notFound();
    const restrict = t.scope_type === 'GLOBAL' && !isGlobalAdmin(ctx);
    return restrict ? `AND v.state = 'PUBLISHED'` : '';
  }

  async list(ctx: RequestContext, templateId: string) {
    const extra = await this.visibleStates(ctx, templateId);
    const r = await this.pool.query<VersionRow>(
      `SELECT ${COLS} FROM template_versions v WHERE v.template_id = $1 ${extra} ORDER BY v.version_number DESC`,
      [templateId],
    );
    return r.rows.map((v) => mapVersion(v, false));
  }

  async get(ctx: RequestContext, templateId: string, versionId: string) {
    const extra = await this.visibleStates(ctx, templateId);
    const r = await this.pool.query<VersionRow>(
      `SELECT ${COLS}, v.snapshot FROM template_versions v WHERE v.template_id = $1 AND v.id = $2 ${extra}`,
      [templateId, versionId],
    );
    if (!r.rows[0]) throw notFound('TEMPLATE_VERSION_NOT_FOUND', 'Template version not found');
    return mapVersion(r.rows[0], true);
  }

  async create(ctx: RequestContext, templateId: string, input: CreateVersionInput) {
    const snapshot = validateSnapshot(input.snapshot);
    const assets = collectAssetRefs(snapshot);
    if (assets.length) await this.integrations.media.assertAssetsAccessible(ctx, assets);
    const checksum = checksumOf(snapshot);

    return withTx(this.pool, async (client) => {
      await lockWritable(client, ctx, templateId); // serialises version numbering per template
      const next = await client.query<{ n: number }>(
        'SELECT COALESCE(MAX(version_number), 0) + 1 AS n FROM template_versions WHERE template_id = $1',
        [templateId],
      );
      const ins = await client.query<VersionRow>(
        `INSERT INTO template_versions (template_id, version_number, schema_version, snapshot, checksum, changelog, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, template_id, version_number, state, schema_version, snapshot, checksum, changelog, created_by,
                   reviewed_by, published_by, created_at, reviewed_at, published_at`,
        [templateId, next.rows[0].n, SCHEMA_VERSION, JSON.stringify(snapshot), checksum, input.changelog ?? null, ctx.userId],
      );
      await client.query('UPDATE templates SET draft_version_id = $2, updated_at = NOW(), updated_by = $3 WHERE id = $1', [
        templateId,
        ins.rows[0].id,
        ctx.userId,
      ]);
      await audit(client, ctx, 'template.version.create', 'template_version', ins.rows[0].id, {
        templateId,
        versionNumber: ins.rows[0].version_number,
        checksum,
      });
      return mapVersion(ins.rows[0], true);
    });
  }

  async transition(ctx: RequestContext, templateId: string, versionId: string, action: keyof typeof ALLOWED) {
    // Publishing re-checks assets against Media outside the DB transaction (network call).
    if (action === 'publish') {
      const r = await this.pool.query<{ snapshot: unknown }>('SELECT snapshot FROM template_versions WHERE id = $1 AND template_id = $2', [versionId, templateId]);
      if (r.rows[0]) {
        const assets = collectAssetRefs(validateSnapshot(r.rows[0].snapshot));
        if (assets.length) await this.integrations.media.assertAssetsAccessible(ctx, assets);
      }
    }
    return withTx(this.pool, async (client) => {
      const tpl = await lockWritable(client, ctx, templateId);
      const cur = await client.query<VersionRow>(
        `SELECT ${COLS}, v.snapshot FROM template_versions v WHERE v.id = $1 AND v.template_id = $2 FOR UPDATE`,
        [versionId, templateId],
      );
      const v = cur.rows[0];
      if (!v) throw notFound('TEMPLATE_VERSION_NOT_FOUND', 'Template version not found');
      if (!ALLOWED[action].includes(v.state)) {
        throw conflict('INVALID_STATE_TRANSITION', `Cannot ${action} a version in state ${v.state}`);
      }
      const out = await this.apply(client, ctx, tpl.id, tpl.published_version_id, v, action);
      await audit(client, ctx, `template.version.${action}`, 'template_version', versionId, { templateId, from: v.state, to: out.state });
      return mapVersion(out, false);
    });
  }

  private async apply(
    client: PoolClient,
    ctx: RequestContext,
    templateId: string,
    publishedVersionId: string | null,
    v: VersionRow,
    action: string,
  ): Promise<VersionRow> {
    const cols = `id, template_id, version_number, state, schema_version, snapshot, checksum, changelog, created_by,
                  reviewed_by, published_by, created_at, reviewed_at, published_at`;
    if (action === 'submit') {
      return (await client.query<VersionRow>(`UPDATE template_versions SET state = 'IN_REVIEW' WHERE id = $1 RETURNING ${cols}`, [v.id])).rows[0];
    }
    if (action === 'approve') {
      return (
        await client.query<VersionRow>(
          `UPDATE template_versions SET state = 'APPROVED', reviewed_by = $2, reviewed_at = NOW() WHERE id = $1 RETURNING ${cols}`,
          [v.id, ctx.userId],
        )
      ).rows[0];
    }
    if (action === 'publish') {
      // Only one PUBLISHED version per template: the previous one is deprecated, never edited.
      await client.query(`UPDATE template_versions SET state = 'DEPRECATED' WHERE template_id = $1 AND state = 'PUBLISHED'`, [templateId]);
      const row = (
        await client.query<VersionRow>(
          `UPDATE template_versions SET state = 'PUBLISHED', published_by = $2, published_at = NOW() WHERE id = $1 RETURNING ${cols}`,
          [v.id, ctx.userId],
        )
      ).rows[0];
      await client.query(
        `UPDATE templates SET published_version_id = $2, status = 'ACTIVE', draft_version_id = NULLIF(draft_version_id, $2),
                updated_at = NOW(), updated_by = $3, revision = revision + 1 WHERE id = $1`,
        [templateId, v.id, ctx.userId],
      );
      return row;
    }
    // deprecate
    const row = (await client.query<VersionRow>(`UPDATE template_versions SET state = 'DEPRECATED' WHERE id = $1 RETURNING ${cols}`, [v.id])).rows[0];
    if (publishedVersionId === v.id) {
      await client.query(`UPDATE templates SET published_version_id = NULL, updated_at = NOW(), updated_by = $2, revision = revision + 1 WHERE id = $1`, [
        templateId,
        ctx.userId,
      ]);
    }
    return row;
  }
}
