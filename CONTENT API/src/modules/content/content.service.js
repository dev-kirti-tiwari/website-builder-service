'use strict';
const { withTransaction } = require('../../config/database');
const repo = require('./content.repository');
const schema = require('./content.schema');
const pageBuilder = require('../../integrations/pageBuilderClient');
const { assertMediaExist } = require('../../integrations/mediaClient');
const audit = require('../../integrations/auditClient');
const { E } = require('../../utils/errors');

const UNIQUE_VIOLATION = '23505';

const present = (r) => ({
  id: r.id,
  pageId: r.pageId,
  sectionId: r.sectionId,
  sectionType: r.sectionType,
  schemaVersion: r.schemaVersion,
  revision: r.revision,
  content: r.content,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

const auditMeta = (ctx, row, extra) => ({
  workspaceId: ctx.workspaceId,
  pageId: row.pageId,
  sectionId: row.sectionId,
  contentId: row.id,
  actorId: ctx.actor.id ?? ctx.actor.subject,
  revision: row.revision,
  requestId: ctx.requestId,
  ...extra,
});

/** Locks the current row for update and enforces optimistic concurrency. */
async function lockAndCheck(client, ctx, sectionId, expectedRevision) {
  const current = await repo.findBySection(ctx.workspaceId, sectionId, { client, forUpdate: true });
  if (!current) throw E.contentNotFound();
  if (expectedRevision !== undefined && current.revision !== expectedRevision) {
    throw E.revisionConflict(current.revision);
  }
  return current;
}

async function insertWithSnapshot(client, row) {
  try {
    const created = await repo.insert(client, row);
    await repo.insertRevision(client, created);
    return created;
  } catch (err) {
    if (err.code === UNIQUE_VIOLATION) throw E.alreadyExists();
    throw err;
  }
}

async function create(ctx, sectionId, rawBody) {
  const body = schema.parseRequest(schema.createBody, rawBody);
  if (!schema.SECTION_TYPES.includes(body.sectionType)) {
    throw E.sectionTypeMismatch(`Unsupported section type: ${body.sectionType}`);
  }
  const content = schema.validateContent(body.sectionType, body.content);
  const section = await pageBuilder.getSection({ sectionId, workspaceId: ctx.workspaceId, requestId: ctx.requestId });
  if (section) {
    if (section.type && section.type !== body.sectionType) throw E.sectionTypeMismatch();
    if (section.pageId && section.pageId !== body.pageId) throw E.sectionNotFound();
  }
  await assertMediaExist(content, ctx);
  const row = await withTransaction((client) =>
    insertWithSnapshot(client, {
      workspaceId: ctx.workspaceId,
      pageId: body.pageId,
      sectionId,
      sectionType: body.sectionType,
      schemaVersion: body.schemaVersion ?? 1,
      content,
      actorId: ctx.actor.id,
    }));
  audit.emit('CONTENT_CREATED', auditMeta(ctx, row));
  return present(row);
}

async function get(ctx, sectionId) {
  const row = await repo.findBySection(ctx.workspaceId, sectionId);
  if (!row) throw E.contentNotFound();
  return present(row);
}

async function mutate(ctx, sectionId, rawBody, bodySchema, mode) {
  const body = schema.parseRequest(bodySchema, rawBody);
  const row = await withTransaction(async (client) => {
    const current = await lockAndCheck(client, ctx, sectionId, body.expectedRevision);
    const next = mode === 'patch' ? schema.mergePatch(current.content, body.content) : body.content;
    const content = schema.validateContent(current.sectionType, next);
    await assertMediaExist(content, ctx);
    const updated = await repo.update(client, {
      id: current.id,
      workspaceId: ctx.workspaceId,
      schemaVersion: current.schemaVersion,
      content,
      actorId: ctx.actor.id,
    });
    await repo.insertRevision(client, updated);
    return updated;
  });
  audit.emit('CONTENT_UPDATED', auditMeta(ctx, row, { mode }));
  return present(row);
}

const replace = (ctx, sectionId, rawBody) => mutate(ctx, sectionId, rawBody, schema.replaceBody, 'replace');
const patch = (ctx, sectionId, rawBody) => mutate(ctx, sectionId, rawBody, schema.patchBody, 'patch');

async function remove(ctx, sectionId, expectedRevision) {
  const row = await withTransaction(async (client) => {
    const current = await lockAndCheck(client, ctx, sectionId, expectedRevision);
    await repo.softDelete(client, { id: current.id, workspaceId: ctx.workspaceId, actorId: ctx.actor.id });
    return current;
  });
  audit.emit('CONTENT_DELETED', auditMeta(ctx, row));
}

async function getByPage(ctx, pageId) {
  const rows = await repo.findByPage(ctx.workspaceId, pageId);
  const contents = {};
  for (const r of rows) contents[r.sectionId] = present(r);
  // Decision: only existing rows are returned; the BFF joins by sectionId and handles sections without content.
  return { pageId, count: rows.length, contents, items: rows.map(present) };
}

async function listRevisions(ctx, sectionId, { limit, offset }) {
  const current = await repo.findBySection(ctx.workspaceId, sectionId);
  if (!current) throw E.contentNotFound();
  const { items, total } = await repo.listRevisions(ctx.workspaceId, current.id, { limit, offset });
  return { currentRevision: current.revision, items, pagination: { limit, offset, total } };
}

async function restore(ctx, sectionId, revisionNumber, rawBody) {
  const body = schema.parseRequest(schema.restoreBody, rawBody);
  const row = await withTransaction(async (client) => {
    const current = await lockAndCheck(client, ctx, sectionId, body.expectedRevision);
    const old = await repo.findRevision(client, ctx.workspaceId, current.id, revisionNumber);
    if (!old) throw E.revisionNotFound();
    const content = schema.validateContent(current.sectionType, old.snapshot);
    const updated = await repo.update(client, {
      id: current.id,
      workspaceId: ctx.workspaceId,
      schemaVersion: old.schemaVersion,
      content,
      actorId: ctx.actor.id,
    });
    await repo.insertRevision(client, updated);
    return updated;
  });
  audit.emit('CONTENT_REVISION_RESTORED', auditMeta(ctx, row, { restoredFromRevision: revisionNumber }));
  return present(row);
}

async function duplicate(ctx, rawBody) {
  const { mappings } = schema.parseRequest(schema.duplicateBody, rawBody);
  const targets = new Set();
  for (const m of mappings) {
    if (m.sourceSectionId === m.targetSectionId) throw E.badRequest('sourceSectionId and targetSectionId must differ');
    if (targets.has(m.targetSectionId)) throw E.badRequest(`Duplicate targetSectionId ${m.targetSectionId}`);
    targets.add(m.targetSectionId);
  }
  const sections = [];
  for (const m of mappings) {
    sections.push(await pageBuilder.getSection({
      sectionId: m.targetSectionId,
      workspaceId: ctx.workspaceId,
      requestId: ctx.requestId,
    }));
  }
  const created = await withTransaction(async (client) => {
    const out = [];
    for (const [i, m] of mappings.entries()) {
      const source = await repo.findBySection(ctx.workspaceId, m.sourceSectionId, { client });
      if (!source) throw E.contentNotFound();
      const pb = sections[i];
      if (pb?.type && pb.type !== source.sectionType) throw E.sectionTypeMismatch();
      // brand-new row and id: the JSONB is copied, never shared with the source
      const row = await insertWithSnapshot(client, {
        workspaceId: ctx.workspaceId,
        pageId: m.targetPageId ?? pb?.pageId ?? source.pageId,
        sectionId: m.targetSectionId,
        sectionType: source.sectionType,
        schemaVersion: source.schemaVersion,
        content: source.content,
        actorId: ctx.actor.id,
      });
      out.push({ sourceSectionId: m.sourceSectionId, row });
    }
    return out;
  });
  for (const c of created) {
    audit.emit('CONTENT_DUPLICATED', auditMeta(ctx, c.row, { sourceSectionId: c.sourceSectionId }));
  }
  return {
    count: created.length,
    items: created.map((c) => ({ sourceSectionId: c.sourceSectionId, ...present(c.row) })),
  };
}

module.exports = { create, get, replace, patch, remove, getByPage, listRevisions, restore, duplicate };
