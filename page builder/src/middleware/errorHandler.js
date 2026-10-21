const { AppError } = require('../utils/errors');

function normalize(err) {
  if (err instanceof AppError) return err;
  if (err.type === 'entity.too.large') return new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body too large.');
  if (err.type === 'entity.parse.failed') return new AppError(400, 'BAD_REQUEST', 'Malformed JSON body.');
  if (err.code === '23505' && err.constraint === 'pages_workspace_slug_active_uq') {
    return new AppError(409, 'SLUG_CONFLICT', 'Slug is already in use in this workspace.');
  }
  return null;
}

module.exports = (err, req, res, next) => { // eslint-disable-line no-unused-vars
  const known = normalize(err);
  if (!known && req.log) req.log.error({ err }, 'unhandled error');
  const status = known ? known.status : 500;
  res.status(status).json({
    success: false,
    error: {
      code: known ? known.code : 'INTERNAL_ERROR',
      message: known ? known.message : 'Internal server error.',
      details: known ? known.details : [],
    },
    meta: { requestId: req.id },
  });
};
