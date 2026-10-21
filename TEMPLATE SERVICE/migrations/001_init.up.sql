-- Template Service baseline schema. BIGINT identity IDs; cross-service IDs are plain BIGINT references (no FKs).

CREATE TABLE template_categories (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  slug VARCHAR(120) NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE template_tags (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  slug VARCHAR(100) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE templates (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  scope_type VARCHAR(20) NOT NULL CHECK (scope_type IN ('GLOBAL','TENANT')),
  tenant_id BIGINT NULL,
  organization_id BIGINT NULL,
  name VARCHAR(160) NOT NULL,
  slug VARCHAR(180) NOT NULL,
  description TEXT,
  category_id BIGINT NULL REFERENCES template_categories(id),
  industry VARCHAR(80) NULL,
  visibility VARCHAR(20) NOT NULL DEFAULT 'PUBLIC'
    CHECK (visibility IN ('PUBLIC','PRIVATE','UNLISTED')),
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','ACTIVE','ARCHIVED')),
  thumbnail_asset_id BIGINT NULL,          -- Media Service reference, not an FK
  draft_version_id BIGINT NULL,
  published_version_id BIGINT NULL,
  revision INTEGER NOT NULL DEFAULT 1,     -- optimistic concurrency (If-Match: "revision-N")
  created_by BIGINT NULL,
  updated_by BIGINT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ NULL,
  CHECK ((scope_type='GLOBAL' AND tenant_id IS NULL AND organization_id IS NULL)
      OR (scope_type='TENANT' AND tenant_id IS NOT NULL AND organization_id IS NOT NULL))
);
CREATE UNIQUE INDEX uq_templates_global_slug
  ON templates(slug) WHERE scope_type='GLOBAL' AND archived_at IS NULL;
CREATE UNIQUE INDEX uq_templates_tenant_slug
  ON templates(tenant_id, organization_id, slug) WHERE scope_type='TENANT' AND archived_at IS NULL;
CREATE INDEX ix_templates_scope ON templates(scope_type, tenant_id, organization_id, created_at DESC);
CREATE INDEX ix_templates_category ON templates(category_id);

CREATE TABLE template_versions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  template_id BIGINT NOT NULL REFERENCES templates(id),
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  state VARCHAR(20) NOT NULL DEFAULT 'DRAFT'
    CHECK (state IN ('DRAFT','IN_REVIEW','APPROVED','PUBLISHED','REJECTED','DEPRECATED')),
  schema_version INTEGER NOT NULL,
  snapshot JSONB NOT NULL,
  checksum CHAR(64) NOT NULL,
  changelog TEXT,
  created_by BIGINT NULL,
  reviewed_by BIGINT NULL,
  published_by BIGINT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ NULL,
  published_at TIMESTAMPTZ NULL,
  UNIQUE(template_id, version_number)
);
CREATE INDEX ix_template_versions_state ON template_versions(template_id, state, version_number DESC);
-- At most one PUBLISHED version per template.
CREATE UNIQUE INDEX uq_template_versions_one_published ON template_versions(template_id) WHERE state='PUBLISHED';

CREATE TABLE template_tag_links (
  template_id BIGINT NOT NULL REFERENCES templates(id),
  tag_id BIGINT NOT NULL REFERENCES template_tags(id),
  PRIMARY KEY(template_id, tag_id)
);
CREATE INDEX ix_template_tag_links_tag ON template_tag_links(tag_id);

CREATE TABLE template_applications (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  idempotency_key VARCHAR(200) NOT NULL,
  request_fingerprint CHAR(64) NOT NULL,
  tenant_id BIGINT NOT NULL,
  organization_id BIGINT NOT NULL,
  website_id BIGINT NOT NULL,
  template_id BIGINT NOT NULL REFERENCES templates(id),
  template_version_id BIGINT NOT NULL REFERENCES template_versions(id),
  request JSONB NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','VALIDATING','IN_PROGRESS','SUCCEEDED','FAILED')),
  attempts INTEGER NOT NULL DEFAULT 0,
  target_document_id BIGINT NULL,
  result JSONB NULL,
  error_code VARCHAR(80) NULL,
  created_by BIGINT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, organization_id, idempotency_key)
);
CREATE INDEX ix_template_applications_website
  ON template_applications(tenant_id, organization_id, website_id, created_at DESC);
CREATE INDEX ix_template_applications_open ON template_applications(status, updated_at)
  WHERE status IN ('PENDING','VALIDATING','IN_PROGRESS');

CREATE TABLE audit_log (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id BIGINT NULL,
  organization_id BIGINT NULL,
  user_id BIGINT NULL,
  request_id VARCHAR(64) NULL,
  action VARCHAR(80) NOT NULL,
  entity_type VARCHAR(40) NOT NULL,
  entity_id BIGINT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ix_audit_log_entity ON audit_log(entity_type, entity_id, created_at DESC);

-- Circular reference guard (documented method: trigger). draft/published version must belong to the same template.
CREATE FUNCTION templates_version_ref_check() RETURNS trigger AS $$
BEGIN
  IF NEW.published_version_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM template_versions WHERE id = NEW.published_version_id AND template_id = NEW.id) THEN
    RAISE EXCEPTION 'published_version_id % does not belong to template %', NEW.published_version_id, NEW.id
      USING ERRCODE = '23514';
  END IF;
  IF NEW.draft_version_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM template_versions WHERE id = NEW.draft_version_id AND template_id = NEW.id) THEN
    RAISE EXCEPTION 'draft_version_id % does not belong to template %', NEW.draft_version_id, NEW.id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_templates_version_ref
  BEFORE INSERT OR UPDATE OF published_version_id, draft_version_id ON templates
  FOR EACH ROW EXECUTE FUNCTION templates_version_ref_check();

-- Immutability: once a version leaves DRAFT its content can never change or be deleted.
CREATE FUNCTION template_versions_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.state <> 'DRAFT' THEN
      RAISE EXCEPTION 'template version % is immutable (state %)', OLD.id, OLD.state USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.state <> 'DRAFT' AND (
       NEW.snapshot IS DISTINCT FROM OLD.snapshot OR NEW.checksum IS DISTINCT FROM OLD.checksum
       OR NEW.schema_version IS DISTINCT FROM OLD.schema_version OR NEW.template_id IS DISTINCT FROM OLD.template_id
       OR NEW.version_number IS DISTINCT FROM OLD.version_number) THEN
    RAISE EXCEPTION 'template version % is immutable (state %)', OLD.id, OLD.state USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_template_versions_immutable
  BEFORE UPDATE OR DELETE ON template_versions
  FOR EACH ROW EXECUTE FUNCTION template_versions_immutable();

INSERT INTO template_categories (name, slug, sort_order) VALUES
  ('Portfolio', 'portfolio', 10),
  ('Business', 'business', 20),
  ('E-commerce', 'e-commerce', 30),
  ('Blog', 'blog', 40),
  ('Landing Page', 'landing-page', 50),
  ('Restaurant', 'restaurant', 60),
  ('Education', 'education', 70);
