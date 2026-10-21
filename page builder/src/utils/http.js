const ctxOf = (req) => ({
  workspaceId: req.workspace.id,
  actorId: req.auth.actorId,
  requestId: req.id,
});

const send = (req, res, data, { status = 200, meta = {} } = {}) =>
  res.status(status).json({ success: true, data, meta: { requestId: req.id, ...meta } });

module.exports = { ctxOf, send };
