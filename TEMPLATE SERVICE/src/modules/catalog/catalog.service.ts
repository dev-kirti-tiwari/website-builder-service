import type { Pool } from 'pg';
import type { RequestContext } from '../../types';
import { readableSql } from '../templates/template.repository';

export class CatalogService {
  constructor(private readonly pool: Pool) {}

  async categories() {
    const r = await this.pool.query<{ id: string; name: string; slug: string; sort_order: number }>(
      'SELECT id, name, slug, sort_order FROM template_categories WHERE is_active ORDER BY sort_order, id',
    );
    return r.rows.map((c) => ({ id: c.id, name: c.name, slug: c.slug, sortOrder: c.sort_order }));
  }

  /** Only tags attached to templates the caller can read, so tag names never leak across tenants. */
  async tags(ctx: RequestContext) {
    const r = await this.pool.query<{ id: string; name: string; slug: string }>(
      `SELECT DISTINCT g.id, g.name, g.slug
       FROM template_tags g
       JOIN template_tag_links l ON l.tag_id = g.id
       JOIN templates t ON t.id = l.template_id
       WHERE ${readableSql(ctx, 1, 2)}
       ORDER BY g.name, g.id LIMIT 500`,
      [ctx.tenantId, ctx.organizationId],
    );
    return r.rows;
  }
}
