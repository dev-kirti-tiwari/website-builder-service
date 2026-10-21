-- Content reference: opaque pointer the BFF resolves against the Content API.
ALTER TABLE page_sections ADD COLUMN content_ref VARCHAR(120);

ALTER TABLE page_sections ADD CONSTRAINT page_sections_type_chk
  CHECK (section_type IN ('hero','features','images','testimonials','pricing','faq','cta','form'));

-- Child rows must belong to the same workspace as their parent page.
ALTER TABLE pages ADD CONSTRAINT pages_id_workspace_uq UNIQUE (id, workspace_id);
ALTER TABLE page_sections ADD CONSTRAINT page_sections_page_ws_fk
  FOREIGN KEY (page_id, workspace_id) REFERENCES pages (id, workspace_id);
ALTER TABLE page_layouts ADD CONSTRAINT page_layouts_page_ws_fk
  FOREIGN KEY (page_id, workspace_id) REFERENCES pages (id, workspace_id);
ALTER TABLE page_revisions ADD CONSTRAINT page_revisions_page_ws_fk
  FOREIGN KEY (page_id, workspace_id) REFERENCES pages (id, workspace_id);

CREATE INDEX page_revisions_page_idx ON page_revisions (workspace_id, page_id, revision_number DESC);
CREATE INDEX page_audit_logs_ws_idx ON page_audit_logs (workspace_id, created_at DESC);

-- Revision snapshots are immutable.
CREATE FUNCTION page_revisions_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'page_revisions rows are immutable';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER page_revisions_no_update BEFORE UPDATE ON page_revisions
  FOR EACH ROW EXECUTE FUNCTION page_revisions_immutable();
