-- Database-level integrity rules that must hold even if application code is wrong.

-- 1. The audit log is append-only.
CREATE OR REPLACE FUNCTION audit_events_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only (% rejected)', TG_OP USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_events_no_update_delete
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_append_only();
--> statement-breakpoint

-- 2. Results of approved, finalized or locked payroll cannot be changed or removed.
--    Changes require reopening the run (audited) or a correction run.
CREATE OR REPLACE FUNCTION payroll_results_protect_final() RETURNS trigger AS $$
DECLARE
  run_status text;
BEGIN
  SELECT status INTO run_status FROM payroll_runs WHERE id = OLD.run_id;
  IF run_status IN ('approved', 'finalized', 'locked') THEN
    RAISE EXCEPTION 'payroll results of a % run cannot be modified', run_status USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER payroll_results_protect_final
  BEFORE UPDATE OR DELETE ON payroll_results
  FOR EACH ROW EXECUTE FUNCTION payroll_results_protect_final();
--> statement-breakpoint

-- 3. Finalized and locked payroll runs cannot be deleted.
CREATE OR REPLACE FUNCTION payroll_runs_protect_final() RETURNS trigger AS $$
BEGIN
  IF OLD.status IN ('approved', 'finalized', 'locked') THEN
    RAISE EXCEPTION 'a % payroll run cannot be deleted', OLD.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER payroll_runs_protect_final
  BEFORE DELETE ON payroll_runs
  FOR EACH ROW EXECUTE FUNCTION payroll_runs_protect_final();
