'use strict';

class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const E = {
  badRequest: (msg = 'Malformed request', details) => new ApiError(400, 'BAD_REQUEST', msg, details),
  workspaceRequired: () => new ApiError(400, 'WORKSPACE_REQUIRED', 'X-Workspace-Id header is required'),
  authRequired: () => new ApiError(401, 'AUTHORIZATION_REQUIRED', 'Authorization: Bearer <token> header is required'),
  invalidToken: () => new ApiError(401, 'INVALID_TOKEN', 'Token is invalid or expired'),
  forbidden: (msg = 'You do not have permission to perform this action') => new ApiError(403, 'FORBIDDEN', msg),
  contentNotFound: () => new ApiError(404, 'CONTENT_NOT_FOUND', 'Content not found'),
  sectionNotFound: () => new ApiError(404, 'SECTION_NOT_FOUND', 'Section not found'),
  revisionNotFound: () => new ApiError(404, 'REVISION_NOT_FOUND', 'Revision not found'),
  revisionConflict: (currentRevision) =>
    new ApiError(409, 'CONTENT_REVISION_CONFLICT', 'Content was modified by someone else; reload and retry', { currentRevision }),
  alreadyExists: () => new ApiError(409, 'CONTENT_ALREADY_EXISTS', 'Content already exists for this section'),
  schemaInvalid: (details) => new ApiError(422, 'CONTENT_SCHEMA_INVALID', 'Content failed schema validation', details),
  sectionTypeMismatch: (msg = 'Content type does not match the section type') => new ApiError(422, 'SECTION_TYPE_MISMATCH', msg),
  invalidLink: (details) => new ApiError(422, 'INVALID_LINK', 'Content contains an invalid or unsafe link', details),
  invalidMedia: (details) => new ApiError(422, 'INVALID_MEDIA_REFERENCE', 'Content contains an invalid media reference', details),
  tooLarge: () => new ApiError(413, 'CONTENT_PAYLOAD_TOO_LARGE', 'Request body exceeds the configured limit'),
  unsupportedMedia: () => new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json'),
  rateLimited: () => new ApiError(429, 'RATE_LIMITED', 'Too many requests'),
  internal: () => new ApiError(500, 'INTERNAL_ERROR', 'Unexpected error'),
};

module.exports = { ApiError, E };
