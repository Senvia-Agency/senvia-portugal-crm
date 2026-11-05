BEGIN;
CREATE TABLE public.automation_action_effects (
  run_id uuid NOT NULL REFERENCES public.automation_runs(id) ON DELETE CASCADE,
  node_id text NOT NULL, action text NOT NULL,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(run_id,node_id,action)
);
ALTER TABLE public.automation_action_effects ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.automation_action_effects FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.automation_action_effects TO service_role;

CREATE FUNCTION public.automation_apply_record_action(p_org_id uuid,p_run_id uuid,p_node_id text,p_action text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  run public.automation_runs%ROWTYPE;
  existing jsonb; result jsonb; selected_stage text; target_id uuid; assignee uuid;
  effective_type text; effective_id uuid; affected integer; reason text; old_skip text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service role required'; END IF;
  IF nullif(p_node_id,'') IS NULL OR p_action IS NULL OR p_action NOT IN ('create_lead','mark_lead_lost','complete_record_tasks') THEN RAISE EXCEPTION 'invalid action'; END IF;
  SELECT * INTO run FROM public.automation_runs WHERE id=p_run_id AND organization_id=p_org_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'run not found in organization'; END IF;
  SELECT e.result INTO existing FROM public.automation_action_effects e WHERE e.run_id=p_run_id AND e.node_id=p_node_id AND e.action=p_action;
  IF existing IS NOT NULL THEN RETURN existing; END IF;
  IF run.status NOT IN ('running','waiting','awaiting_reply') THEN RAISE EXCEPTION 'run is not active'; END IF;
  effective_type:=run.subject_type; effective_id:=run.subject_id;
  IF run.context ? '__action_target' AND p_action<>'create_lead' THEN
    effective_type:=run.context->'__action_target'->>'type';
    effective_id:=(run.context->'__action_target'->>'id')::uuid;
    IF effective_type='lead' THEN
      PERFORM 1 FROM public.leads WHERE id=effective_id AND organization_id=p_org_id;
    ELSIF effective_type='client' THEN
      PERFORM 1 FROM public.crm_clients WHERE id=effective_id AND organization_id=p_org_id;
    ELSE RAISE EXCEPTION 'record action requires lead or client target';
    END IF;
    IF NOT FOUND THEN RAISE EXCEPTION 'action target outside organization'; END IF;
  END IF;
  IF p_action='create_lead' THEN
    IF nullif(trim(p_payload->>'name'),'') IS NULL OR (nullif(trim(p_payload->>'email'),'') IS NULL AND nullif(trim(p_payload->>'phone'),'') IS NULL) THEN RAISE EXCEPTION 'lead requires name and email or phone'; END IF;
    assignee:=nullif(p_payload->>'user_id','')::uuid;
    IF assignee IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.organization_members m WHERE m.organization_id=p_org_id AND m.user_id=assignee AND m.is_active) THEN RAISE EXCEPTION 'assignee not in organization'; END IF;
    old_skip:=current_setting('app.skip_lead_side_effects',true);
    PERFORM set_config('app.skip_lead_side_effects','on',true);
    INSERT INTO public.leads(organization_id,name,email,phone,source,assigned_to)
      VALUES(p_org_id,trim(p_payload->>'name'),coalesce(p_payload->>'email',''),coalesce(p_payload->>'phone',''),coalesce(nullif(p_payload->>'source',''),'automation'),assignee) RETURNING id INTO target_id;
    PERFORM set_config('app.skip_lead_side_effects',coalesce(old_skip,''),true);
    result:=jsonb_build_object('lead_id',target_id);
  ELSIF p_action='mark_lead_lost' THEN
    IF effective_type<>'lead' OR effective_id IS NULL THEN RAISE EXCEPTION 'action requires lead subject'; END IF;
    reason:=nullif(trim(p_payload->>'reason'),'');
    IF reason IS NULL THEN RAISE EXCEPTION 'loss reason required'; END IF;
    SELECT s.key INTO selected_stage FROM public.pipeline_stages s WHERE s.organization_id=p_org_id AND s.is_final_negative
      AND (nullif(p_payload->>'stage','') IS NULL OR s.key=p_payload->>'stage') ORDER BY s.position,s.id LIMIT 1;
    IF selected_stage IS NULL THEN RAISE EXCEPTION 'configure a final negative stage'; END IF;
    UPDATE public.leads SET status=selected_stage,notes=concat_ws(E'\n',nullif(notes,''),'Motivo de perda: '||reason) WHERE id=effective_id AND organization_id=p_org_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'lead not found'; END IF;
    result:=jsonb_build_object('etapa',selected_stage,'motivo',reason);
  ELSE
    IF effective_type NOT IN ('lead','client') OR effective_id IS NULL THEN RAISE EXCEPTION 'action requires lead or client'; END IF;
    UPDATE public.inbox_tasks SET done_at=now() WHERE organization_id=p_org_id AND done_at IS NULL
      AND ((effective_type='lead' AND lead_id=effective_id) OR (effective_type='client' AND client_id=effective_id));
    GET DIAGNOSTICS affected=ROW_COUNT;
    result:=jsonb_build_object('tarefas_concluidas',affected);
  END IF;
  INSERT INTO public.automation_action_effects(run_id,node_id,action,organization_id,result) VALUES(p_run_id,p_node_id,p_action,p_org_id,result);
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.automation_apply_record_action(uuid,uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.automation_apply_record_action(uuid,uuid,text,text,jsonb) TO service_role;
COMMIT;
