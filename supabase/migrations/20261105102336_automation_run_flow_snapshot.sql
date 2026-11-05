BEGIN;

CREATE OR REPLACE FUNCTION public.pin_automation_run_flow()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  selected_flow public.automation_flows%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.flow_id IS DISTINCT FROM OLD.flow_id
       OR NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
      RAISE EXCEPTION 'A origem de um percurso de automação é imutável';
    END IF;
    NEW.flow_version := OLD.flow_version;
    IF OLD.context ? '__flow_snapshot' THEN
      NEW.context := coalesce(NEW.context, '{}'::jsonb)
        || jsonb_build_object('__flow_snapshot', OLD.context -> '__flow_snapshot');
    ELSE
      NEW.context := coalesce(NEW.context, '{}'::jsonb) - '__flow_snapshot';
    END IF;
    RETURN NEW;
  END IF;

  SELECT * INTO selected_flow
  FROM public.automation_flows
  WHERE id = NEW.flow_id AND organization_id = NEW.organization_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Automação não encontrada na organização do percurso';
  END IF;

  NEW.flow_version := selected_flow.version;
  NEW.context := coalesce(NEW.context, '{}'::jsonb)
    || jsonb_build_object('__flow_snapshot', jsonb_build_object(
      'graph', selected_flow.graph,
      'entry_node_id', selected_flow.entry_node_id,
      'version', selected_flow.version,
      'trigger_config', selected_flow.trigger_config,
      'quiet_hours', selected_flow.quiet_hours,
      'max_steps_per_run', selected_flow.max_steps_per_run
    ));
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.pin_automation_run_flow() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_pin_automation_run_flow ON public.automation_runs;
CREATE TRIGGER trg_pin_automation_run_flow
BEFORE INSERT OR UPDATE ON public.automation_runs
FOR EACH ROW EXECUTE FUNCTION public.pin_automation_run_flow();

COMMIT;
