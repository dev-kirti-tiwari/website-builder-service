'use strict';
const crypto = require('node:crypto');

const VALID = /^[A-Za-z0-9._-]{1,64}$/;

module.exports = (req, res, next) => {
  const incoming = req.get('x-request-id');
  req.id = incoming && VALID.test(incoming) ? incoming : `req_${crypto.randomUUID()}`;
  res.set('X-Request-Id', req.id);
  next();
};
