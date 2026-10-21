const express = require('express');
const { z } = require('zod');
const validate = require('../../middleware/validate');
const authorize = require('../../middleware/authorization');
const { idSchema } = require('../../validators/common');
const draftService = require('../drafts/draft.service');
const { ctxOf, send } = require('../../utils/http');

const router = express.Router({ mergeParams: true });

// Preview = current draft structure + the content references the BFF must resolve via the Content API.
// It never publishes anything.
router.get('/', authorize('read'), validate({ params: z.object({ id: idSchema }) }), async (req, res) => {
  const draft = await draftService.getDraft(ctxOf(req), req.valid.params.id);
  const sections = draft.sections.map((s) => ({
    id: s.id,
    type: s.type,
    position: s.position,
    variant: s.variant,
    visible: s.visible,
    configuration: s.configuration,
    responsive: s.responsive,
    contentRef: s.contentRef,
  }));
  send(req, res, {
    page: draft.page,
    revision: draft.revision,
    layout: draft.layout,
    sections,
    contentReferences: sections
      .filter((s) => s.contentRef)
      .map((s) => ({ sectionId: s.id, type: s.type, contentRef: s.contentRef })),
  });
});

module.exports = router;
