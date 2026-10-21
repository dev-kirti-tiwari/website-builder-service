const jwt = require('jsonwebtoken');
const config = require('./config');
const { ApiError } = require('./errors');

const ID = /^[1-9]\d{0,18}$/;

// Verifies the Bearer JWT (signature, algorithm, issuer, audience, exp, nbf), then binds the
// X-Tenant-Id / X-Organization-Id headers to the VERIFIED claims. Headers alone are never trusted.
function authenticate(req, _res, next) {
  const m = /^Bearer\s+([A-Za-z0-9._-]+)$/.exec(req.get('authorization') || '');
  if (!m) throw new ApiError(401, 'UNAUTHENTICATED', 'Missing or malformed Bearer token.');

  let claims;
  try {
    claims = jwt.verify(m[1], config.jwt.secret, {
      algorithms: ['HS256'],
      issuer: config.jwt.issuer,
      audience: config.jwt.audience,
    });
  } catch (e) {
    throw new ApiError(401, 'INVALID_TOKEN', e.name === 'TokenExpiredError' ? 'Token expired.' : 'Invalid token.');
  }
  if (!claims.sub || !claims.exp || !ID.test(String(claims.tenant_id)) || !ID.test(String(claims.organization_id))) {
    throw new ApiError(401, 'INVALID_TOKEN', 'Token is missing required claims.');
  }

  const tenantHeader = req.get('x-tenant-id');
  const orgHeader = req.get('x-organization-id');
  if (!tenantHeader || !orgHeader) {
    throw new ApiError(400, 'MISSING_SCOPE_HEADERS', 'X-Tenant-Id and X-Organization-Id are required.');
  }
  if (tenantHeader !== String(claims.tenant_id) || orgHeader !== String(claims.organization_id)) {
    throw new ApiError(403, 'SCOPE_MISMATCH', 'Tenant/organization headers do not match the token.');
  }

  req.ctx = {
    userId: String(claims.sub),
    tenantId: String(claims.tenant_id),
    orgId: String(claims.organization_id),
    permissions: Array.isArray(claims.permissions) ? claims.permissions : [],
  };
  next();
}

const requirePermission = (perm) => (req, _res, next) => {
  if (!req.ctx.permissions.includes(perm)) throw new ApiError(403, 'FORBIDDEN', `Missing permission ${perm}.`);
  next();
};

module.exports = { authenticate, requirePermission };
