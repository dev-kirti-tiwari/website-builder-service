import { timingSafeEqual } from 'node:crypto';
import type { Request, RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import type { Config } from '../config';
import { AppError } from '../shared/errors';
import type { Actor } from '../shared/types';

const numericId = z.string().regex(/^[1-9]\d{0,17}$/);

const claimsSchema = z.object({
  sub: numericId,
  tenant_id: numericId,
  organization_id: numericId,
  roles: z.array(z.string().max(64)).max(20).default([]),
});

const unauthenticated = () => new AppError(401, 'UNAUTHENTICATED', 'Missing or invalid credential');

function bearer(req: Request): string {
  const m = /^Bearer\s+(\S+)$/i.exec(req.header('authorization') ?? '');
  if (!m) throw unauthenticated();
  return m[1];
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/**
 * Builds the trusted actor context.
 *
 * direct-jwt:       Bearer is a user JWT verified here (HS256 only, issuer, audience, exp, nbf).
 *                   Tenant/org/user come ONLY from verified claims. Context headers, if sent,
 *                   must match the claims or the call is rejected (spoofing guard).
 * gateway-context:  Bearer is the internal service credential; the BFF/gateway has already
 *                   verified the user and injects X-Tenant-Id / X-Organization-Id / X-User-Id.
 *                   The network ingress must be private in this mode.
 */
export function authenticate(config: Config): RequestHandler {
  return (req, _res, next) => {
    const token = bearer(req);
    const softwareId = req.header('x-software-id')?.slice(0, 64);

    if (config.AUTH_MODE === 'direct-jwt') {
      let payload: unknown;
      try {
        payload = jwt.verify(token, config.JWT_SECRET!, {
          algorithms: ['HS256'],
          issuer: config.JWT_ISSUER,
          audience: config.JWT_AUDIENCE,
          clockTolerance: 5,
        });
      } catch {
        throw unauthenticated();
      }
      const claims = claimsSchema.safeParse(payload);
      if (!claims.success) throw unauthenticated();

      const expected: Array<[string, string]> = [
        ['x-tenant-id', claims.data.tenant_id],
        ['x-organization-id', claims.data.organization_id],
        ['x-user-id', claims.data.sub],
      ];
      for (const [header, value] of expected) {
        const sent = req.header(header);
        if (sent !== undefined && sent !== value) {
          throw new AppError(403, 'CONTEXT_MISMATCH', `${header} does not match the authenticated identity`);
        }
      }
      req.actor = {
        userId: claims.data.sub,
        tenantId: claims.data.tenant_id,
        organizationId: claims.data.organization_id,
        roles: claims.data.roles,
        softwareId,
      } satisfies Actor;
      return next();
    }

    if (!safeEqual(token, config.INTERNAL_SERVICE_TOKEN!)) throw unauthenticated();
    const ctx = z
      .object({ tenant: numericId, org: numericId, user: numericId })
      .safeParse({
        tenant: req.header('x-tenant-id'),
        org: req.header('x-organization-id'),
        user: req.header('x-user-id'),
      });
    if (!ctx.success) {
      throw new AppError(400, 'INVALID_CONTEXT', 'X-Tenant-Id, X-Organization-Id and X-User-Id are required');
    }
    const roles = (req.header('x-user-roles') ?? '')
      .split(',')
      .map((r) => r.trim())
      .filter(Boolean)
      .slice(0, 20);
    req.actor = {
      userId: ctx.data.user,
      tenantId: ctx.data.tenant,
      organizationId: ctx.data.org,
      roles,
      softwareId,
    };
    next();
  };
}

export function requireActor(req: Request): Actor {
  if (!req.actor) throw unauthenticated();
  return req.actor;
}
