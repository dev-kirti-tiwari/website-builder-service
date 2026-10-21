# Theme API

Independent backend service of the **Independent Website Builder** that stores, validates and serves
reusable **visual design configurations** (themes): semantic colors, backgrounds, typography,
spacing, radius, shadows, button appearance, layout defaults and responsive values.

It does **not** own page structure, page/website templates, content, media storage, forms, hosting
or deployment. *Rule of thumb: "how should the website look globally?" belongs here; "which pages,
sections or content exist?" belongs to another service.*

| | |
|---|---|
| Runtime | Node.js 24 (works on >= 22), JavaScript (CommonJS), Express 5 |
| Database | PostgreSQL 16, `JSONB` config, plain SQL migrations |
| Validation | Zod 4 (strict schemas) + semantic validator (token references, gradients, contrast warnings) |
| Logging | Pino + pino-http (credentials redacted) + audit events |
| Security | JWT (HS256), Helmet, CORS allowlist, rate limiting, body-size limits |
| Ops | Docker / Compose, `/health`, `/ready`, versioned migrations |
| Tests | 34 automated tests (`node:test`) + 89-request / 274-assertion Postman collection (Newman) |

---

## Quick start (Docker)

```bash
cp .env.example .env          # then edit: set POSTGRES_PASSWORD and a JWT_SECRET (>= 32 chars)
docker compose up -d --build  # starts PostgreSQL + the API, runs migrations automatically
curl http://localhost:4065/health   # {"status":"ok"}
curl http://localhost:4065/ready    # {"status":"ready"}
```

- API: `http://localhost:4065` (container port 4065)
- PostgreSQL is exposed on host port **5433** (not 5432, to avoid clashing with a local Postgres).
- Stop: `docker compose down` (keep data) / `docker compose down -v` (wipe the database volume).
- Logs: `docker compose logs -f api`

### Run on the host instead

```bash
docker compose up -d db       # just the database
npm install
npm run migrate               # idempotent
npm start                     # or: npm run dev   (auto-reload)
```

`DATABASE_URL` in `.env` points at `localhost:5433` for host runs; Compose overrides it with the
internal `db` hostname for the container.

---

## Configuration (`.env`)

`.env` is **git-ignored**; `.env.example` is the committed template. The service refuses to start on
invalid configuration.

| Variable | Default | Purpose |
|---|---|---|
| `NODE_ENV` | `development` | `development` / `test` / `production` |
| `PORT` | `4065` | HTTP port (proposed by the spec; confirm against platform standards) |
| `LOG_LEVEL` | `info` | pino level (`silent` to mute) |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | `theme` / *required* / `theme_api` | Compose database credentials |
| `POSTGRES_HOST_PORT` | `5433` | Host port mapped to Postgres |
| `DATABASE_URL` | *required* | Connection string used by the API |
| `DB_POOL_MAX` | `10` | pg pool size |
| `JWT_SECRET` | *required, >= 32 chars* | HS256 secret shared with the Auth service |
| `JWT_ISSUER` / `JWT_AUDIENCE` | unset | If set, enforced when verifying tokens |
| `INTERNAL_SERVICE_TOKEN` | unset | If set, `X-Internal-Service-Token` becomes mandatory (BFF-to-service) |
| `CORS_ORIGINS` | empty | Comma-separated browser origin allowlist |
| `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX` | `60000` / `300` | Per-IP rate limit |
| `THEME_MAX_CONFIG_BYTES` | `262144` | Max serialized theme config size |
| `AUDIT_SERVICE_URL` / `AUDIT_SERVICE_TOKEN` | unset | Optional audit sink (events are always logged) |

> The earlier report listed both `BRR_TOKEN` and `JWT_SECRET`. Only `JWT_SECRET` exists here: the
> "Bearer/BRR" wording was ambiguous and the report said not to keep unused secret variables.

---

## Authentication & workspace authorization

Every `/api/v1/*` request carries the token **in headers**:

| Header | Required | Meaning |
|---|---|---|
| `Authorization: Bearer <JWT>` | yes | HS256 JWT signed with `JWT_SECRET`. Identifies the caller. |
| `X-Workspace-Id: <id>` | yes | Workspace the call targets. **Not** proof of access, it is checked against the token. |
| `X-Request-Id: <id>` | no | Correlation id (8-128 chars `A-Za-z0-9._-`); generated if absent; echoed back. |
| `X-Internal-Service-Token` | only if `INTERNAL_SERVICE_TOKEN` is set | BFF-to-service secret. |
| `If-Match: "<version>"` | optional alternative to `expectedVersion` | Optimistic locking. |

