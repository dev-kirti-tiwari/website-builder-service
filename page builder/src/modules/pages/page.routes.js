const express = require('express');
const validate = require('../../middleware/validate');
const authorize = require('../../middleware/authorization');
const s = require('./page.schema');
const c = require('./page.controller');

const router = express.Router();

router.post('/', authorize('edit'), validate({ body: s.createBody }), c.create);
router.get('/', authorize('read'), validate({ query: s.listQuery }), c.list);
router.get('/:id', authorize('read'), validate({ params: s.params, query: s.getQuery }), c.get);
router.patch('/:id', authorize('edit'), validate({ params: s.params, body: s.patchBody }), c.update);
router.post('/:id/duplicate', authorize('edit'), validate({ params: s.params }), c.duplicate);
router.delete('/:id', authorize('delete'), validate({ params: s.params }), c.remove);

router.use('/:id/sections', require('../sections/section.routes'));
router.use('/:id/layout', require('../layouts/layout.routes'));
router.use('/:id/draft', require('../drafts/draft.routes'));
router.use('/:id/revisions', require('../revisions/revision.routes'));
router.use('/:id/preview', require('../previews/preview.routes'));

module.exports = router;
