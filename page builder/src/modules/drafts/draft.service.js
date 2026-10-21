const db = require('../../config/database');
const pagesRepo = require('../pages/page.repository');
const sectionsRepo = require('../sections/section.repository');
const sectionService = require('../sections/section.service');
const layoutService = require('../layouts/layout.service');
const revisions = require('../revisions/revision.service');
const audit = require('../../integrations/auditClient');
const { AppError, pageNotFound, sectionNotFound } = require('../../utils/errors');

const pageMeta = (p) => ({ id: p.id, name: p.name, slug: p.slug, status: p.status, revision: p.revision });

async function getDraft(ctx, pageId) {
  const page = await pagesRepo.findById(db, pageId, ctx.workspaceId);
  if (!page) throw pageNotFound();
  const { layout, sections } = await revisions.loadStructure(db, pageId, ctx.workspaceId);
  return { page: pageMeta(page), revision: page.revision, layout, sections };
}

// Autosave contract: partial patch list. `sections[].position` moves a section to that 1-based slot.
async function autosave(ctx, pageId, { expectedRevision, changes }) {
  const patches = changes.sections || [];
  if (new Set(patches.map((p) => p.id)).size !== patches.length) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Duplicate section IDs in changes.sections.');
  }

  return revisions.mutate(ctx, pageId, expectedRevision, async (tx) => {
    if (changes.layout) await layoutService.applyLayoutPatch(tx, ctx, pageId, changes.layout);

    let order = null;
    for (const patch of patches) {
      const section = await sectionsRepo.find(tx, patch.id, pageId, ctx.workspaceId);
      if (!section) throw sectionNotFound();
      await sectionService.applySectionPatch(tx, ctx, pageId, section, patch);
      if (patch.position != null) {
        if (!order) order = (await sectionsRepo.listByPage(tx, pageId, ctx.workspaceId)).map((s) => s.id);
        order.splice(order.indexOf(patch.id), 1);
        order.splice(Math.min(patch.position, order.length + 1) - 1, 0, patch.id);
      }
    }
    if (order) await sectionsRepo.setOrder(tx, pageId, ctx.workspaceId, order);

    await audit(tx, ctx, 'SECTION_UPDATED', `page:${pageId}`, { autosave: true, sections: patches.length, layout: !!changes.layout });
    return sectionsRepo.listByPage(tx, pageId, ctx.workspaceId);
  });
}

module.exports = { getDraft, autosave, pageMeta };