### JWT claims

```json
{
  "sub": "1001",
  "workspaces": [ { "id": "1", "role": "admin" }, { "id": "2", "role": "viewer" } ],
  "iat": 1790000000,
  "exp": 1790003600
}
```

- `sub` = numeric user id (the **actor**; request bodies can never set it).
- `workspaces[]` = the caller's memberships. Roles: `viewer` < `editor` < `admin` < `owner`.
- Only `HS256` is accepted (`alg: none` and other algorithms are rejected). Expiry is enforced.

> **Assumption to confirm.** No existing Auth contract was available to inspect, so this claim shape
> (`sub`, `workspaces[{id, role}]`) is my implementation of the documented "JWT/Bearer +
> `X-Workspace-Id`" pattern. If the platform Auth service issues different claims, only
> [src/middleware/auth.js](src/middleware/auth.js) needs to change.

### Role matrix

| Action | Minimum role |
|---|---|
| List, get, validate | `viewer` |
| Create, update (PATCH), duplicate | `editor` |
| Activate, archive | `admin` |

### Generate a development token

```bash
npm run token -- --sub 1001 --workspaces 1:admin,2:viewer --expires 8h
```

### Auth error behaviour

| Situation | Response |
|---|---|
| No / malformed `Authorization` | `401 UNAUTHENTICATED` |
| Bad signature, garbage, `alg: none` | `401 INVALID_TOKEN` |
| Expired | `401 TOKEN_EXPIRED` |
| Missing `X-Workspace-Id` | `400 WORKSPACE_REQUIRED` (non-numeric: `400 INVALID_WORKSPACE_ID`) |
| Workspace not in the token | `403 WORKSPACE_FORBIDDEN` |
| Role too low | `403 INSUFFICIENT_ROLE` |
| Theme belongs to another workspace | `404 NOT_FOUND` (anti-enumeration: indistinguishable from "does not exist") |

---

## REST API

Base path `/api/v1`. JSON in, JSON out. IDs (`id`, `workspaceId`, `createdBy`, ...) are **strings**
(PostgreSQL `BIGINT`) to avoid JavaScript precision loss.

| Method | Endpoint | Role | Purpose |
|---|---|---|---|
| `POST` | `/themes` | editor | Create a `DRAFT` theme (config may be partial) |
| `GET` | `/themes` | viewer | List/search themes in the workspace (no `config` in items) |
| `GET` | `/themes/:id` | viewer | Metadata + full visual configuration |
| `PATCH` | `/themes/:id` | editor | Update name/description/config (merge) with version precondition |
| `POST` | `/themes/:id/validate` | viewer | Report all errors/warnings (activation-level check) |
| `POST` | `/themes/:id/activate` | admin | `DRAFT` -> `ACTIVE` after full validation |
| `POST` | `/themes/:id/duplicate` | editor | New `DRAFT` from the visual configuration only |
| `DELETE` | `/themes/:id` | admin | Soft archive (`ARCHIVED`) |
| `GET` | `/health` | none | Liveness |
| `GET` | `/ready` | none | Readiness (checks PostgreSQL) |

### Response envelopes

```jsonc
// success
{ "success": true, "data": { ... }, "meta": { "pagination": { ... } }, "requestId": "..." }
// error
{ "success": false, "error": { "code": "THEME_CONFIG_INVALID", "message": "...", "details": [ ... ] }, "requestId": "..." }
```

Mutating/reading a single theme also returns `ETag: "<version>"`; `201` responses include `Location`.

### Theme object

```json
{
  "id": "12", "workspaceId": "1", "name": "Ocean", "slug": "ocean", "description": null,
  "status": "DRAFT", "version": 1, "schemaVersion": 1,
  "config": { "schemaVersion": 1, "colors": { "primary": "#2563EB" } },
  "createdBy": "1001", "updatedBy": null,
  "createdAt": "2026-10-21T10:00:00.000Z", "updatedAt": "2026-10-21T10:00:00.000Z", "archivedAt": null
}
```

### Examples

