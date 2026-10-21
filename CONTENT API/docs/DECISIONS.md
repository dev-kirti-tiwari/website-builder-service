# Decisions (report section 23)

| Decision | Choice |
|---|---|
| Permission names | `content:read`, `content:edit` (create/PUT/PATCH), `content:delete`, `content:restore`, `content:duplicate` (internal route is token-gated), wildcard `content:*`. Read from the JWT `permissions` claim. |
| JWT claims | `sub` (actor id), `workspaces` (array, or `workspaceId`), `permissions` (array). HS256 via `JWT_SECRET`, or RS256/ES256 via `JWT_PUBLIC_KEY`. Adjust `src/middleware/authentication.js` to the real BRR issuer. |
| PATCH semantics | JSON Merge Patch (RFC 7396): objects merge, arrays/scalars replaced, `null` deletes a key. Final document is fully validated. |
| Max lengths | heading 160, subheading 240, description 1000-2000, quote 1000, answer 3000, button label 60, URL 2048. Arrays: features 24, images 50, testimonials 24, plans 6, FAQ 50. See `contentSchemas/`. |
| URL schemes | Relative paths (`/x`, `#x`, `?x`) and `https://`. `mailto:`/`tel:`, `http:`, `//host`, `javascript:`, `data:` are rejected. |
| Page Builder lookup | `GET {PAGE_BUILDER_BASE_URL}{PAGE_BUILDER_SECTION_PATH}` with `X-Internal-Service-Token`; expects `{id, pageId, workspaceId?, type}`. Off by default (`PAGE_BUILDER_VALIDATION=disabled`). Only used on create/duplicate. |
| Media validation | Local format check always. Remote existence check via `MEDIA_VALIDATION=enabled` (default disabled). |
| Revision retention | Keep everything (one snapshot per mutation); snapshots are immutable (DB trigger blocks UPDATE/DELETE). |
| Section restored in Page Builder after removal | Soft-deleted content is not resurrected; a new `POST` creates a fresh row at revision 1. |
| Bulk page read | Returns existing rows only (`contents` keyed by sectionId + `items`); the BFF handles sections without content. |
| Delete + concurrency | `DELETE` accepts optional `?expectedRevision=`; if given it is enforced. |
| Audit | Fire-and-forget to `AUDIT_BASE_URL` (IDs only, never content bodies); logged locally when unset. |
| Body validation errors | Request-envelope problems are `400 BAD_REQUEST`; content problems are `422` (`CONTENT_SCHEMA_INVALID`, `INVALID_LINK`, `INVALID_MEDIA_REFERENCE`, `SECTION_TYPE_MISMATCH`). Non-JSON bodies are `415`. |
