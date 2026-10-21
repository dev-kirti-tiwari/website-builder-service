const db = require('../../config/database');
const pagesRepo = require('../pages/page.repository');
const sectionsRepo = require('../sections/section.repository');
const layoutRepo = require('../layouts/layout.repository');
const revisionRepo = require('./revision.repository');
const audit = require('../../integrations/auditClient');
const { AppError, pageNotFound } = require('../../utils/errors');

// Structural state of a page: layout + ordered sections. Content is never included.
async function loadStructure(exec, pageId, ws) {
  const layout = await layoutRepo.get(exec, pageId, ws);
  const sections = await sectionsRepo.listByPage(exec, pageId, ws);
  return { layout, sections };
}

async function buildSnapshot(exec, pageId, ws) {
  const { layout, sections } = await loadStructure(exec, pageId, ws);
  return {
    layout,
    sections: sections.map((s) => ({
      id: s.id,
      type: s.type,
      position: s.position,
      variant: s.variant,
      visible: s.visible,
      configuration: s.configuration,
      responsive: s.responsive,
      contentRef: s.contentRef,
    })),
  };
}

// Policy: one immutable snapshot per successful structural revision.
async function record(exec, ctx, pageId, revisionNumber) {
  const snapshot = await buildSnapshot(exec, pageId, ctx.workspaceId);
  await revisionRepo.insert(exec, ctx.workspaceId, pageId, revisionNumber, snapshot, ctx.actorId);
}

// Runs `fn` in a transaction with the page row locked, checks expectedRevision (optimistic
// concurrency), then bumps the revision and records a snapshot. All-or-nothing.
async function mutate(ctx, pageId, expectedRevision, fn) {
  return db.withTx(async (tx) => {
    const page = await pagesRepo.findById(tx, pageId, ctx.workspaceId, { forUpdate: true });
    if (!page) throw pageNotFound();
    if (expectedRevision != null && page.revision !== expectedRevision) {
      throw new AppError(409, 'REVISION_CONFLICT', 'The page has changed since it was loaded.', [
        { currentRevision: page.revision },
      ]);
    }
    const data = await fn(tx, page);
    const revision = await pagesRepo.bumpRevision(tx, pageId, ctx.workspaceId, ctx.actorId);
    await record(tx, ctx, pageId, revision);
    return { data, revision };
  });
}

async function list(ctx, pageId, paging) {
  const page = await pagesRepo.findById(db, pageId, ctx.workspaceId);
  if (!page) throw pageNotFound();
  const result = await revisionRepo.list(db, pageId, ctx.workspaceId, paging);
  return { ...result, currentRevision: page.revision };
}

// Restores the structure of an earlier revision as a NEW revision (history is never rewritten).
async function restore(ctx, pageId, revisionNumber, expectedRevision) {
  return mutate(ctx, pageId, expectedRevision, async (tx) => {
    const snapshot = await revisionRepo.findSnapshot(tx, pageId, ctx.workspaceId, revisionNumber);
    if (!snapshot) throw new AppError(404, 'REVISION_NOT_FOUND', 'Revision not found.');
    await sectionsRepo.removeAll(tx, pageId, ctx.workspaceId);
    for (const s of snapshot.sections) await sectionsRepo.insert(tx, ctx.workspaceId, pageId, s);
    await layoutRepo.upsert(tx, pageId, ctx.workspaceId, snapshot.layout.layout, snapshot.layout.responsive);
    await audit(tx, ctx, 'REVISION_RESTORED', `page:${pageId}`, { restoredFrom: revisionNumber });
    return { restoredFrom: revisionNumber };
  });
}

module.exports = { loadStructure, buildSnapshot, record, mutate, list, restore };
