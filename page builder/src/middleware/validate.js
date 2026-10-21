const { AppError } = require('../utils/errors');

// validate({ params, query, body }) -> parsed values on req.valid.{params,query,body}
module.exports = (schemas) => (req, res, next) => {
  req.valid = {};
  const details = [];
  for (const key of ['params', 'query', 'body']) {
    if (!schemas[key]) continue;
    const input = key === 'body' ? (req.body ?? {}) : req[key];
    const result = schemas[key].safeParse(input);
    if (result.success) {
      req.valid[key] = result.data;
    } else {
      for (const issue of result.error.issues) {
        details.push({ location: key, path: issue.path.join('.'), message: issue.message });
      }
    }
  }
  if (details.length) return next(new AppError(422, 'VALIDATION_ERROR', 'Request validation failed.', details));
  return next();
};
