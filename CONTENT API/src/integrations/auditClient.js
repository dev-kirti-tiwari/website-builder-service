'use strict';
const env = require('../config/env');
const logger = require('../utils/logger');

/**
 * Fire-and-forget audit event to the existing Audit service. Never blocks or fails the request.
 * Metadata is IDs only - never the content body.
 */
function emit(event, meta) {
  const payload = { event, ...meta, timestamp: new Date().toISOString() };
  if (!env.audit.baseUrl) {
    logger.info({ audit: payload }, 'audit event (no AUDIT_BASE_URL configured)');
    return;
  }
  fetch(env.audit.baseUrl.replace(/\/$/, '') + env.audit.eventsPath, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Service-Token': env.internalServiceToken,
      'X-Request-Id': meta.requestId,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(3000),
  }).catch((err) => logger.warn({ requestId: meta.requestId, err: err.message, event }, 'audit delivery failed'));
}

module.exports = { emit };
