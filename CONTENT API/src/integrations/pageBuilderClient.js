'use strict';
const env = require('../config/env');
const logger = require('../utils/logger');
const { ApiError, E } = require('../utils/errors');

/**
 * Trusted internal lookup used on create/duplicate only (report section 12.1).
 * Expected response: { data: { id, pageId, workspaceId?, type } } (or the bare object).
 * Returns null when verification is disabled.
 */
async function getSection({ sectionId, workspaceId, requestId }) {
  if (!env.pageBuilder.enabled) return null;
  const path = env.pageBuilder.sectionPath.replace('{sectionId}', encodeURIComponent(sectionId));
  const url = env.pageBuilder.baseUrl.replace(/\/$/, '') + path;
  let res;
  try {
    res = await fetch(url, {
      headers: {
        'X-Internal-Service-Token': env.internalServiceToken,
        'X-Workspace-Id': workspaceId,
        'X-Request-Id': requestId,
      },
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    logger.error({ requestId, err: err.message }, 'page builder unreachable');
    throw new ApiError(502, 'UPSTREAM_UNAVAILABLE', 'Page Builder is unavailable');
  }
  if (res.status === 404 || res.status === 403) throw E.sectionNotFound();
  if (!res.ok) throw new ApiError(502, 'UPSTREAM_UNAVAILABLE', 'Page Builder returned an error');
  const json = await res.json().catch(() => ({}));
  const s = json.data || json;
  if (s.workspaceId !== undefined && String(s.workspaceId) !== String(workspaceId)) throw E.sectionNotFound();
  return {
    id: String(s.id ?? sectionId),
    pageId: s.pageId === undefined ? null : String(s.pageId),
    type: s.type ?? s.sectionType,
  };
}

module.exports = { getSection };
