CREATE OR REPLACE FUNCTION public.automation_assign_subject(
  p_org_id uuid, p_subject_type text, p_subject_id uuid,
  p_mode text, p_user_ids uuid[] DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  selected_user uuid;
  eligible uuid[];
  position integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service role required'; END IF;
  IF p_subject_type IS NULL OR p_mode IS NULL OR p_subject_type NOT IN ('lead', 'client') OR p_mode NOT IN ('round_robin', 'least_loaded') THEN
    RAISE EXCEPTION 'unsupported assignment';
  END IF;
  PERFORM 1 FROM public.organizations WHERE id = p_org_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'organization not found'; END IF;
  IF p_subject_type = 'lead' THEN
    PERFORM 1 FROM public.leads WHERE id = p_subject_id AND organization_id = p_org_id FOR UPDATE;
  ELSE
    PERFORM 1 FROM public.crm_clients WHERE id = p_subject_id AND organization_id = p_org_id FOR UPDATE;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'subject not found in organization'; END IF;
  SELECT array_agg(m.user_id ORDER BY m.joined_at NULLS LAST, m.user_id) INTO eligible
  FROM public.organization_members m WHERE m.organization_id = p_org_id AND m.is_active
    AND (m.paused_until IS NULL OR m.paused_until <= now())
    AND (p_user_ids IS NULL OR m.user_id = ANY(p_user_ids));
  IF coalesce(array_length(eligible, 1), 0) = 0 THEN RAISE EXCEPTION 'no eligible members'; END IF;
  IF p_mode = 'least_loaded' THEN
    SELECT candidate INTO selected_user FROM unnest(eligible) AS candidate
    ORDER BY (SELECT count(*) FROM public.leads l WHERE l.organization_id = p_org_id
      AND l.assigned_to = candidate AND l.archived_at IS NULL
      AND coalesce(l.status, '') NOT IN ('won', 'lost')
      AND NOT EXISTS (SELECT 1 FROM public.pipeline_stages stage
        WHERE stage.organization_id = p_org_id AND stage.key = l.status
          AND (stage.is_final_positive OR stage.is_final_negative))), candidate LIMIT 1;
  ELSE
    SELECT coalesce((sales_settings->>'automation_round_robin_index')::integer, 0) INTO position
      FROM public.organizations WHERE id = p_org_id;
    position := mod(greatest(position, 0), array_length(eligible, 1));
    selected_user := eligible[position + 1];
    UPDATE public.organizations SET sales_settings = jsonb_set(coalesce(sales_settings, '{}'::jsonb),
      '{automation_round_robin_index}', to_jsonb(position + 1)) WHERE id = p_org_id;
  END IF;
  IF p_subject_type = 'lead' THEN
    UPDATE public.leads SET assigned_to = selected_user WHERE id = p_subject_id AND organization_id = p_org_id;
  ELSE
    UPDATE public.crm_clients SET assigned_to = selected_user WHERE id = p_subject_id AND organization_id = p_org_id;
  END IF;
  RETURN selected_user;
END;
$$;
REVOKE ALL ON FUNCTION public.automation_assign_subject(uuid,text,uuid,text,uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.automation_assign_subject(uuid,text,uuid,text,uuid[]) TO service_role;
