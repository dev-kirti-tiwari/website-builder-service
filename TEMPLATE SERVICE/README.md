# Template Service API

Template catalog, immutable template versions and idempotent "apply to website" for the Website Builder platform.
Node.js + TypeScript + Express, PostgreSQL via `pg` (parameterized SQL, no ORM), BIGINT ids as JSON strings, trusted-BFF Bearer auth.

## Run

```bash
cp .env.example .env            # then set POSTGRES_PASSWORD and STATIC_INTERNAL_TOKEN
docker compose up -d --build    # postgres :5442, api :4018 (migrations run on start)
curl localhost:4018/health && curl localhost:4018/ready
```

Local dev without Docker for the API: `npm i && npm run migrate && npm run dev`.

## Test

```bash
npm run typecheck
npm test                         # unit + integration (needs the Postgres from compose / DATABASE_URL)
npm run postman:generate         # writes postman/*.json (token read from .env, environment file is git-ignored)
npm run postman:run              # newman, 23 requests against http://localhost:4018
```

## Auth model

`Authorization: Bearer <STATIC_INTERNAL_TOKEN>` (constant-time compared, never logged) plus BFF-injected
`X-Tenant-Id`, `X-Organization-Id`, `X-User-Id` (required BIGINT strings), `X-Software-Id`, `X-Request-Id`.
Permissions arrive in `X-Permissions` (comma separated, `*` = all) - **assumption**: the report names the permissions
but not the transport; align with the real BFF. `template:global:admin` is an added permission guarding GLOBAL-scope catalog items.

## Layout

`src/modules/{templates,versions,catalog,applications}` (schemas / repository / service), `src/modules/routes.ts`,
`src/integrations/clients.ts` (Website, Media, Document adapters), `src/middleware`, `migrations/`, `openapi/openapi.yaml`, `postman/`.

## Design notes

- Tenant isolation: every query is scoped by `scope_type` + trusted tenant + organization; out-of-scope = 404.
- Versions: DRAFT -> IN_REVIEW -> APPROVED -> PUBLISHED -> DEPRECATED. DB triggers make non-DRAFT snapshots immutable and
  guarantee `published_version_id`/`draft_version_id` belong to the same template (the documented method for the circular reference).
- Apply: needs `Idempotency-Key`; same key + same request replays the same application, different request -> 409. Runs in the
  background (202 + status URL), downstream calls carry the application id as the stable operation id, a reconciler resumes stuck work.
  It never publishes.
- Optimistic concurrency: `ETag: "revision-N"` on GET/POST/PATCH; `If-Match` on PATCH is enforced when sent (412 on mismatch).

## Unresolved integration assumptions

- Website, Media and Page/Document/Draft service contracts are not confirmed. `INTEGRATIONS_MODE=stub` (local only, refused in
  production) returns success; `http` mode **fails closed with 503** until real clients are implemented in `src/integrations/clients.ts`.
  Navigation and Theme adapters are not implemented (no contract); the snapshot's `navigation`/`theme` are passed to the Document service as-is.
- The snapshot block catalogue (`src/modules/versions/snapshot.ts`) follows the report's illustrative example, not the real editor schema.
- Port 4018 and DB port 5442 are local choices; confirm against the port registry.
