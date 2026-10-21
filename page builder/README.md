# Page Builder API Service (V1)

Structure/layout service for landing pages (Node.js, Express 5, PostgreSQL, Zod, Pino). Content lives in the Content API.

## Run
```
docker compose up -d        # PostgreSQL on localhost:5434
npm install
npm run migrate
npm start                   # http://localhost:4070
npm test                    # integration tests (needs the DB)
```
Full containerised run: `docker compose --profile full up -d --build` (needs JWT_SECRET in the environment).

## Auth (align with the existing auth system)
- `AUTH_MODE=jwt` (default): `Authorization: Bearer <jwt>` verified with `JWT_SECRET` (HS256) or `JWT_PUBLIC_KEY` (RS256).
  Claims: `sub` (numeric actor id) and `workspaces: ["1001", {"id":"1002","role":"viewer"}]`. Roles: viewer (read), editor (write), admin (delete).
- `X-Internal-Service-Token` (= `INTERNAL_SERVICE_TOKEN`): trusted BFF; optional `X-Actor-Id`.
- `AUTH_MODE=dev`: no token needed, every workspace allowed. Refused when `NODE_ENV=production`.
- Every `/api/v1` call also needs `X-Workspace-Id`.

## Contract decisions (report section 24)
| Decision | Choice |
|---|---|
| Pagination | `page`, `limit` (<=100), `q`, `status`, `sort`, `order`; `meta.pagination` |
| Page duplicate | structure only; BFF copies content |
| Reorder | complete ordered ID list required |
| Autosave | patch list; `expectedRevision` required; `position` moves a section to that slot |
| Snapshots | one immutable snapshot per successful structural revision |
| Section removal | hard delete, positions renumbered |
| Page status | settable directly (metadata only) |
| Page layout | `page_layouts` table |
| Slugs | lowercase `a-z0-9` with single hyphens; unique among active pages; reusable after soft delete |
| Content reference | `contentRef` string on each section; preview returns `contentReferences` |
| Restore | any editor; creates a new revision |

Not built (optional in the report): idempotency keys / `page_operations`, a Content API client, revision retention.
API contract: `docs/openapi.yaml`.
