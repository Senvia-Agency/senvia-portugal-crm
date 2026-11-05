BEGIN;
CREATE TABLE public.automation_template_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  source_flow_id uuid NOT NULL REFERENCES public.automation_flows(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  token_hash text UNIQUE NOT NULL CHECK(token_hash ~ '^[0-9a-f]{64}$'),
  template jsonb NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT now()+interval '14 days',
  accepted_at timestamptz,
  target_organization_id uuid REFERENCES public.organizations(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.automation_template_invites ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.automation_template_invites FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.automation_template_invites TO service_role;

CREATE FUNCTION public.sanitize_automation_template(p_value jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
DECLARE cleaned jsonb; source_value jsonb := p_value; item record;
BEGIN
  IF jsonb_typeof(source_value)='array' THEN
    SELECT coalesce(jsonb_agg(public.sanitize_automation_template(element)),'[]'::jsonb)
      INTO cleaned FROM jsonb_array_elements(source_value) AS element;
    RETURN cleaned;
  END IF;
  IF jsonb_typeof(source_value)<>'object' THEN RETURN source_value; END IF;
  IF (source_value->>'field') ~ '(_id|_ids)$'
    OR source_value->>'field' IN ('stage','to_stage','from_stage','assigned_to') THEN
    source_value := source_value - 'value';
  END IF;
  cleaned := '{}'::jsonb;
  FOR item IN SELECT entry.key,entry.value AS content FROM jsonb_each(source_value) AS entry LOOP
    IF item.key ~* '(secret|password|token|credential|api_key|authorization)'
      OR (item.key ~ '(_id|_ids)$' AND item.key <> 'entry_node_id')
      OR item.key IN ('stage','to_stage','from_stage','assigned_to','media','media_url','meeting_link','url','headers','body','recipe_required_fields') THEN
      CONTINUE;
    END IF;
    cleaned := cleaned || jsonb_build_object(item.key,public.sanitize_automation_template(item.content));
  END LOOP;
  RETURN cleaned;
END;
$$;
REVOKE ALL ON FUNCTION public.sanitize_automation_template(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sanitize_automation_template(jsonb) TO service_role;

CREATE FUNCTION public.create_automation_template_invite(p_flow_id uuid,p_actor_id uuid,p_token_hash text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE source public.automation_flows%ROWTYPE; invitation uuid; payload jsonb; required jsonb; node jsonb; field_name text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service role required'; END IF;
  SELECT * INTO source FROM public.automation_flows WHERE id=p_flow_id;
  IF NOT FOUND OR p_actor_id IS NULL OR NOT public.is_org_admin(p_actor_id,source.organization_id) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  payload := public.sanitize_automation_template(jsonb_build_object(
    'name',source.name,'description',source.description,'trigger_type',source.trigger_type,
    'trigger_config',source.trigger_config,'graph',source.graph,'entry_node_id',source.entry_node_id,
    'quiet_hours',source.quiet_hours,'max_steps_per_run',source.max_steps_per_run,'reentry_policy',source.reentry_policy
  ));
  required := '[]'::jsonb;
  FOR node IN SELECT element FROM jsonb_array_elements(source.graph->'nodes') AS element LOOP
    FOREACH field_name IN ARRAY ARRAY['channel_id','user_id','user_ids','list_id','template_id','form_id','flow_id','url','stage','to_stage','from_stage'] LOOP
      IF node->'config' ? field_name AND node->'config'->field_name NOT IN ('null'::jsonb,'""'::jsonb,'[]'::jsonb) THEN
        required := required || jsonb_build_array(jsonb_build_object(
          'node_id',node->>'id','field',field_name,'label','Escolha novamente a configuração de '||field_name||' nesta organização.'
        ));
      END IF;
    END LOOP;
  END LOOP;
  payload := jsonb_set(payload,'{trigger_config}',
    coalesce(nullif(payload->'trigger_config','null'::jsonb),'{}'::jsonb)
      ||jsonb_build_object('recipe_required_fields',required));
  INSERT INTO public.automation_template_invites(source_organization_id,source_flow_id,created_by,token_hash,template)
    VALUES(source.organization_id,source.id,p_actor_id,p_token_hash,payload) RETURNING id INTO invitation;
  RETURN invitation;
END;
$$;
REVOKE ALL ON FUNCTION public.create_automation_template_invite(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_automation_template_invite(uuid,uuid,text) TO service_role;

CREATE FUNCTION public.accept_automation_template_invite(p_token_hash text,p_target_org_id uuid,p_actor_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE invitation public.automation_template_invites%ROWTYPE; created_flow uuid; payload jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service role required'; END IF;
  IF p_actor_id IS NULL OR NOT public.is_org_admin(p_actor_id,p_target_org_id) THEN RAISE EXCEPTION 'not authorized'; END IF;
  SELECT * INTO invitation FROM public.automation_template_invites WHERE token_hash=p_token_hash FOR UPDATE;
  IF NOT FOUND OR invitation.accepted_at IS NOT NULL OR invitation.expires_at<=now() THEN RAISE EXCEPTION 'invalid or expired invitation'; END IF;
  IF NOT public.is_org_admin(invitation.created_by,invitation.source_organization_id) THEN RAISE EXCEPTION 'invitation no longer authorized'; END IF;
  payload := invitation.template;
  INSERT INTO public.automation_flows(
    organization_id,name,description,status,trigger_type,trigger_config,graph,entry_node_id,
    version,reentry_policy,quiet_hours,max_steps_per_run,created_by
  ) VALUES(
    p_target_org_id,coalesce(payload->>'name','Modelo importado'),payload->>'description','draft',payload->>'trigger_type',
    payload->'trigger_config',payload->'graph',payload->>'entry_node_id',1,coalesce(payload->>'reentry_policy','once'),
    nullif(payload->'quiet_hours','null'::jsonb),coalesce((payload->>'max_steps_per_run')::integer,100),p_actor_id
  ) RETURNING id INTO created_flow;
  UPDATE public.automation_template_invites SET accepted_at=now(),target_organization_id=p_target_org_id WHERE id=invitation.id;
  RETURN created_flow;
END;
$$;
REVOKE ALL ON FUNCTION public.accept_automation_template_invite(text,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.accept_automation_template_invite(text,uuid,uuid) TO service_role;
COMMIT;