```bash
TOKEN=$(npm run --silent token -- --sub 1001 --workspaces 1:admin)
H=(-H "Authorization: Bearer $TOKEN" -H "X-Workspace-Id: 1" -H "Content-Type: application/json")

# create
curl -s -X POST localhost:4065/api/v1/themes "${H[@]}" \
  -d '{"name":"Ocean","config":{"colors":{"primary":"#2563EB","background":"#FFFFFF"}}}'

# update (merge-patch; expectedVersion is required)
curl -s -X PATCH localhost:4065/api/v1/themes/12 "${H[@]}" \
  -d '{"expectedVersion":1,"config":{"colors":{"primary":"#1D4ED8"}}}'

# same update using If-Match instead of expectedVersion
curl -s -X PATCH localhost:4065/api/v1/themes/12 "${H[@]}" -H 'If-Match: "2"' -d '{"name":"Ocean v2"}'

# validate / activate / duplicate / archive
curl -s -X POST   localhost:4065/api/v1/themes/12/validate  "${H[@]}"
curl -s -X POST   localhost:4065/api/v1/themes/12/activate  "${H[@]}"
curl -s -X POST   localhost:4065/api/v1/themes/12/duplicate "${H[@]}" -d '{"name":"Ocean Dark"}'
curl -s -X DELETE localhost:4065/api/v1/themes/12           "${H[@]}"

# list: ?page=1&pageSize=20&status=DRAFT&search=ocean
curl -s "localhost:4065/api/v1/themes?pageSize=5&search=ocean" "${H[@]}"
```

