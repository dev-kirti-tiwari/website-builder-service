const { AppError } = require('../utils/errors');

module.exports = (req, res, next) => {
  const hasBody = Number(req.get('content-length') || 0) > 0 || req.get('transfer-encoding');
  if (hasBody && req.is('application/json') !== 'application/json') {
    return next(new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json.'));
  }
  return next();
};
