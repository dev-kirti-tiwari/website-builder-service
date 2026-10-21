const { AppError } = require('../utils/errors');

// Resolves X-Workspace-Id and verifies the authenticated actor may use it.
module.exports = (req, res, next) => {
  const raw = req.get('X-Workspace-Id');
  if (!raw) return next(new AppError(400, 'WORKSPACE_REQUIRED', 'X-Workspace-Id header is required.'));
  if (!/^[1-9]\d{0,17}$/.test(raw)) return next(new AppError(400, 'BAD_REQUEST', 'X-Workspace-Id is invalid.'));

  // Internal (BFF) and dev callers are trusted to have resolved membership already.
  const role = req.auth.mode === 'jwt' ? req.auth.workspaces.get(raw) : 'admin';
  if (!role) return next(new AppError(403, 'FORBIDDEN', 'You do not have access to this workspace.'));

  req.workspace = { id: raw, role };
  if (req.log) req.log = req.log.child({ workspaceId: raw, actorId: req.auth.actorId });
  return next();
};
