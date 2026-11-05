BEGIN;
CREATE FUNCTION public.automation_expire_proposal(p_org_id uuid,p_run_id uuid,p_node_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  run public.automation_runs%ROWTYPE;
  proposal public.proposals%ROWTYPE;
  result jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service role required'; END IF;
  IF nullif(p_node_id,'') IS NULL THEN RAISE EXCEPTION 'node required'; END IF;
  SELECT * INTO run FROM public.automation_runs WHERE id=p_run_id AND organization_id=p_org_id FOR UPDATE;
  IF NOT FOUND OR run.subject_type<>'proposal' OR run.subject_id IS NULL THEN RAISE EXCEPTION 'proposal run required'; END IF;
  SELECT e.result INTO result FROM public.automation_action_effects e
    WHERE e.run_id=p_run_id AND e.node_id=p_node_id AND e.action='mark_proposal_expired';
  IF result IS NOT NULL THEN RETURN result; END IF;
  IF run.status NOT IN ('running','waiting','awaiting_reply') THEN RAISE EXCEPTION 'run is not active'; END IF;
  SELECT * INTO proposal FROM public.proposals WHERE id=run.subject_id AND organization_id=p_org_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'proposal not found in organization'; END IF;
  IF proposal.status='expired' THEN
    result:=jsonb_build_object('proposta_id',proposal.id,'estado','expired','ja_expirada',true);
  ELSE
    IF proposal.status NOT IN ('draft','sent') THEN RAISE EXCEPTION 'only draft or sent proposals can expire automatically'; END IF;
    IF proposal.valid_until IS NULL THEN RAISE EXCEPTION 'explicit validity date required'; END IF;
    IF proposal.valid_until >= (now() AT TIME ZONE 'Europe/Lisbon')::date THEN RAISE EXCEPTION 'proposal is still valid'; END IF;
    UPDATE public.proposals SET status='expired',updated_at=now() WHERE id=proposal.id AND organization_id=p_org_id;
    result:=jsonb_build_object('proposta_id',proposal.id,'estado','expired','validade',proposal.valid_until);
  END IF;
  INSERT INTO public.automation_action_effects(run_id,node_id,action,organization_id,result)
    VALUES(p_run_id,p_node_id,'mark_proposal_expired',p_org_id,result);
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.automation_expire_proposal(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.automation_expire_proposal(uuid,uuid,text) TO service_role;
COMMIT;
