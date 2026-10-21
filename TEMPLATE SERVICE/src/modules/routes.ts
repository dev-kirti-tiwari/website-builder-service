import express from 'express';
import { etagOf, idParam, ifMatchRevision, ok, parseBody, parseQuery, wrap } from '../lib/http';
import type { Logger } from '../lib/logger';
import { authorize } from '../middleware/authorize';
import { getCtx } from '../types';
import { ApplicationService, applyTemplateSchema } from './applications/application.service';
import { CatalogService } from './catalog/catalog.service';
import { createTemplateSchema, listTemplatesQuerySchema, updateTemplateSchema } from './templates/template.schemas';
import { TemplateService } from './templates/template.service';
import { VersionService, createVersionSchema } from './versions/version.service';

export type Services = {
  templates: TemplateService;
  versions: VersionService;
  catalog: CatalogService;
  applications: ApplicationService;
};

/** All /api/v1 routes (authentication + trusted context are applied by the caller). */
export function apiRoutes(s: Services, logger: Logger) {
  const r = express.Router();
  const can = (p: Parameters<typeof authorize>[0]) => authorize(p, logger);

  // ---- catalog ----
  r.get('/templates', can('template:read'), wrap(async (req, res) => {
    const out = await s.templates.list(getCtx(res), parseQuery(listTemplatesQuerySchema, req.query));
    ok(res, out.items, 200, { pagination: out.pagination });
  }));

  r.post('/templates', can('template:create'), wrap(async (req, res) => {
    const t = await s.templates.create(getCtx(res), parseBody(createTemplateSchema, req.body));
    res.setHeader('ETag', etagOf(t.revision));
    res.setHeader('Location', `/api/v1/templates/${t.id}`);
    ok(res, t, 201);
  }));

  r.get('/templates/:templateId', can('template:read'), wrap(async (req, res) => {
    const t = await s.templates.get(getCtx(res), idParam(req, 'templateId'));
    res.setHeader('ETag', etagOf(t.revision));
    ok(res, t);
  }));

  r.patch('/templates/:templateId', can('template:update'), wrap(async (req, res) => {
    const t = await s.templates.update(getCtx(res), idParam(req, 'templateId'), parseBody(updateTemplateSchema, req.body), ifMatchRevision(req));
    res.setHeader('ETag', etagOf(t.revision));
    ok(res, t);
  }));

  r.post('/templates/:templateId/archive', can('template:archive'), wrap(async (req, res) => {
    ok(res, await s.templates.archive(getCtx(res), idParam(req, 'templateId')));
  }));

  // ---- versions ----
  r.get('/templates/:templateId/versions', can('template:version:read'), wrap(async (req, res) => {
    ok(res, await s.versions.list(getCtx(res), idParam(req, 'templateId')));
  }));

  r.post('/templates/:templateId/versions', can('template:version:create'), wrap(async (req, res) => {
    ok(res, await s.versions.create(getCtx(res), idParam(req, 'templateId'), parseBody(createVersionSchema, req.body)), 201);
  }));

  r.get('/templates/:templateId/versions/:versionId', can('template:version:read'), wrap(async (req, res) => {
    ok(res, await s.versions.get(getCtx(res), idParam(req, 'templateId'), idParam(req, 'versionId')));
  }));

  const transition = (path: string, action: 'submit' | 'approve' | 'publish' | 'deprecate', perm: Parameters<typeof authorize>[0]) =>
    r.post(`/templates/:templateId/versions/:versionId/${path}`, can(perm), wrap(async (req, res) => {
      ok(res, await s.versions.transition(getCtx(res), idParam(req, 'templateId'), idParam(req, 'versionId'), action));
    }));
  transition('submit-review', 'submit', 'template:review:submit');
  transition('approve', 'approve', 'template:review:approve');
  transition('publish', 'publish', 'template:publish');
  transition('deprecate', 'deprecate', 'template:version:admin');

  // ---- categories / tags ----
  r.get('/categories', can('template:read'), wrap(async (_req, res) => ok(res, await s.catalog.categories())));
  r.get('/tags', can('template:read'), wrap(async (_req, res) => ok(res, await s.catalog.tags(getCtx(res)))));

  // ---- apply ----
  r.post('/templates/:templateId/apply', can('template:apply'), wrap(async (req, res) => {
    const ctx = getCtx(res);
    const { application, isNew } = await s.applications.accept(
      ctx,
      idParam(req, 'templateId'),
      parseBody(applyTemplateSchema, req.body),
      req.header('idempotency-key'),
    );
    if (isNew) {
      // Respond 202 first; processing is resumable by the reconciler if this process dies.
      setImmediate(() => s.applications.process(application.id).catch((e) => logger.error('apply_process_error', { applicationId: application.id, error: String(e) })));
    }
    ok(res, { applicationId: application.id, status: application.status, statusUrl: `/api/v1/template-applications/${application.id}` }, 202);
  }));

  r.get('/template-applications/:applicationId', can('template:apply:read'), wrap(async (req, res) => {
    ok(res, await s.applications.getStatus(getCtx(res), idParam(req, 'applicationId')));
  }));

  return r;
}
