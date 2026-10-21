'use strict';
const { E } = require('../utils/errors');

// Permission names (decision recorded in docs/DECISIONS.md)
const PERMISSIONS = {
  read: 'content:read',
  edit: 'content:edit',
  delete: 'content:delete',
  restore: 'content:restore',
  duplicate: 'content:duplicate',
};

const require_ = (action) => (req, res, next) => {
  if (req.actor.internal) return next();
  const needed = PERMISSIONS[action];
  const p = req.actor.permissions;
  if (p.has(needed) || p.has('content:*') || p.has('*')) return next();
  next(E.forbidden());
};

module.exports = { requirePermission: require_, PERMISSIONS };
