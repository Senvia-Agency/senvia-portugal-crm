BEGIN;
CREATE UNIQUE INDEX IF NOT EXISTS automation_runs_id_org_unique ON public.automation_runs(id,organization_id);
ALTER TABLE public.email_sends ADD COLUMN IF NOT EXISTS automation_run_id uuid;
ALTER TABLE public.email_sends ADD COLUMN IF NOT EXISTS automation_node_id text;
ALTER TABLE public.email_sends ADD CONSTRAINT email_sends_automation_run_org_fk
  FOREIGN KEY(automation_run_id,organization_id) REFERENCES public.automation_runs(id,organization_id) ON DELETE SET NULL (automation_run_id);
ALTER TABLE public.email_sends ADD CONSTRAINT email_sends_automation_correlation_pair
  CHECK ((automation_run_id IS NULL AND automation_node_id IS NULL)
    OR (automation_run_id IS NOT NULL AND nullif(trim(automation_node_id),'') IS NOT NULL));
CREATE INDEX IF NOT EXISTS email_sends_run_node_idx
  ON public.email_sends(organization_id,automation_run_id,automation_node_id) WHERE automation_run_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.guard_email_automation_correlation() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF NEW.automation_run_id IS NULL THEN NEW.automation_node_id:=NULL; END IF;
  IF TG_OP='UPDATE' AND NEW.automation_run_id IS NOT DISTINCT FROM OLD.automation_run_id
    AND NEW.automation_node_id IS NOT DISTINCT FROM OLD.automation_node_id THEN RETURN NEW; END IF;
  IF NEW.automation_run_id IS NOT NULL AND current_user NOT IN ('postgres','service_role','supabase_admin') THEN
    RAISE EXCEPTION 'Automation email correlation is service-only' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_email_automation_correlation() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER guard_email_automation_correlation BEFORE INSERT OR UPDATE ON public.email_sends
FOR EACH ROW EXECUTE FUNCTION public.guard_email_automation_correlation();

CREATE OR REPLACE FUNCTION public.record_email_automation_run_state() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE flags jsonb:='{}'::jsonb;
BEGIN
  IF NEW.automation_run_id IS NULL OR NEW.automation_node_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.opened_at IS NOT NULL AND OLD.opened_at IS NULL THEN
    flags:=flags||jsonb_build_object('email_opened',true);
  END IF;
  IF NEW.clicked_at IS NOT NULL AND OLD.clicked_at IS NULL THEN
    flags:=flags||jsonb_build_object('email_clicked',true);
  END IF;
  IF NEW.status='bounced' AND NEW.status IS DISTINCT FROM OLD.status THEN
    flags:=flags||jsonb_build_object('email_bounced',true);
  END IF;
  IF NEW.status='unsubscribed' AND NEW.status IS DISTINCT FROM OLD.status THEN
    flags:=flags||jsonb_build_object('email_unsubscribed',true);
  END IF;
  IF flags='{}'::jsonb THEN RETURN NEW; END IF;
  UPDATE public.automation_runs SET context=
    coalesce(context,'{}'::jsonb) || flags || jsonb_build_object('email_events',
      coalesce(context->'email_events','{}'::jsonb)||jsonb_build_object(NEW.automation_node_id,
        coalesce(context #> ARRAY['email_events',NEW.automation_node_id],'{}'::jsonb)||flags))
    WHERE id=NEW.automation_run_id AND organization_id=NEW.organization_id;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.record_email_automation_run_state() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER record_email_automation_run_state AFTER UPDATE ON public.email_sends
FOR EACH ROW EXECUTE FUNCTION public.record_email_automation_run_state();
CREATE OR REPLACE FUNCTION public.unlink_automation_run_emails() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  UPDATE public.email_sends SET automation_run_id=NULL,automation_node_id=NULL
    WHERE automation_run_id=OLD.id AND organization_id=OLD.organization_id;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.unlink_automation_run_emails() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER unlink_automation_run_emails BEFORE DELETE ON public.automation_runs
FOR EACH ROW EXECUTE FUNCTION public.unlink_automation_run_emails();
COMMIT;
