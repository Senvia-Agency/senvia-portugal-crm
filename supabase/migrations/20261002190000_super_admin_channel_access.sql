BEGIN;

CREATE OR REPLACE FUNCTION public.pode_aceder_caixa(_user_id uuid, _channel_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.meets_mfa_policy(_user_id) AND (
    public.has_role(_user_id, 'super_admin'::app_role)
    OR EXISTS (
      SELECT 1
        FROM public.messaging_channels c
       WHERE c.id = _channel_id
         AND public.is_org_member(_user_id, c.organization_id)
         AND (
           c.assigned_user_ids IS NULL
           OR cardinality(c.assigned_user_ids) = 0
           OR _user_id = ANY (c.assigned_user_ids)
           OR public.is_org_admin(_user_id, c.organization_id)
         )
    )
  );
$$;

REVOKE ALL ON FUNCTION public.pode_aceder_caixa(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pode_aceder_caixa(uuid, uuid) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';

COMMIT;
