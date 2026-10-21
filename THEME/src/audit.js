'use strict';

/**
 * Audit events are emitted only AFTER the database transaction commits and never affect the
 * request outcome (policy: best-effort, at-most-once). They are always written to the structured
 * log (`audit: true`); if AUDIT_SERVICE_URL is configured they are also POSTed there.
 * A transactional outbox is intentionally not part of V1.
 */
function createAudit(config, logger) {
  const log = logger.child({ audit: true });

  function emit(action, ctx, theme, extra = {}) {
    const event = {
      action, // THEME_CREATED | THEME_UPDATED | THEME_ACTIVATED | THEME_DUPLICATED | THEME_ARCHIVED
      themeId: theme.id,
      workspaceId: theme.workspace_id,
      actorId: ctx.userId,
      requestId: ctx.requestId,
      version: theme.version,
      occurredAt: new Date().toISOString(),
      ...extra,
    };
    log.info({ event }, 'audit');
    if (config.AUDIT_SERVICE_URL) {
      fetch(config.AUDIT_SERVICE_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(config.AUDIT_SERVICE_TOKEN ? { authorization: `Bearer ${config.AUDIT_SERVICE_TOKEN}` } : {}),
        },
        body: JSON.stringify(event),
        signal: AbortSignal.timeout(3000),
      }).catch((err) => log.warn({ err: { message: err.message }, action, themeId: theme.id }, 'Audit delivery failed'));
    }
  }

  return { emit };
}

module.exports = { createAudit };
