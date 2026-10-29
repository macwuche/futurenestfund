-- The audit log, money ledger and application history can never be edited or deleted (TRUNCATE for test resets still works).
-- Previously installed by the API at boot; a migration now, so the API's database role needs no DDL rights.
CREATE OR REPLACE FUNCTION demo_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME; END $$;
--> statement-breakpoint
CREATE OR REPLACE TRIGGER demo_audit_append_only BEFORE UPDATE OR DELETE ON demo_audit FOR EACH ROW EXECUTE FUNCTION demo_append_only();
--> statement-breakpoint
CREATE OR REPLACE TRIGGER demo_ledger_append_only BEFORE UPDATE OR DELETE ON demo_ledger FOR EACH ROW EXECUTE FUNCTION demo_append_only();
--> statement-breakpoint
CREATE OR REPLACE TRIGGER demo_application_events_append_only BEFORE UPDATE OR DELETE ON demo_application_events FOR EACH ROW EXECUTE FUNCTION demo_append_only();
