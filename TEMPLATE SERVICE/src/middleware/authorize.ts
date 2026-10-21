import type { NextFunction, Request, Response } from 'express';
import { forbidden } from '../lib/errors';
import type { Logger } from '../lib/logger';
import { getCtx, hasPermission } from '../types';

export type Permission =
  | 'template:read'
  | 'template:create'
  | 'template:update'
  | 'template:archive'
  | 'template:version:read'
  | 'template:version:create'
  | 'template:version:admin'
  | 'template:review:submit'
  | 'template:review:approve'
  | 'template:publish'
  | 'template:apply'
  | 'template:apply:read'
  | 'template:global:admin';

export function authorize(permission: Permission, logger: Logger) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ctx = getCtx(res);
    if (!hasPermission(ctx, permission)) {
      logger.warn('permission_denied', {
        requestId: ctx.requestId,
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        permission,
        route: req.path,
      });
      return next(forbidden());
    }
    next();
  };
}
