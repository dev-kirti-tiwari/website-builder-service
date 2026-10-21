CREATE TABLE forms (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  organization_id BIGINT NOT NULL,
  website_id BIGINT NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL CHECK (status IN ('draft','published','archived')),
  revision INTEGER NOT NULL DEFAULT 1,
  published_version_id BIGINT,
  created_by BIGINT NOT NULL,
  updated_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX forms_slug_uq ON forms (tenant_id, organization_id, website_id, slug) WHERE deleted_at IS NULL;
CREATE INDEX forms_scope_idx ON forms (tenant_id, organization_id, website_id) WHERE deleted_at IS NULL;

CREATE TABLE form_fields (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  organization_id BIGINT NOT NULL,
  form_id BIGINT NOT NULL REFERENCES forms(id),
  name TEXT NOT NULL,
  label TEXT NOT NULL,
  type TEXT NOT NULL,
  required BOOLEAN NOT NULL DEFAULT FALSE,
  options JSONB,
  validation JSONB NOT NULL DEFAULT '{}',
  position INTEGER NOT NULL,
  created_by BIGINT NOT NULL,
  updated_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (form_id, name)
);
CREATE INDEX form_fields_form_idx ON form_fields (tenant_id, organization_id, form_id);

CREATE TABLE form_schema_versions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  organization_id BIGINT NOT NULL,
  form_id BIGINT NOT NULL REFERENCES forms(id),
  version_number INTEGER NOT NULL,
  schema JSONB NOT NULL,
  published_by BIGINT NOT NULL,
  published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (form_id, version_number)
);

CREATE FUNCTION forbid_schema_version_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'form_schema_versions rows are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER form_schema_versions_immutable
  BEFORE UPDATE OR DELETE ON form_schema_versions
  FOR EACH ROW EXECUTE FUNCTION forbid_schema_version_change();

CREATE TABLE form_submissions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  organization_id BIGINT NOT NULL,
  form_id BIGINT NOT NULL REFERENCES forms(id),
  schema_version_id BIGINT NOT NULL REFERENCES form_schema_versions(id),
  data JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','read','spam','archived')),
  actor_type TEXT NOT NULL DEFAULT 'ANONYMOUS_VISITOR',
  user_id BIGINT,
  request_id TEXT,
  visitor_meta JSONB NOT NULL DEFAULT '{}',
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by BIGINT
);
CREATE INDEX form_submissions_form_idx ON form_submissions (tenant_id, organization_id, form_id, id DESC);

CREATE TABLE form_automations (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  organization_id BIGINT NOT NULL,
  form_id BIGINT NOT NULL REFERENCES forms(id),
  action_type TEXT NOT NULL CHECK (action_type IN ('crm_lead','email','whatsapp','notification')),
  config JSONB NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_by BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX form_automations_form_idx ON form_automations (tenant_id, organization_id, form_id);

CREATE TABLE audit_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  organization_id BIGINT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id BIGINT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id BIGINT,
  request_id TEXT,
  details JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE outbox_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  organization_id BIGINT NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  request_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processed','dead')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);
CREATE INDEX outbox_pending_idx ON outbox_events (next_attempt_at) WHERE status = 'pending';

CREATE TABLE idempotency_keys (
  tenant_id BIGINT NOT NULL,
  organization_id BIGINT NOT NULL,
  form_id BIGINT NOT NULL,
  idem_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  submission_id BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, organization_id, form_id, idem_key)
);
