import type { Pool, PoolClient } from 'pg';
import { forbidden, notFound } from '../../lib/errors';
import { slugify } from '../../lib/slug';
import { unprocessable } from '../../lib/errors';
import type { RequestContext } from '../../types';
import { isGlobalAdmin } from '../../types';

type Db = Pick<Pool | PoolClient, 'query'>;

export type TemplateRow = {
  id: string;
  scope_type: 'GLOBAL' | 'TENANT';
  tenant_id: string | null;
  organization_id: string | null;
  name: string;
  slug: string;
  description: string | null;
  category_id: string | null;
  category_name: string | null;
  industry: string | null;
  visibility: 'PUBLIC' | 'PRIVATE' | 'UNLISTED';
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  thumbnail_asset_id: string | null;
  draft_version_id: string | null;
  published_version_id: string | null;
  pv_number: number | null;
  revision: number;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
  archived_at: Date | null;
  tags: string[];
  sort_key?: string;
};

export const SELECT_TEMPLATE = `
  SELECT t.id, t.scope_type, t.tenant_id, t.organization_id, t.name, t.slug, t.description, t.category_id,
         c.name AS category_name, t.industry, t.visibility, t.status, t.thumbnail_asset_id, t.draft_version_id,
         t.published_version_id, pv.version_number AS pv_number, t.revision, t.created_by, t.created_at,
         t.updated_at, t.archived_at,
         COALESCE((SELECT array_agg(g.name ORDER BY g.name) FROM template_tag_links l
                   JOIN template_tags g ON g.id = l.tag_id WHERE l.template_id = t.id), '{}') AS tags
  FROM templates t
  LEFT JOIN template_categories c ON c.id = t.category_id
  LEFT JOIN template_versions pv ON pv.id = t.published_version_id`;

/**
 * Read-scope predicate. ID alone is never sufficient: GLOBAL items must be published and not PRIVATE
 * (administrators see all GLOBAL items); TENANT items must match the trusted tenant + organization.
 */
export function readableSql(ctx: RequestContext, tenantParam: number, orgParam: number): string {
  const global = isGlobalAdmin(ctx)
    ? `t.scope_type = 'GLOBAL'`
    : `(t.scope_type = 'GLOBAL' AND t.visibility IN ('PUBLIC','UNLISTED') AND t.published_version_id IS NOT NULL)`;
  return `(t.archived_at IS NULL AND (${global} OR (t.scope_type = 'TENANT' AND t.tenant_id = $${tenantParam} AND t.organization_id = $${orgParam})))`;
}

export function mapTemplate(r: TemplateRow) {
  return {
    id: r.id,
    scope: r.scope_type,
    tenantId: r.tenant_id,
    organizationId: r.organization_id,
    name: r.name,
    slug: r.slug,
    description: r.description,
    category: r.category_id ? { id: r.category_id, name: r.category_name } : null,
    industry: r.industry,
    thumbnailAssetId: r.thumbnail_asset_id,
    publishedVersion: r.published_version_id ? { id: r.published_version_id, versionNumber: r.pv_number } : null,
    draftVersionId: r.draft_version_id,
    tags: r.tags,
    visibility: r.visibility,
    status: r.status,
    revision: r.revision,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

export async function findReadable(db: Db, ctx: RequestContext, id: string): Promise<TemplateRow | null> {
  const r = await db.query<TemplateRow>(`${SELECT_TEMPLATE} WHERE t.id = $1 AND ${readableSql(ctx, 2, 3)}`, [
    id,
    ctx.tenantId,
    ctx.organizationId,
  ]);
  return r.rows[0] ?? null;
}

/** Row-locks a template the caller may modify: 404 if not visible, 403 if visible but not writable. */
export async function lockWritable(client: PoolClient, ctx: RequestContext, id: string): Promise<TemplateRow> {
  const r = await client.query<TemplateRow>(
    `${SELECT_TEMPLATE} WHERE t.id = $1 AND ${readableSql(ctx, 2, 3)} FOR UPDATE OF t`,
    [id, ctx.tenantId, ctx.organizationId],
  );
  const row = r.rows[0];
  if (!row) throw notFound();
  if (row.scope_type === 'GLOBAL' && !isGlobalAdmin(ctx)) throw forbidden('Global catalog templates require template:global:admin');
  return row;
}

export async function assertCategory(db: Db, categoryId: string): Promise<void> {
  const r = await db.query('SELECT 1 FROM template_categories WHERE id = $1 AND is_active', [categoryId]);
  if (r.rowCount === 0) throw unprocessable('INVALID_CATEGORY', 'categoryId does not reference an active category');
}

/** Replace the template's tag set; tags are created on demand, deduplicated by slug. */
export async function syncTags(client: PoolClient, templateId: string, names: string[]): Promise<void> {
  const bySlug = new Map<string, string>();
  for (const n of names) {
    const slug = slugify(n);
    if (!slug) throw unprocessable('INVALID_TAG', `Tag "${n}" has no usable characters`);
    bySlug.set(slug, n.trim());
  }
  await client.query('DELETE FROM template_tag_links WHERE template_id = $1', [templateId]);
  for (const [slug, name] of bySlug) {
    const t = await client.query<{ id: string }>(
      `INSERT INTO template_tags (name, slug) VALUES ($1, $2)
       ON CONFLICT (slug) DO UPDATE SET slug = EXCLUDED.slug RETURNING id`,
      [name, slug],
    );
    await client.query('INSERT INTO template_tag_links (template_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [
      templateId,
      t.rows[0].id,
    ]);
  }
}
