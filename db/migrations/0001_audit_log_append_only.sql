-- audit_log is append-only (spec 5.9). The app connects as the table owner, so revoking
-- grants alone would not hold; this trigger rejects UPDATE, DELETE and TRUNCATE for every role.
-- A future retention purge must run as the owner with the triggers explicitly disabled.
CREATE OR REPLACE FUNCTION audit_log_reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only: % is not allowed', TG_OP;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER audit_log_no_update_delete
  BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION audit_log_reject_change();
--> statement-breakpoint
CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON "audit_log"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_reject_change();
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "audit_log" FROM PUBLIC;
