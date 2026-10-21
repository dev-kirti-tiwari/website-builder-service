'use strict';
const { z } = require('zod');

const HTML_LIKE = /<\s*\/?\s*[a-z!?]/i;
const SCRIPT_SCHEME = /\b(javascript|vbscript)\s*:|\bdata\s*:\s*text\/html/i;

/** Trimmed plain text, no whitespace-only, no HTML/script content. */
const text = (max, { required = true } = {}) => {
  let s = z.string().trim().max(max, `must be at most ${max} characters`);
  if (required) s = s.min(1, 'must not be empty');
  return s.superRefine((v, ctx) => {
    if (HTML_LIKE.test(v) || SCRIPT_SCHEME.test(v)) {
      ctx.addIssue({ code: 'custom', message: 'HTML or executable content is not allowed' });
    }
  });
};

const MAX_URL = 2048;
/** Relative path, https:// URL, or (when allowed) mailto:/tel:. Everything else is rejected. */
const ALLOWED_PROTOCOLS = new Set(['https:']);
function isSafeUrl(raw) {
  if (raw.length > MAX_URL || /[\s\u0000-\u001f]/.test(raw)) return false;
  if (raw.startsWith('//')) return false; // protocol-relative
  if (/^[/#?]/.test(raw)) return !raw.includes('\\');
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) {
    try {
      return ALLOWED_PROTOCOLS.has(new URL(raw).protocol);
    } catch {
      return false;
    }
  }
  return false; // bare words such as "javascript" or "signup" are ambiguous
}
const url = z.string().trim().superRefine((v, ctx) => {
  if (!isSafeUrl(v)) ctx.addIssue({ code: 'custom', message: 'must be a relative path or https URL', params: { apiCode: 'INVALID_LINK' } });
});

const mediaRef = z.string().superRefine((v, ctx) => {
  if (!/^[1-9]\d{0,18}$/.test(v)) ctx.addIssue({ code: 'custom', message: 'must be a numeric media id string', params: { apiCode: 'INVALID_MEDIA_REFERENCE' } });
});

const itemKey = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'itemKey must be 1-64 chars of letters, digits, _ or -');

const button = z.object({ label: text(60), url }).strict();

/** Array of items with unique stable itemKeys. */
const items = (itemSchema, max) =>
  z.array(itemSchema).max(max, `at most ${max} items`).superRefine((arr, ctx) => {
    const seen = new Set();
    arr.forEach((it, i) => {
      if (seen.has(it.itemKey)) ctx.addIssue({ code: 'custom', path: [i, 'itemKey'], message: 'itemKey must be unique' });
      seen.add(it.itemKey);
    });
  });

module.exports = { z, text, url, mediaRef, itemKey, button, items };
