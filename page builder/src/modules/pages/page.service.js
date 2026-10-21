const db = require('../../config/database');
const repo = require('./page.repository');
const sectionsRepo = require('../sections/section.repository');
const layoutRepo = require('../layouts/layout.repository');
const revisions = require('../revisions/revision.service');
const audit = require('../../integrations/auditClient');
const { pageNotFound } = require('../../utils/errors');

async function create(ctx, { name, slug }) {
  return db.withTx(async (tx) => {
    // Slug uniqueness is enforced by a partial unique index (races map to SLUG_CONFLICT).
    const page = await repo.insert(tx, ctx.workspaceId, { name, slug }, ctx.actorId);
    await layoutRepo.upsert(tx, page.id, ctx.workspaceId, {}, {});
    await revisions.record(tx, ctx, page.id, page.revision);
    await audit(tx, ctx, 'PAGE_CREATED', `page:${page.id}`, { slug });
    return page;
  });
}

const list = (ctx, query) =>
  repo.list(db, ctx.workspaceId, { ...query, offset: (query.page - 1) * query.limit });

async function get(ctx, id, include) {
  const page = await repo.findById(db, id, ctx.workspaceId);
  if (!page) throw pageNotFound();
  if (include !== 'structure') return page;
  const { layout, sections } = await revisions.loadStructure(db, id, ctx.workspaceId);
  return { ...page, layout, sections };
}

async function update(ctx, id, fields) {
  return db.withTx(async (tx) => {
    const page = await repo.updateMeta(tx, id, ctx.workspaceId, fields, ctx.actorId);
    if (!page) throw pageNotFound();
    await audit(tx, ctx, 'PAGE_UPDATED', `page:${id}`, { fields: Object.keys(fields) });
    return page;
  });
}

async function nextFreeSlug(exec, ws, slug) {
  const base = `${slug}-copy`.slice(0, 190);
  let candidate = base;
  for (let n = 2; await repo.slugExists(exec, ws, candidate); n += 1) candidate = `${base}-${n}`;
  return candidate;
}

// Copies structure only (layout + sections). Content copying is the BFF's job via the Content API.
async function duplicate(ctx, id) {
  return db.withTx(async (tx) => {
    const source = await repo.findById(tx, id, ctx.workspaceId);
    if (!source) throw pageNotFound();
    const slug = await nextFreeSlug(tx, ctx.workspaceId, source.slug);
    const name = `${source.name} (copy)`.slice(0, 180);
    const copy = await repo.insert(tx, ctx.workspaceId, { name, slug }, ctx.actorId);
    const layout = await layoutRepo.get(tx, id, ctx.workspaceId);
    await layoutRepo.upsert(tx, copy.id, ctx.workspaceId, layout.layout, layout.responsive);
    await sectionsRepo.copyAll(tx, ctx.workspaceId, id, copy.id);
    await revisions.record(tx, ctx, copy.id, copy.revision);
    await audit(tx, ctx, 'PAGE_DUPLICATED', `page:${copy.id}`, { sourceId: id });
    return copy;
  });
}

// Soft delete: children are retained; the slug becomes reusable.
async function remove(ctx, id) {
  return db.withTx(async (tx) => {
    const deleted = await repo.softDelete(tx, id, ctx.workspaceId, ctx.actorId);
    if (!deleted) throw pageNotFound();
    await audit(tx, ctx, 'PAGE_DELETED', `page:${id}`);
    return { id, deleted: true };
  });
}

module.exports = { create, list, get, update, duplicate, remove };