(On Windows PowerShell, prefer the Postman collection; PowerShell's quoting mangles JSON passed to `curl.exe`.)

### List / pagination

`page` (default 1), `pageSize` (default 20, **max 100**), `status` (`DRAFT|ACTIVE|ARCHIVED`),
`search` (case-insensitive substring of name or slug; `%`/`_` are treated literally). Ordering is
fixed and stable: `created_at DESC, id DESC`. Without `status`, archived themes are hidden.

### PATCH semantics (JSON Merge Patch)

`config` in a PATCH is **merged** into the stored config: objects merge recursively, scalars and
arrays are **replaced** (e.g. gradient `stops`), `null` **deletes** a key. A small update never
erases unrelated configuration. `name` and `description` replace. The *merged result* is re-validated.
Unknown top-level fields (e.g. `createdBy`, `workspaceId`, `status`) are rejected with `400`.

### Concurrency

`PATCH` requires `expectedVersion` (body) or `If-Match`; `activate` / `archive` accept it optionally.
The row is locked (`SELECT ... FOR UPDATE`), the version is checked, and the update is conditioned
on that version and increments it atomically. A stale write returns:

```json
{ "success": false, "error": { "code": "THEME_VERSION_CONFLICT",
  "message": "Theme was modified by someone else; reload and retry",
  "details": { "expectedVersion": 1, "currentVersion": 2 } }, "requestId": "..." }
```

With N parallel updates on the same version exactly one succeeds (covered by an automated test).

---

## Theme configuration contract (`config`, schemaVersion 1)

Strict and versioned. **Unknown keys are rejected**; only safe literals are representable, so no
HTML, JavaScript, `url()` or free-form CSS can be stored. All sections/keys are optional on a
`DRAFT` (save incrementally); **completeness is enforced at activation**.

```jsonc
{
  "schemaVersion": 1,
  "colors":      { "primary": "#2563EB", "secondary": "...", "accent": "...", "background": "...", "surface": "...",
                   "heading": "...", "body": "...", "muted": "...", "border": "...", "success": "...", "warning": "...", "danger": "..." },
  "backgrounds": { "page":    { "type": "solid", "color": "{colors.background}" },
                   "section": { "type": "gradient", "angle": 135, "stops": [ { "color": "#F8FAFC", "position": 0 }, { "color": "#FFFFFF", "position": 100 } ] } },
                   // or { "type": "image", "assetId": "123", "fit": "cover", "position": "center", "overlayColor": "#00000080" }
  "typography":  { "headingFontFamily": "Inter", "bodyFontFamily": "Inter",
                   "h1": { "fontSize": { "base": "48px", "tablet": "40px", "phone": "32px" }, "fontWeight": 700,
                           "fontStyle": "normal", "lineHeight": 1.2, "letterSpacing": "-0.02em", "color": "{colors.heading}" },
                   "h2": {}, "h3": {}, "body": {}, "small": {}, "button": {} },
  "spacing":     { "xs": "4px", "sm": "8px", "md": "16px", "lg": "24px", "xl": "32px", "xxl": { "base": "48px", "phone": "32px" } },
  "radius":      { "none": "0px", "sm": "4px", "md": "8px", "lg": "16px", "pill": "9999px" },
  "shadows":     { "sm": { "offsetX": "0px", "offsetY": "1px", "blur": "2px", "spread": "0px", "color": "rgba(0,0,0,0.08)" }, "md": {}, "lg": {} },
  "buttons":     { "primary": { "background": "{colors.primary}", "textColor": "#FFFFFF", "borderColor": "{colors.primary}",
                                "borderWidth": "1px", "radius": "{radius.md}", "paddingX": "20px", "paddingY": "10px", "fontWeight": 600 },
                   "secondary": {}, "outline": {} },
  "layout":      { "containerWidth": { "base": "1200px", "tablet": "960px", "phone": "336px" }, "pagePadding": "32px",
                   "sectionSpacing": "96px", "gridGap": "24px" },
  "responsive":  { "breakpoints": { "phone": { "maxWidth": 767 }, "tablet": { "minWidth": 768, "maxWidth": 1023 }, "laptop": { "minWidth": 1024 } } }
}
```

A complete, activation-ready example lives in [fixtures/fullTheme.js](fixtures/fullTheme.js).

**Allowed values**

- Colors: `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()/rgba()/hsl()/hsla()`, `transparent`, or a `{colors.x}` reference.
- Dimensions: number + `px`/`rem`/`em` (rem/em counted as 16px for bounds). Safe bounds per field, e.g. spacing 0-512px, font size 8-200px, container width 320-2560px, radius up to 9999px.
- `fontWeight`: 100-900 in steps of 100. `lineHeight`: unitless 0.8-3. Font families: letters, digits, spaces, `, - _ '` only.
- Image backgrounds reference a **Media-owned asset id** (numeric string). Theme API stores no files and (today) validates the *format* of the id only, not its existence in Media.

**Token references** such as `{colors.primary}` (colors) and `{radius.md}` / `{spacing.md}` (dimensions)
must resolve; missing, unsupported and circular references (also chains) are rejected with paths:
`REF_MISSING`, `REF_CYCLE`, `REF_INVALID`, `REF_TOO_DEEP`.

### Responsive contract

| Device | CSS px range | Boundary tests |
|---|---|---|
| `phone` | 0-767 | 767 |
| `tablet` | 768-1023 | 768, 1023 |
| `laptop` | 1024+ | 1024 |

Responsive-capable values (`typography.*.fontSize`, `spacing.*`, `layout.*`) accept either a plain
value or `{ base, phone, tablet, laptop }`. **Unknown device keys (e.g. `mobile`) are rejected.**
Fallback rule: device override -> `base` -> otherwise *undefined* (never a silent `""`/`0`); required
properties are enforced at activation. Breakpoints are a fixed platform contract: `responsive.breakpoints`
may be echoed but any other value is rejected. The helper is in [src/responsive.js](src/responsive.js)
(`deviceForWidth`, `resolveResponsive`) so the frontend renderer can share exactly the same rules.
Theme values never control section order, structure or device visibility (that is Page Builder's job).

### Validation levels

1. **Request** (400 `VALIDATION_ERROR`): params, query, body shape, unknown request fields, size.
2. **Schema** (422 `THEME_CONFIG_INVALID`): allowed keys, device names, units, ranges, values.
3. **Semantic** (422): token references/cycles, gradient stop order.
4. **Activation** (422 `THEME_ACTIVATION_INVALID`): the complete config must also contain all required
   tokens (all 8 core colors, fonts, all six text-role font sizes, spacing sm/md/lg, radius sm/md/lg,
   `buttons.primary`, `layout.containerWidth`).
5. **Warnings** (never block): WCAG AA contrast below 4.5:1 for heading/body text vs. background and
   button text vs. button background (`LOW_CONTRAST`).

Error `details` are actionable, e.g. `{"path":"typography.h1.fontSize.mobile","code":"UNKNOWN_KEY",...}`.

`POST /themes/:id/validate` always returns `200` with:

```json
{ "data": { "themeId": "12", "version": 3, "valid": false,
            "errors":   [ { "path": "colors.secondary", "code": "REQUIRED_FOR_ACTIVATION", "message": "..." } ],
            "warnings": [ { "path": "colors.heading", "code": "LOW_CONTRAST", "message": "..." } ] } }
```

---

## Lifecycle

```
            create                activate                 archive
 (none) ------------> DRAFT ------------------> ACTIVE ------------> ARCHIVED
                        |  \_______________ archive ______________/      ^
                        |_____________________________________________/
 duplicate (any status) -> new DRAFT (version 1, new id/slug, visual config only)
```

- Only `DRAFT` themes are editable. `ACTIVE` / `ARCHIVED` return `409 THEME_NOT_EDITABLE` (see decisions).
- `ACTIVE` means "available to consumers", **not** website deployment/publishing.
- Multiple themes may be `ACTIVE` in a workspace (a gallery of ready themes); the consuming service chooses which to apply.
- Invalid transitions return `409 THEME_LIFECYCLE_CONFLICT`. There is no restore in V1.
- Archive is soft: `status=ARCHIVED`, `archivedAt` set; the row stays readable by id.
- Duplicate copies **only** the visual config + description; nothing else.

## Decisions taken for the open items in the report

| Open item | Decision in this implementation |
|---|---|
| Authentication ambiguity | One mechanism: HS256 JWT via `Authorization: Bearer` + `X-Workspace-Id` (+ optional `X-Internal-Service-Token`). `BRR_TOKEN` dropped. Claim shape is an assumption (see above). |
| JavaScript vs TypeScript | **JavaScript** (CommonJS), matching the Page Builder service. |
| `/activate` vs `/publish` | `/activate`; avoids confusion with website deployment. |
| Editing an ACTIVE theme | **Draft-first**: ACTIVE themes are immutable; duplicate -> edit -> activate. No cache-invalidation semantics needed. |
| Slug reuse | Slugs are unique **per workspace** and stay **reserved after archiving**. Auto-generated slugs get `-2`, `-3`... on collision; an explicit duplicate slug returns `409 THEME_SLUG_CONFLICT`. Slugs are immutable. |
| PATCH semantics | JSON Merge Patch (see above). |
| 400 vs 422 | `400` = request shape/context; `422` = theme configuration content. |
| Audit delivery | Emitted **after commit**, best-effort, never affects the response. Always logged (`"audit":true`); POSTed to `AUDIT_SERVICE_URL` if set. No outbox in V1. |
| Preview | Frontend-only; no preview endpoint. |
| Pagination | page/pageSize (max 100), stable `created_at DESC, id DESC`. |

## Error codes

| HTTP | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR`, `INVALID_JSON`, `EXPECTED_VERSION_REQUIRED`, `WORKSPACE_REQUIRED`, `INVALID_WORKSPACE_ID` | Bad request shape / context |
| 401 | `UNAUTHENTICATED`, `INVALID_TOKEN`, `TOKEN_EXPIRED`, `INVALID_SERVICE_TOKEN` | Authentication |
| 403 | `WORKSPACE_FORBIDDEN`, `INSUFFICIENT_ROLE` | Authorization |
| 404 | `NOT_FOUND`, `ROUTE_NOT_FOUND` | Not found in scope / unknown route |
| 409 | `THEME_VERSION_CONFLICT`, `THEME_SLUG_CONFLICT`, `THEME_NOT_EDITABLE`, `THEME_LIFECYCLE_CONFLICT` | State conflicts |
| 413 | `PAYLOAD_TOO_LARGE`, `CONFIG_TOO_LARGE` | Size limits |
| 422 | `THEME_CONFIG_INVALID`, `THEME_ACTIVATION_INVALID` | Theme content |
| 429 | `RATE_LIMITED` | Rate limit |
| 500 / 503 | `INTERNAL_ERROR` / (`/ready` -> `{"status":"unavailable"}`) | Generic message only; stack traces stay in logs |

---

## Postman

Files in [postman/](postman/):

| File | Purpose |
|---|---|
| `Theme-API.postman_collection.json` | 89 requests in 8 folders with 274 assertions |
| `Theme-API.postman_environment.json` | Committed **template** (placeholder secret) |
| `Theme-API.local.postman_environment.json` | Generated from your `.env` secret, **git-ignored** |

**Use it**

1. Start the stack (`docker compose up -d --build`).
2. Postman -> Import -> the collection and `Theme-API.local.postman_environment.json`
   (or the template, then paste your `JWT_SECRET` into the `jwtSecret` variable).
3. Select the environment and run the collection **in order** (Collection Runner), or send single requests.

**How the JWT works in Postman.** A collection-level pre-request script signs HS256 tokens from
`{{jwtSecret}}` before every request and stores them in the environment (`token` admin, `editorToken`,
`viewerToken`, `otherToken` for workspace 2, plus deliberately broken `expiredToken`, `badSigToken`,
`algNoneToken`). Every request carries them visibly in the header:

```
Authorization: Bearer {{token}}
X-Workspace-Id: {{workspaceId}}
X-Request-Id:   {{requestId}}
X-Internal-Service-Token: {{internalServiceToken}}   (disabled; enable only if INTERNAL_SERVICE_TOKEN is set)
```

**Folders**

`00 Operations` (health, ready, 404, CORS) · `01 Auth & workspace` (401/400/403 cases, viewer role) ·
`02 Create` (success, slug conflicts, malformed/oversized body, unsafe/unknown/cyclic config) ·
`03 List & get` (search, filter, pagination limits) · `04 Update` (merge, null-delete, stale version 409,
If-Match, failed patch leaves version unchanged) · `05 Validate/activate/duplicate` ·
`06 Workspace isolation` (every endpoint from another workspace) · `07 Archive`.

**Headless run**

```bash
npm run postman:run          # Newman, uses the git-ignored local environment
npm run postman:build        # regenerate the collection/environments after editing scripts/build-postman.js
```

> Ids are saved to environment variables as the run progresses, so run folders top to bottom. The
> default rate limit is 300 requests/minute per IP; one full run is ~90 requests, so several
> back-to-back runs can hit `429`. The local `.env` raises it to 2000.

---

## Testing

```bash
docker compose up -d db        # integration tests need PostgreSQL on localhost:5433
npm test                       # unit + integration (34 tests)
npm run test:unit              # no database needed
```

Covered: schema/semantic validation, token references and cycles, responsive boundaries
(767/768/1023/1024) and fallback, merge-patch, slugs; and against a real database: auth negatives,
workspace + role enforcement, actor-from-token, string IDs, **parallel updates/activations (one winner,
rest 409)**, cross-workspace isolation on every endpoint, lifecycle, size limits, request-id propagation,
internal-service-token, rate limiting (429), log redaction, and audit events (only for committed
successful mutations). Integration tests use random workspace ids and clean up after themselves.

## Security notes

- Parameterized SQL only; every query is scoped by `workspace_id` (and resource id).
- Strict schemas; request bodies reject unknown fields (no mass assignment, no client-supplied actor/workspace).
- Helmet, CORS allowlist, per-IP rate limit, JSON body limit (`THEME_MAX_CONFIG_BYTES` + 16 KiB), config size check.
- Logs record method, path (no query string), status, duration, user and workspace ids, never headers or bodies; credentials are also redacted by pino config.
- Production errors are generic; `/health` and `/ready` reveal nothing about infrastructure.
- Docker image runs as a non-root user; no secrets in the image (`.dockerignore` excludes `.env`).
- Behind a reverse proxy the service trusts one proxy hop (`trust proxy: 1`) so the rate limiter sees client IPs.

## Project layout

```
src/
  server.js, app.js, config.js, logger.js, db.js, migrate.js, audit.js, errors.js, responsive.js
  middleware/    auth.js (JWT + workspace + roles) · validate.js · errorHandler.js
  routes/        themes.js
  schemas/       themeConfig.js (strict visual schema) · themeRequests.js
  services/      themeService.js (business rules) · themeValidator.js (semantic + activation checks)
  repositories/  themeRepository.js (SQL)
migrations/      001_create_themes.sql
fixtures/        fullTheme.js        (complete example theme)
scripts/         make-token.js · build-postman.js
postman/         collection + environments
tests/           unit/ · integration/
Dockerfile · docker-compose.yml · .env.example
```

## Known limitations / items to confirm

- The platform **Auth contract** (claim names/roles) is assumed; see "Authentication".
- `assetId` for image backgrounds is checked for **format only**; verifying that the asset exists/is owned by the workspace needs a Media-service contract.
- Actor ids are stored as plain `BIGINT` with no foreign keys (the identity model lives in another service).
- Defaults proposed by the spec (port `4065`, `THEME_MAX_CONFIG_BYTES=262144`, the breakpoints) should be confirmed against platform standards and the frontend renderer.
- No restore-from-archive, no theme version history, no OpenAPI document yet.
