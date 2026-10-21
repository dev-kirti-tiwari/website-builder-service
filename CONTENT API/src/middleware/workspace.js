'use strict';
const { E } = require('../utils/errors');
const { parseId } = require('../utils/ids');

/** Selects the workspace and verifies the authenticated actor may act in it. Never trusts the header alone. */
module.exports = (req, res, next) => {
  const raw = req.get('x-workspace-id');
  if (!raw) return next(E.workspaceRequired());
  const id = parseId(raw.trim());
  if (!id) return next(E.badRequest('X-Workspace-Id must be a positive integer'));
  if (!req.actor.internal && !req.actor.workspaces.has(id)) return next(E.forbidden('No access to this workspace'));
  req.workspaceId = id;
  next();
};
