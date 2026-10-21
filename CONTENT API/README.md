# Content API Service

> Source of truth for the **content inside Page Builder sections** — text, links, media references, features,
> testimonials, pricing copy, FAQ, CTA and form-section copy — with validation, autosave, revision history,
> restore and duplication.

Part of the *Independent Website Builder*. **Page Builder = HOW the page is built. Content API = WHAT the section says.**

| | |
|---|---|
| Runtime | Node.js 22+, Express 4 |
| Storage | PostgreSQL 16 (`BIGINT` ids, `JSONB` content) |
| Validation | Zod (strict, one schema per section type) |
| Auth | BRR/JWT in `Authorization: Bearer <token>` |
| Isolation | Workspace (`X-Workspace-Id`) |
| Logging | Pino (secrets and content bodies redacted) |

## Table of contents

1. [Quick start](#quick-start)
2. [Configuration](#configuration)
3. [Authentication and authorization](#authentication-and-authorization)
4. [API reference](#api-reference)
5. [Section content schemas](#section-content-schemas)
6. [Autosave and revisions](#autosave-and-revisions)
7. [Errors](#errors)
8. [Testing with Postman](#testing-with-postman)
9. [Project structure](#project-structure)
10. [Design decisions](#design-decisions)
11. [Out of scope](#out-of-scope)

## Quick start

### With Docker (recommended)

```bash
cp .env.example .env            # then replace every "replace_with_secret" placeholder
docker compose up -d --build    # Postgres + one-shot migrations + API
curl http://localhost:4080/ready
```

This starts three services in the `content-api` Compose project:

| Service | Purpose | Port |
|---|---|---|
| `db` | PostgreSQL 16 with a persistent volume and health check | `5435` → 5432 |
| `migrate` | Runs `database/migrations/*.sql` once, then exits | – |
| `api` | The Content API (starts only after migrations succeed) | `4080` |

Stop with `docker compose down` (add `-v` to also delete the database volume).

### On the host

```bash
docker compose up -d db         # Postgres on localhost:5435
npm install
npm run migrate
npm start                       # or: npm run dev   (auto-reload)
```

### Scripts

| Command | What it does |
|---|---|
| `npm start` / `npm run dev` | Start the API (dev mode watches for changes) |
| `npm run migrate` | Apply pending SQL migrations (forward-only, advisory-locked) |
| `npm test` | Unit tests (schemas, URL policy, merge-patch, id parsing) |
| `npm run token -- <sub> <workspaces> <perms>` | Mint a local JWT, e.g. `npm run token -- 9001 1001,1002 "content:*"` |
| `npm run postman:env` | Write a git-ignored Postman environment containing working tokens |
| `npm run postman:test` | Run the full Postman collection with newman against the live API |

## Configuration

Copy `.env.example` to `.env`. **`.env` is git-ignored — never commit it.**

| Variable | Purpose |
|---|---|
| `PORT`, `NODE_ENV`, `LOG_LEVEL` | Runtime basics |
| `POSTGRES_USER/PASSWORD/DB/HOST_PORT` | Database used by Docker Compose |
| `DATABASE_URL` | Connection string when running on the host (Compose builds its own) |
| `JWT_SECRET` *or* `JWT_PUBLIC_KEY` | Verify BRR/JWT (HS256, or RS256/ES256). Optional `JWT_ISSUER`, `JWT_AUDIENCE` |
| `INTERNAL_SERVICE_TOKEN` | Secret for trusted internal callers (`X-Internal-Service-Token`) |
| `CORS_ORIGINS` | Comma-separated allowed origins |
| `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX` | Rate limit (tune so normal autosave is never blocked) |
| `BODY_LIMIT` | Max request body (default `512kb` → `413`) |
| `PAGE_BUILDER_VALIDATION` | `enabled` / `disabled` — verify section exists and type matches on create/duplicate |
| `PAGE_BUILDER_BASE_URL`, `PAGE_BUILDER_SECTION_PATH` | Page Builder internal section lookup |
| `MEDIA_VALIDATION`, `MEDIA_BASE_URL` | Optional remote media existence check |
| `AUDIT_BASE_URL`, `AUDIT_EVENTS_PATH` | Audit service; events are only logged locally when unset |

## Authentication and authorization

Every protected request sends:

```http
Authorization: Bearer <BRR/JWT>
X-Workspace-Id: 1001
X-Request-Id: req_001          # optional; generated if missing and echoed back
Content-Type: application/json
```

* The token proves **identity**; the service additionally checks that `X-Workspace-Id` is one of the workspaces in
  the token. A workspace id in a request body is never trusted.
* Every query is scoped by `workspace_id`. Another workspace's content looks like `404`, never `403`/data.
* Expected token claims: `sub` (actor id), `workspaces` (array) and `permissions` (array).

| Permission | Allows |
|---|---|
| `content:read` | GET content, bulk page read, revision list |
| `content:edit` | Create, PUT, PATCH |
| `content:delete` | Soft delete |
| `content:restore` | Restore a revision |
| `content:*` | Everything above |

**Internal calls** (BFF / other services) use `X-Internal-Service-Token` plus `X-Workspace-Id` instead of a user JWT.
Only `POST /api/v1/internal/content/duplicate` accepts it.

> The report says to reuse the existing BRR/JWT verification. The claim names above are an assumption — adapt
> `src/middleware/authentication.js` to the real issuer.

## API reference

Full contract: [`docs/openapi.yaml`](docs/openapi.yaml). All BIGINT ids are returned as **strings**.

| Method | Endpoint | Permission | Purpose |
|---|---|---|---|
| `POST` | `/api/v1/sections/:sectionId/content` | edit | Create content for a section |
| `GET` | `/api/v1/sections/:sectionId/content` | read | Get current content |
| `PUT` | `/api/v1/sections/:sectionId/content` | edit | Replace the whole document |
| `PATCH` | `/api/v1/sections/:sectionId/content` | edit | Partial update (JSON Merge Patch) |
| `DELETE` | `/api/v1/sections/:sectionId/content[?expectedRevision=n]` | delete | Soft delete |
| `GET` | `/api/v1/pages/:pageId/content` | read | Bulk read for the BFF/editor/preview |
| `GET` | `/api/v1/sections/:sectionId/content/revisions?limit=&offset=` | read | Revision metadata, newest first |
| `POST` | `/api/v1/sections/:sectionId/content/revisions/:revision/restore` | restore | Restore an old snapshot as a **new** revision |
| `POST` | `/api/v1/internal/content/duplicate` | internal token | Copy content to new target sections |
| `GET` | `/health` | – | Liveness |
| `GET` | `/ready` | – | Readiness (checks PostgreSQL) |

### Example: create, then autosave

```http
POST /api/v1/sections/3001/content
{
  "pageId": "2001",
  "sectionType": "hero",
  "content": { "heading": "Build Websites", "primaryButton": { "label": "Get Started", "url": "/signup" } }
}
```

```http
PATCH /api/v1/sections/3001/content
{
  "expectedRevision": 1,
  "content": { "heading": "Build Better Websites", "subheading": null }
}
```

```json
{
  "success": true,
  "data": {
    "id": "7001", "pageId": "2001", "sectionId": "3001", "sectionType": "hero",
    "schemaVersion": 1, "revision": 2,
    "content": { "heading": "Build Better Websites", "primaryButton": { "label": "Get Started", "url": "/signup" } }
  },
  "meta": { "requestId": "req_001" }
}
```

**PATCH semantics** are JSON Merge Patch (RFC 7396): objects merge recursively, arrays and scalars are replaced,
`null` removes a key. The merged document is validated in full before it is saved.

### Duplicate (internal)

```http
POST /api/v1/internal/content/duplicate
X-Internal-Service-Token: <secret>
X-Workspace-Id: 1001
{ "mappings": [ { "sourceSectionId": "3001", "targetSectionId": "3050" } ] }
```

Creates a brand-new, independent row (new id, revision 1) per mapping, all in one transaction.

## Section content schemas

Supported types: `hero`, `features`, `images`, `testimonials`, `pricing`, `faq`, `cta`, `form`. Unknown keys are
rejected. Repeated items need a stable, unique `itemKey`.

| Type | Fields |
|---|---|
| `hero` | `heading`*, `subheading`, `description`, `mediaId`, `primaryButton`, `secondaryButton` |
| `features` | `heading`*, `description`, `items[]` (`itemKey`, `title`, `description`, `iconMediaId`) |
| `images` | `heading`, `items[]` (`itemKey`, `mediaId`, `alt`, `title`, `caption`) |
| `testimonials` | `heading`, `items[]` (`itemKey`, `quote`, `author`, `role`, `company`, `avatarMediaId`) |
| `pricing` | `heading`*, `description`, `plans[]` (`itemKey`, `name`, `displayPrice`, `currency`, `billingLabel`, `description`, `features[]`, `button`) |
| `faq` | `heading`*, `items[]` (`itemKey`, `question`, `answer`) |
| `cta` | `heading`*, `description`, `primaryButton`, `secondaryButton` |
| `form` | `heading`*, `description`, `helperText` — copy only; fields/submissions belong to the Form Service |

`*` required. A button is `{ "label", "url" }`.

**Safety rules**

* Text is trimmed, length-limited, never whitespace-only, and may not contain HTML tags or `javascript:` content.
* URLs must be a relative path (`/signup`, `#top`) or `https://…`. `javascript:`, `data:`, `http:`, `//host`,
  and anything else is rejected with `INVALID_LINK`.
* `mediaId` must be a numeric string; the media binary itself lives in the Media service.

## Autosave and revisions

* Every content row has its own `revision` (editing Hero never conflicts with editing FAQ).
* Mutations require `expectedRevision`. If it is stale the service answers **`409 CONTENT_REVISION_CONFLICT`**
  with `error.details.currentRevision`, and nothing is overwritten.
* Each successful mutation updates the row **and** inserts an immutable snapshot in one transaction.
  Snapshots cannot be updated or deleted (enforced by a database trigger).
* Restoring revision *N* creates a **new** current revision with that content. History is never rewritten.
* Delete is a soft delete (`deleted_at`); creating content for the same section afterwards starts a fresh row at
  revision 1.

## Errors

```json
{ "success": false, "error": { "code": "CONTENT_REVISION_CONFLICT", "message": "…", "details": { "currentRevision": 8 } },
  "meta": { "requestId": "req_001" } }
```

| HTTP | Codes |
|---|---|
| 400 | `BAD_REQUEST`, `WORKSPACE_REQUIRED` |
| 401 | `AUTHORIZATION_REQUIRED`, `INVALID_TOKEN` |
| 403 | `FORBIDDEN` |
| 404 | `CONTENT_NOT_FOUND`, `SECTION_NOT_FOUND`, `REVISION_NOT_FOUND`, `NOT_FOUND` |
| 409 | `CONTENT_REVISION_CONFLICT`, `CONTENT_ALREADY_EXISTS` |
| 413 | `CONTENT_PAYLOAD_TOO_LARGE` |
| 415 | `UNSUPPORTED_MEDIA_TYPE` |
| 422 | `CONTENT_SCHEMA_INVALID`, `SECTION_TYPE_MISMATCH`, `INVALID_LINK`, `INVALID_MEDIA_REFERENCE` |
| 429 | `RATE_LIMITED` |
| 500 / 502 | `INTERNAL_ERROR` / `UPSTREAM_UNAVAILABLE` |

Stack traces, SQL errors and secrets are never returned to clients.

## Testing with Postman

| File | Notes |
|---|---|
| `postman/Content-API.postman_collection.json` | 97 requests, 299 assertions |
| `postman/Content-API-Local.postman_environment.json` | Committed, **secrets left empty** |
| `postman/Content-API-Local.postman_environment.local.json` | Generated by `npm run postman:env`, **git-ignored**, contains working tokens — import this one |

Folders: Health & Readiness · Content CRUD · Section types · Bulk Page Content · Autosave & Concurrency ·
Revisions & Restore · Duplication · Authorization & Workspace Isolation · Validation & Security · Soft Delete.

Run the folders in order — the first request (`GET /health`) generates fresh ids for the run. To run everything from
the terminal: `npm run postman:test`. After changing the collection source, regenerate the committed files with
`node scripts/build-postman.js`.

## Project structure

```
src/
  app.js, server.js
  config/            env + database pool
  middleware/        requestId, logging, rate limit, authentication, workspace, authorization, errors
  modules/content/   routes → controller → service → repository (+ content.schema.js, contentSchemas/*)
  integrations/      pageBuilderClient, mediaClient, auditClient
  utils/             errors, ids, logger, asyncHandler
database/migrations/ forward-only SQL migrations
scripts/             migrate, token + Postman tooling
tests/unit/          unit tests
postman/             collection + environments
docs/                openapi.yaml, DECISIONS.md
```

## Design decisions

The decisions the report left open (permission names, PATCH semantics, limits, URL schemes, restore behaviour, …) are
recorded in [`docs/DECISIONS.md`](docs/DECISIONS.md). Highlights: workspace-only isolation (no `tenant_id`), no
Redis/queues, soft delete instead of a status column, audit delegated to the existing Audit service.

## Out of scope

Page structure/layout (Page Builder), media upload/storage (Media service), form fields and submissions (Form
service), authentication lifecycle, and publishing/domains.
