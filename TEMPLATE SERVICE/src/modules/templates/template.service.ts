import type { Pool } from 'pg';
import { audit } from '../../lib/audit';
import { isUniqueViolation, withTx } from '../../database/tx';
import { badRequest, conflict, forbidden, notFound, preconditionFailed } from '../../lib/errors';
import { isBigIntId } from '../../lib/bigint';
import { slugify } from '../../lib/slug';
import type { Integrations } from '../../integrations/clients';
import type { RequestContext } from '../../types';
import { isGlobalAdmin } from '../../types';
import {
  SELECT_TEMPLATE,
  type TemplateRow,
  assertCategory,
  findReadable,
  lockWritable,
  mapTemplate,
  readableSql,
  syncTags,
} from './template.repository';
import type { CreateTemplateInput, ListTemplatesQuery, UpdateTemplateInput } from './template.schemas';

const SORT_SQL = {
  createdAt: { col: 't.created_at', key: `to_char(t.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`, cast: 'timestamptz' },
  updatedAt: { col: 't.updated_at', key: `to_char(t.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`, cast: 'timestamptz' },
  name: { col: 't.name', key: 't.name', cast: 'text' },
} as const;

type Cursor = { sort: string; order: string; v: string; id: string };

function decodeCursor(raw: string, q: ListTemplatesQuery): Cursor {
  try {
    const c = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Cursor;
    const validKey = q.sort === 'name' ? typeof c.v === 'string' && !c.v.includes('\u0000') : /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/.test(c.v);
    if (c.sort !== q.sort || c.order !== q.order || !validKey || !isBigIntId(c.id)) throw new Error('mismatch');
    return c;
  } catch {
    throw badRequest('INVALID_CURSOR', 'cursor is invalid or does not match the requested sort/order');
  }
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

export class TemplateService {
  constructor(
    private readonly pool: Pool,
    private readonly integrations: Integrations,
  ) {}

  async list(ctx: RequestContext, q: ListTemplatesQuery) {
    const params: unknown[] = [ctx.tenantId, ctx.organizationId];
    // Browse shows the published catalog only; UNLISTED global items are reachable by direct link, not listed.
    const where: string[] = [
      readableSql({ ...ctx, permissions: [] }, 1, 2),
      't.published_version_id IS NOT NULL',
      `(t.visibility <> 'UNLISTED' OR t.scope_type = 'TENANT')`,
    ];
    const add = (v: unknown) => {
      params.push(v);
      return `$${params.length}`;
    };
    if (q.q) {
      const p = add(`%${escapeLike(q.q)}%`);
      where.push(`(t.name ILIKE ${p} OR t.description ILIKE ${p})`);
    }
    if (q.categoryId) where.push(`t.category_id = ${add(q.categoryId)}`);
    if (q.industry) where.push(`t.industry ILIKE ${add(escapeLike(q.industry))}`);
    if (q.visibility) where.push(`t.visibility = ${add(q.visibility)}`);
    if (q.tag) {
      where.push(
        `EXISTS (SELECT 1 FROM template_tag_links l JOIN template_tags g ON g.id = l.tag_id
                 WHERE l.template_id = t.id AND g.slug = ${add(slugify(q.tag))})`,
      );
    }
    const s = SORT_SQL[q.sort];
    const dir = q.order === 'asc' ? 'ASC' : 'DESC';
    if (q.cursor) {
      const c = decodeCursor(q.cursor, q);
      const op = q.order === 'asc' ? '>' : '<';
      where.push(`(${s.col}, t.id) ${op} (${add(c.v)}::${s.cast}, ${add(c.id)}::bigint)`);
    }
    const limitParam = add(q.limit + 1);
    const sql = `${SELECT_TEMPLATE.replace('SELECT t.id,', `SELECT ${s.key} AS sort_key, t.id,`)}
                 WHERE ${where.join(' AND ')}
                 ORDER BY ${s.col} ${dir}, t.id ${dir} LIMIT ${limitParam}`;
    const rows = (await this.pool.query<TemplateRow>(sql, params)).rows;
    const hasMore = rows.length > q.limit;
    const page = hasMore ? rows.slice(0, q.limit) : rows;
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last
        ? Buffer.from(JSON.stringify({ sort: q.sort, order: q.order, v: last.sort_key as string, id: last.id } satisfies Cursor)).toString('base64url')
        : null;
    return { items: page.map(mapTemplate), pagination: { limit: q.limit, nextCursor } };
  }

  async get(ctx: RequestContext, id: string) {
    const row = await findReadable(this.pool, ctx, id);
    if (!row) throw notFound();
    return mapTemplate(row);
  }

  async create(ctx: RequestContext, input: CreateTemplateInput) {
    if (input.scope === 'GLOBAL' && !isGlobalAdmin(ctx)) throw forbidden('Creating GLOBAL templates requires template:global:admin');
    if (input.thumbnailAssetId) await this.integrations.media.assertAssetsAccessible(ctx, [input.thumbnailAssetId]);
    const slug = input.slug ?? slugify(input.name);
    if (!slug) throw badRequest('INVALID_SLUG', 'slug could not be derived from name; provide one');

    try {
      return await withTx(this.pool, async (client) => {
        if (input.categoryId) await assertCategory(client, input.categoryId);
        const global = input.scope === 'GLOBAL';
        const ins = await client.query<{ id: string }>(
          `INSERT INTO templates (scope_type, tenant_id, organization_id, name, slug, description, category_id, industry,
                                  visibility, thumbnail_asset_id, created_by, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11) RETURNING id`,
          [
            input.scope,
            global ? null : ctx.tenantId,
            global ? null : ctx.organizationId,
            input.name,
            slug,
            input.description ?? null,
            input.categoryId ?? null,
            input.industry ?? null,
            input.visibility,
            input.thumbnailAssetId ?? null,
            ctx.userId,
          ],
        );
        const id = ins.rows[0].id;
        await syncTags(client, id, input.tags);
        await audit(client, ctx, 'template.create', 'template', id, { slug, scope: input.scope });
        const row = await findReadable(client, ctx, id);
        return mapTemplate(row as TemplateRow);
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict('TEMPLATE_SLUG_CONFLICT', 'A template with this slug already exists');
      throw e;
    }
  }

  async update(ctx: RequestContext, id: string, input: UpdateTemplateInput, ifMatch: number | undefined) {
    if (input.thumbnailAssetId) await this.integrations.media.assertAssetsAccessible(ctx, [input.thumbnailAssetId]);
    try {
      return await withTx(this.pool, async (client) => {
        const current = await lockWritable(client, ctx, id);
        if (ifMatch !== undefined && ifMatch !== current.revision) throw preconditionFailed();
        if (input.categoryId) await assertCategory(client, input.categoryId);

        const cols: Record<string, unknown> = {
          name: input.name,
          slug: input.slug,
          description: input.description,
          category_id: input.categoryId,
          industry: input.industry,
          visibility: input.visibility,
          thumbnail_asset_id: input.thumbnailAssetId,
        };
        const sets: string[] = [];
        const params: unknown[] = [];
        for (const [col, v] of Object.entries(cols)) {
          if (v === undefined) continue;
          params.push(v);
          sets.push(`${col} = $${params.length}`);
        }
        params.push(ctx.userId, id);
        await client.query(
          `UPDATE templates SET ${sets.length ? sets.join(', ') + ',' : ''} updated_by = $${params.length - 1},
                  updated_at = NOW(), revision = revision + 1 WHERE id = $${params.length}`,
          params,
        );
        if (input.tags) await syncTags(client, id, input.tags);
        await audit(client, ctx, 'template.update', 'template', id, { fields: Object.keys(input) });
        return mapTemplate((await findReadable(client, ctx, id)) as TemplateRow);
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict('TEMPLATE_SLUG_CONFLICT', 'A template with this slug already exists');
      throw e;
    }
  }

  async archive(ctx: RequestContext, id: string) {
    return withTx(this.pool, async (client) => {
      await lockWritable(client, ctx, id);
      const r = await client.query<{ archived_at: Date }>(
        `UPDATE templates SET status = 'ARCHIVED', archived_at = NOW(), updated_at = NOW(), updated_by = $2,
                revision = revision + 1 WHERE id = $1 RETURNING archived_at`,
        [id, ctx.userId],
      );
      await audit(client, ctx, 'template.archive', 'template', id);
      return { id, status: 'ARCHIVED' as const, archivedAt: r.rows[0].archived_at.toISOString() };
    });
  }
}
