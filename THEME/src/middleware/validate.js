'use strict';

const { AppError } = require('../errors');
const { formatZodIssues } = require('../services/themeValidator');

/**
 * Validate params / query / body with Zod. Results are stored on req.valid
 * (req.query is read-only in Express 5). Request-shape failures are 400 VALIDATION_ERROR.
 */
function validate({ params, query, body }) {
  return (req, _res, next) => {
    const issues = [];
    const valid = {};
    const run = (name, schema, input) => {
      if (!schema) return;
      const r = schema.safeParse(input);
      if (r.success) valid[name] = r.data;
      else issues.push(...formatZodIssues(r.error, [name]));
    };
    run('params', params, req.params);
    run('query', query, req.query);
    run('body', body, req.body === undefined ? {} : req.body);
    if (issues.length) throw new AppError(400, 'VALIDATION_ERROR', 'Request validation failed', issues);
    req.valid = valid;
    next();
  };
}

module.exports = { validate };
