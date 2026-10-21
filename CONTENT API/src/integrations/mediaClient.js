'use strict';
const env = require('../config/env');
const logger = require('../utils/logger');
const { E } = require('../utils/errors');

const collectMediaIds = (node, out = new Set()) => {
  if (Array.isArray(node)) node.forEach((n) => collectMediaIds(n, out));
  else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (/^mediaId$|MediaId$/.test(k) && typeof v === 'string') out.add(v);
      else collectMediaIds(v, out);
    }
  }
  return out;
};

/** Optional remote existence check (MEDIA_VALIDATION=enabled). Local format validation always runs in the schemas. */
async function assertMediaExist(content, { workspaceId, requestId }) {
  if (!env.media.enabled) return;
  for (const id of collectMediaIds(content)) {
    let res;
    try {
      res = await fetch(`${env.media.baseUrl.replace(/\/$/, '')}/api/v1/media/${id}`, {
        headers: {
          'X-Internal-Service-Token': env.internalServiceToken,
          'X-Workspace-Id': workspaceId,
          'X-Request-Id': requestId,
        },
        signal: AbortSignal.timeout(3000),
      });
    } catch (err) {
      logger.warn({ requestId, err: err.message }, 'media service unreachable; skipping existence check');
      return;
    }
    if (res.status === 404) throw E.invalidMedia([{ path: 'mediaId', message: `media ${id} does not exist` }]);
  }
}

module.exports = { assertMediaExist };
