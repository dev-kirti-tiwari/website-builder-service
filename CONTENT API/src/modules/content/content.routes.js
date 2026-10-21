'use strict';
const { Router } = require('express');
const c = require('./content.controller');
const asyncHandler = require('../../utils/asyncHandler');
const { authenticate, authenticateInternal } = require('../../middleware/authentication');
const workspace = require('../../middleware/workspace');
const { requirePermission: can } = require('../../middleware/authorization');

const h = asyncHandler;
const user = [authenticate, workspace];
const internal = [authenticateInternal, workspace];
const router = Router();

router.post('/sections/:sectionId/content', ...user, can('edit'), h(c.create));
router.get('/sections/:sectionId/content', ...user, can('read'), h(c.get));
router.put('/sections/:sectionId/content', ...user, can('edit'), h(c.replace));
router.patch('/sections/:sectionId/content', ...user, can('edit'), h(c.patch));
router.delete('/sections/:sectionId/content', ...user, can('delete'), h(c.remove));
router.get('/pages/:pageId/content', ...user, can('read'), h(c.getByPage));
router.get('/sections/:sectionId/content/revisions', ...user, can('read'), h(c.listRevisions));
router.post('/sections/:sectionId/content/revisions/:revision/restore', ...user, can('restore'), h(c.restore));
router.post('/internal/content/duplicate', ...internal, h(c.duplicate));

module.exports = router;
