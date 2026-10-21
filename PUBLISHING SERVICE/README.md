# TriostackOne Publishing API

Node.js (Express) + PostgreSQL microservice that publishes website revisions as immutable releases.

## Run
1. `cp .env.example .env` and fill in the values (`.env` is git-ignored).
2. `docker compose up -d --build` — API on `http://localhost:4010`, Postgres on host port `5433`.

## Test (Postman / Newman)
```
node postman/build-collection.js          # regenerates the collection + git-ignored environment from .env
cd postman
npx newman run publishing-api.postman_collection.json -e publishing-api.postman_environment.json
```
Needs `SEED_DEMO=true` in `.env` (demo websites/revisions standing in for the Website service).
Import the same two JSON files into the Postman app; the collection signs its own JWTs from `jwt_secret`.

## Auth
`Authorization: Bearer <JWT>` (HS256, issuer/audience checked) plus `X-Tenant-Id` / `X-Organization-Id`,
which must match the token's `tenant_id` / `organization_id` claims. Permissions: `publishing:read`, `publishing:write`.

## Assumptions to verify (see the design report)
JWT claim names, the HS256 shared secret (vs. JWKS), ID generation, the Website/Media clients and the hosting
provider are stand-ins until audited against the real platform.
