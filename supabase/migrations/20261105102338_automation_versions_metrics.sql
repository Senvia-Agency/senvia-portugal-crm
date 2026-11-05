BEGIN;

CREATE TABLE public.automation_flow_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  flow_id uuid NOT NULL REFERENCES public.automation_flows(id) ON DELETE CASCADE,
  version integer NOT NULL,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (flow_id, version)
);
CREATE INDEX idx_automation_versions_org_flow ON public.automation_flow_versions (organization_id, flow_id, version DESC);
ALTER TABLE public.automation_flow_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members view org automation versions" ON public.automation_flow_versions
FOR SELECT TO authenticated USING (
  public.is_org_member(auth.uid(), organization_id)
  OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
);
GRANT SELECT ON public.automation_flow_versions TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.automation_flow_versions FROM anon, authenticated;

INSERT INTO public.automation_flow_versions (organization_id, flow_id, version, snapshot)
SELECT organization_id, id, version, to_jsonb(flow)
FROM public.automation_flows flow;

CREATE FUNCTION public.number_automation_flow_version()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF (NEW.graph, NEW.trigger_config, NEW.trigger_type, NEW.entry_node_id,
      NEW.quiet_hours, NEW.reentry_policy, NEW.max_steps_per_run)
     IS DISTINCT FROM
     (OLD.graph, OLD.trigger_config, OLD.trigger_type, OLD.entry_node_id,
      OLD.quiet_hours, OLD.reentry_policy, OLD.max_steps_per_run)
     OR (NEW.status = 'active' AND OLD.status <> 'active') THEN
    NEW.version := OLD.version + 1;
  ELSE
    NEW.version := OLD.version;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.number_automation_flow_version() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_number_automation_flow_version BEFORE UPDATE ON public.automation_flows
FOR EACH ROW EXECUTE FUNCTION public.number_automation_flow_version();

CREATE FUNCTION public.archive_automation_flow_version()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.automation_flow_versions (organization_id, flow_id, version, snapshot)
  VALUES (NEW.organization_id, NEW.id, NEW.version, to_jsonb(NEW))
  ON CONFLICT (flow_id, version) DO NOTHING;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.archive_automation_flow_version() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_archive_automation_flow_version AFTER INSERT OR UPDATE ON public.automation_flows
FOR EACH ROW EXECUTE FUNCTION public.archive_automation_flow_version();

CREATE VIEW public.automation_flow_metrics WITH (security_invoker = true) AS
SELECT flow.id AS flow_id, flow.organization_id,
  count(run.id)::integer AS enrolled,
  count(run.id) FILTER (WHERE run.status IN ('running', 'waiting', 'awaiting_reply'))::integer AS active,
  count(run.id) FILTER (WHERE run.status = 'completed')::integer AS completed,
  count(run.id) FILTER (WHERE run.status = 'failed')::integer AS failed,
  count(run.id) FILTER (WHERE run.context ->> '__goal_reached_at' IS NOT NULL)::integer AS converted,
  avg(extract(epoch FROM (run.completed_at - run.started_at)))
    FILTER (WHERE run.context ->> '__goal_reached_at' IS NOT NULL AND run.completed_at IS NOT NULL) AS average_goal_seconds
FROM public.automation_flows flow
LEFT JOIN public.automation_runs run ON run.flow_id = flow.id AND run.organization_id = flow.organization_id
  AND coalesce(run.context ->> '__test', 'false') <> 'true'
GROUP BY flow.id, flow.organization_id;
GRANT SELECT ON public.automation_flow_metrics TO authenticated;

COMMIT;
