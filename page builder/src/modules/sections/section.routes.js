const express = require('express');
const validate = require('../../middleware/validate');
const authorize = require('../../middleware/authorization');
const s = require('./section.schema');
const c = require('./section.controller');

const router = express.Router({ mergeParams: true });

router.post('/', authorize('edit'), validate({ params: s.params, body: s.createBody }), c.add);
router.put('/order', authorize('edit'), validate({ params: s.params, body: s.reorderBody }), c.reorder);
router.patch('/:sectionId', authorize('edit'), validate({ params: s.sectionParams, body: s.patchBody }), c.update);
router.post('/:sectionId/duplicate', authorize('edit'), validate({ params: s.sectionParams, body: s.optionalRevisionBody }), c.duplicate);
router.delete('/:sectionId', authorize('edit'), validate({ params: s.sectionParams, body: s.optionalRevisionBody }), c.remove);

module.exports = router;
