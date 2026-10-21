-- Theme API: themes table (visual configuration only).
CREATE TABLE IF NOT EXISTS themes (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id   BIGINT       NOT NULL,
  name           VARCHAR(150) NOT NULL,
  slug           VARCHAR(180) NOT NULL,
  description    TEXT,
  status         VARCHAR(20)  NOT NULL DEFAULT 'DRAFT',
  version        INTEGER      NOT NULL DEFAULT 1,
  schema_version INTEGER      NOT NULL DEFAULT 1,
  config         JSONB        NOT NULL DEFAULT '{}'::jsonb,
  created_by     BIGINT       NOT NULL,
  updated_by     BIGINT,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  deleted_at     TIMESTAMPTZ,
  CONSTRAINT themes_status_chk  CHECK (status IN ('DRAFT', 'ACTIVE', 'ARCHIVED')),
  CONSTRAINT themes_version_chk CHECK (version >= 1),
  CONSTRAINT themes_config_object_chk CHECK (jsonb_typeof(config) = 'object')
);

-- Slugs are unique per workspace and stay reserved after archiving (full, non-partial index).
CREATE UNIQUE INDEX IF NOT EXISTS themes_workspace_slug_uq ON themes (workspace_id, slug);
CREATE INDEX IF NOT EXISTS themes_workspace_status_idx ON themes (workspace_id, status);
CREATE INDEX IF NOT EXISTS themes_workspace_created_idx ON themes (workspace_id, created_at DESC, id DESC);
