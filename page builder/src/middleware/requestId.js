const crypto = require('crypto');

module.exports = (req, res, next) => {
  const incoming = req.get('X-Request-Id');
  req.id = incoming && /^[A-Za-z0-9_.-]{1,64}$/.test(incoming) ? incoming : `req_${crypto.randomUUID()}`;
  res.set('X-Request-Id', req.id);
  next();
};
