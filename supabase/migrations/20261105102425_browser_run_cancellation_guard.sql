BEGIN;
CREATE OR REPLACE FUNCTION public.guard_browser_automation_run_cancellation() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF current_user IN ('postgres','supabase_admin','service_role') THEN RETURN NEW; END IF;
  IF current_user <> 'authenticated' AND auth.role() IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION 'A atualização deste percurso exige o motor de automações';
  END IF;
  IF OLD.status NOT IN ('running','waiting','awaiting_reply') OR NEW.status IS DISTINCT FROM 'cancelled'
     OR NEW.wake_at IS NOT NULL OR NEW.completed_at IS NULL THEN
    RAISE EXCEPTION 'No navegador apenas é permitido cancelar um percurso ativo';
  END IF;
  IF (to_jsonb(NEW)-ARRAY['status','wake_at','completed_at','updated_at']) IS DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['status','wake_at','completed_at','updated_at']) THEN
    RAISE EXCEPTION 'O cancelamento não permite alterar os dados do percurso';
  END IF;
  NEW.completed_at:=statement_timestamp();
  NEW.updated_at:=statement_timestamp();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_browser_automation_run_cancellation() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER guard_browser_automation_run_cancellation
BEFORE UPDATE ON public.automation_runs
FOR EACH ROW EXECUTE FUNCTION public.guard_browser_automation_run_cancellation();
COMMIT;
