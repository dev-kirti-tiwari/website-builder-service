import type { RequestHandler } from 'express';
import { AppError } from '../shared/errors';
import { requireActor } from './authentication';

export type Permission =
  | 'form:read'
  | 'form:write'
  | 'form:publish'
  | 'form:delete'
  | 'submission:read'
  | 'submission:write'
  | 'automation:read'
  | 'automation:write';

/**
 * Role names are an assumption (the platform's real role source is not specified in the
 * report). Map them here, or replace this table with the platform's permission source.
 */
export const ROLE_PERMISSIONS: Record<string, readonly Permission[]> = {
  form_admin: [
    'form:read', 'form:write', 'form:publish', 'form:delete',
    'submission:read', 'submission:write', 'automation:read', 'automation:write',
  ],
  form_editor: ['form:read', 'form:write', 'submission:read', 'submission:write', 'automation:read'],
  form_viewer: ['form:read', 'submission:read', 'automation:read'],
};

export function hasPermission(roles: readonly string[], permission: Permission): boolean {
  return roles.some((r) => ROLE_PERMISSIONS[r]?.includes(permission));
}

export const requirePermission =
  (permission: Permission): RequestHandler =>
  (req, _res, next) => {
    const actor = requireActor(req);
    if (!hasPermission(actor.roles, permission)) {
      throw new AppError(403, 'FORBIDDEN', 'You do not have permission to perform this action');
    }
    next();
  };
