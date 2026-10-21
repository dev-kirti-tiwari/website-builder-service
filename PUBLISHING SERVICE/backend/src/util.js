const crypto = require('crypto');
const { ApiError } = require('./errors');

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`;
}

const BIGINT_MAX = 9223372036854775807n;
const isBigintId = (s) => typeof s === 'string' && /^[1-9]\d{0,18}$/.test(s) && BigInt(s) <= BIGINT_MAX;
const requireId = (value, name) => {
  if (!isBigintId(value)) throw new ApiError(400, 'INVALID_ID', `${name} must be a positive decimal-string BIGINT.`);
  return value;
};

// Content rules for a publishable revision.
function validateContent(content) {
  const errors = [];
  const pages = content && content.pages;
  if (!Array.isArray(pages) || pages.length === 0) {
    errors.push({ code: 'NO_PAGES', message: 'Revision must contain at least one page.' });
    return errors;
  }
  const seen = new Set();
  pages.forEach((p, i) => {
    if (!p || typeof p.route !== 'string' || !p.route.startsWith('/')) {
      errors.push({ code: 'INVALID_ROUTE', message: `Page ${i} route must start with "/".` });
    } else if (seen.has(p.route)) {
      errors.push({ code: 'ROUTE_CONFLICT', message: `Duplicate route ${p.route}.` });
    } else {
      seen.add(p.route);
    }
    if (!p || typeof p.title !== 'string' || !p.title) {
      errors.push({ code: 'MISSING_TITLE', message: `Page ${i} requires a title.` });
    }
  });
  for (const a of content.assets || []) {
    if (typeof a === 'string' && a.startsWith('missing:')) {
      errors.push({ code: 'ASSET_UNAVAILABLE', message: `Asset ${a.slice(8)} is unavailable.` });
    }
  }
  return errors;
}

module.exports = { sha256, stableStringify, requireId, validateContent };
