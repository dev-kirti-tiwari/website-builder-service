const { AppError } = require('../utils/errors');

const RANK = { viewer: 1, editor: 2, admin: 3 };
const REQUIRED = { read: 1, edit: 2, delete: 3 };

// permission: 'read' (viewer+), 'edit' (editor+), 'delete' (admin)
module.exports = (permission) => (req, res, next) => {
  if ((RANK[req.workspace.role] || 0) < REQUIRED[permission]) {
    return next(new AppError(403, 'FORBIDDEN', 'You are not allowed to perform this action.'));
  }
  return next();
};
