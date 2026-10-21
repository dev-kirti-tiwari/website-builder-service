const repo = require('./section.repository');
const registry = require('../sectionRegistry/registry');
const revisions = require('../revisions/revision.service');
const audit = require('../../integrations/auditClient');
const { mergeObject, mergeResponsive } = require('../../utils/merge');
const { AppError, sectionNotFound } = require('../../utils/errors');

// Merges a patch into an existing section, validates against the registry, and persists.
// Shared by PATCH section and draft autosave. Runs inside a transaction.
async function applySectionPatch(db, ctx, pageId, section, patch) {
  const next = registry.validate(section.type, {
    variant: patch.variant ?? section.variant,
    configuration: patch.configuration ? mergeObject(section.configuration, patch.configuration) : section.configuration,
    responsive: patch.responsive ? mergeResponsive(section.responsive, patch.responsive) : section.responsive,
  });
  return repo.update(db, section.id, pageId, ctx.workspaceId, {
    variant: next.variant,
    configuration: next.configuration,
    responsive: next.responsive,
    visible: patch.visible,
    contentRef: patch.contentRef,
  });
}

async function add(ctx, pageId, body) {
  const defaults = registry.get(body.type).defaults;
  // Validate before touching the database.
  const values = registry.validate(body.type, {
    variant: body.variant ?? defaults.variant,
    configuration: { ...defaults.configuration, ...(body.configuration || {}) },
    responsive: body.responsive ? mergeResponsive(defaults.responsive, body.responsive) : defaults.responsive,
  });

  return revisions.mutate(ctx, pageId, body.expectedRevision, async (db) => {
    const total = await repo.count(db, pageId, ctx.workspaceId);
    const position = Math.min(body.position || total + 1, total + 1);
    await repo.shiftFrom(db, pageId, ctx.workspaceId, position, 1);
    const section = await repo.insert(db, ctx.workspaceId, pageId, {
      type: body.type, position, visible: body.visible, contentRef: body.contentRef, ...values,
    });
    await audit(db, ctx, 'SECTION_ADDED', `section:${section.id}`, { pageId, type: body.type });
    return section;
  });
}

async function update(ctx, pageId, sectionId, body) {
  return revisions.mutate(ctx, pageId, body.expectedRevision, async (db) => {
    const section = await repo.find(db, sectionId, pageId, ctx.workspaceId);
    if (!section) throw sectionNotFound();
    const updated = await applySectionPatch(db, ctx, pageId, section, body);
    await audit(db, ctx, 'SECTION_UPDATED', `section:${sectionId}`, { pageId });
    return updated;
  });
}

async function duplicate(ctx, pageId, sectionId, expectedRevision) {
  return revisions.mutate(ctx, pageId, expectedRevision, async (db) => {
    const source = await repo.find(db, sectionId, pageId, ctx.workspaceId);
    if (!source) throw sectionNotFound();
    // Structure only; the content reference is not copied (content is owned by the Content API).
    await repo.shiftFrom(db, pageId, ctx.workspaceId, source.position + 1, 1);
    const copy = await repo.insert(db, ctx.workspaceId, pageId, { ...source, id: undefined, position: source.position + 1, contentRef: null });
    await audit(db, ctx, 'SECTION_DUPLICATED', `section:${copy.id}`, { pageId, sourceId: sectionId });
    return copy;
  });
}

async function remove(ctx, pageId, sectionId, expectedRevision) {
  return revisions.mutate(ctx, pageId, expectedRevision, async (db) => {
    const removed = await repo.remove(db, sectionId, pageId, ctx.workspaceId);
    if (!removed) throw sectionNotFound();
    await repo.normalize(db, pageId, ctx.workspaceId);
    await audit(db, ctx, 'SECTION_REMOVED', `section:${sectionId}`, { pageId });
    return { id: sectionId, removed: true };
  });
}

// Contract: the client sends the COMPLETE ordered list of section IDs for the page.
async function reorder(ctx, pageId, { sectionIds, expectedRevision }) {
  if (new Set(sectionIds).size !== sectionIds.length) {
    throw new AppError(422, 'VALIDATION_ERROR', 'sectionIds must not contain duplicates.');
  }
  return revisions.mutate(ctx, pageId, expectedRevision, async (db) => {
    const current = await repo.listByPage(db, pageId, ctx.workspaceId);
    const known = new Set(current.map((s) => s.id));
    if (sectionIds.some((id) => !known.has(id))) throw sectionNotFound();
    if (sectionIds.length !== current.length) {
      throw new AppError(422, 'VALIDATION_ERROR', 'sectionIds must list every section on the page.');
    }
    await repo.setOrder(db, pageId, ctx.workspaceId, sectionIds);
    await audit(db, ctx, 'SECTION_REORDERED', `page:${pageId}`, { count: sectionIds.length });
    return repo.listByPage(db, pageId, ctx.workspaceId);
  });
}

module.exports = { applySectionPatch, add, update, duplicate, remove, reorder };
