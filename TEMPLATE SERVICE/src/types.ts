import type { Response } from 'express';

export type RequestContext = {
  tenantId: string; // validated BIGINT decimal string
  organizationId: string; // validated BIGINT decimal string
  userId: string; // actor ID supplied by the trusted BFF
  softwareId?: string; // validated caller/product ID
  requestId: string;
  permissions: string[];
};

export function getCtx(res: Response): RequestContext {
  return res.locals.ctx as RequestContext;
}

export const hasPermission = (ctx: RequestContext, permission: string) =>
  ctx.permissions.includes(permission) || ctx.permissions.includes('*');

/** Global-catalog administration: create/modify GLOBAL-scope templates, see unlisted/private global items. */
export const isGlobalAdmin = (ctx: RequestContext) => hasPermission(ctx, 'template:global:admin');
