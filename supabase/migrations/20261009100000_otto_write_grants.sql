BEGIN;

CREATE TABLE public.otto_write_grants (
  organization_id uuid NOT NULL
    REFERENCES public.organizations(id) ON DELETE CASCADE,
  module_key text NOT NULL,
  is_granted boolean NOT NULL DEFAULT false,
  granted_by uuid,
  granted_at timestamptz,
  revoked_by uuid,
  revoked_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, module_key),
  CONSTRAINT otto_write_grants_module_key_check CHECK (
    module_key = ANY (ARRAY[
      'clients',
      'leads',
      'sales',
      'proposals',
      'finance',
      'calendar',
      'marketing',
      'inbox',
      'prospects',
      'portal_total_link',
      'automations',
      'settings',
      'support'
    ]::text[])
  ),
  CONSTRAINT otto_write_grants_granted_actor_check CHECK (
    (granted_by IS NULL) = (granted_at IS NULL)
  ),
  CONSTRAINT otto_write_grants_revoked_actor_check CHECK (
    (revoked_by IS NULL) = (revoked_at IS NULL)
  ),
  CONSTRAINT otto_write_grants_active_state_check CHECK (
    NOT is_granted
    OR (granted_at IS NOT NULL AND revoked_at IS NULL)
  )
);

CREATE TABLE public.otto_write_grant_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL
    REFERENCES public.organizations(id) ON DELETE CASCADE,
  module_key text NOT NULL,
  action text NOT NULL,
  changed_by uuid NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT otto_write_grant_history_module_key_check CHECK (
    module_key = ANY (ARRAY[
      'clients',
      'leads',
      'sales',
      'proposals',
      'finance',
      'calendar',
      'marketing',
      'inbox',
      'prospects',
      'portal_total_link',
      'automations',
      'settings',
      'support'
    ]::text[])
  ),
  CONSTRAINT otto_write_grant_history_action_check CHECK (
    action IN ('grant', 'revoke')
  )
);

CREATE INDEX otto_write_grant_history_org_changed_idx
  ON public.otto_write_grant_history (
    organization_id,
    changed_at DESC,
    id DESC
  );

ALTER TABLE public.otto_write_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.otto_write_grant_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY otto_write_grants_admin_select
  ON public.otto_write_grants
  FOR SELECT
  TO authenticated
  USING (public.is_org_admin(auth.uid(), organization_id));

CREATE POLICY otto_write_grant_history_admin_select
  ON public.otto_write_grant_history
  FOR SELECT
  TO authenticated
  USING (public.is_org_admin(auth.uid(), organization_id));

CREATE FUNCTION public.reject_otto_write_grant_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'Otto write grant history is append-only'
    USING ERRCODE = '42501';
END;
$$;

CREATE TRIGGER otto_write_grant_history_append_only
  BEFORE UPDATE OR DELETE ON public.otto_write_grant_history
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_otto_write_grant_history_mutation();

CREATE FUNCTION public.set_otto_write_grant(
  _org_id uuid,
  _module_key text,
  _is_granted boolean
)
RETURNS public.otto_write_grants
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor_id uuid := auth.uid();
  changed_at timestamptz := now();
  grant_row public.otto_write_grants%ROWTYPE;
BEGIN
  IF actor_id IS NULL OR NOT public.meets_mfa_policy(actor_id) THEN
    RAISE EXCEPTION 'Not authorized'
      USING ERRCODE = '42501';
  END IF;

  IF _org_id IS NULL OR NOT public.is_org_admin(actor_id, _org_id) THEN
    RAISE EXCEPTION 'Not authorized'
      USING ERRCODE = '42501';
  END IF;

  IF _module_key IS NULL OR NOT (
    _module_key = ANY (ARRAY[
      'clients',
      'leads',
      'sales',
      'proposals',
      'finance',
      'calendar',
      'marketing',
      'inbox',
      'prospects',
      'portal_total_link',
      'automations',
      'settings',
      'support'
    ]::text[])
  ) THEN
    RAISE EXCEPTION 'Invalid Otto module key'
      USING ERRCODE = '22023';
  END IF;

  IF _is_granted IS NULL THEN
    RAISE EXCEPTION 'Grant state is required'
      USING ERRCODE = '22004';
  END IF;

  INSERT INTO public.otto_write_grants AS existing (
    organization_id,
    module_key,
    is_granted,
    granted_by,
    granted_at,
    revoked_by,
    revoked_at,
    updated_at
  )
  VALUES (
    _org_id,
    _module_key,
    _is_granted,
    CASE WHEN _is_granted THEN actor_id END,
    CASE WHEN _is_granted THEN changed_at END,
    CASE WHEN NOT _is_granted THEN actor_id END,
    CASE WHEN NOT _is_granted THEN changed_at END,
    changed_at
  )
  ON CONFLICT (organization_id, module_key) DO UPDATE
  SET
    is_granted = EXCLUDED.is_granted,
    granted_by = CASE
      WHEN EXCLUDED.is_granted THEN EXCLUDED.granted_by
      ELSE existing.granted_by
    END,
    granted_at = CASE
      WHEN EXCLUDED.is_granted THEN EXCLUDED.granted_at
      ELSE existing.granted_at
    END,
    revoked_by = CASE
      WHEN EXCLUDED.is_granted THEN NULL
      ELSE EXCLUDED.revoked_by
    END,
    revoked_at = CASE
      WHEN EXCLUDED.is_granted THEN NULL
      ELSE EXCLUDED.revoked_at
    END,
    updated_at = EXCLUDED.updated_at
  WHERE existing.is_granted IS DISTINCT FROM EXCLUDED.is_granted
  RETURNING * INTO grant_row;

  IF NOT FOUND THEN
    SELECT grants.*
    INTO STRICT grant_row
    FROM public.otto_write_grants AS grants
    WHERE grants.organization_id = _org_id
      AND grants.module_key = _module_key;

    RETURN grant_row;
  END IF;

  INSERT INTO public.otto_write_grant_history (
    organization_id,
    module_key,
    action,
    changed_by,
    changed_at
  )
  VALUES (
    _org_id,
    _module_key,
    CASE WHEN _is_granted THEN 'grant' ELSE 'revoke' END,
    actor_id,
    changed_at
  );

  RETURN grant_row;
END;
$$;

REVOKE ALL ON TABLE public.otto_write_grants
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.otto_write_grant_history
  FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT ON TABLE public.otto_write_grants
  TO authenticated, service_role;
GRANT SELECT ON TABLE public.otto_write_grant_history
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.reject_otto_write_grant_history_mutation()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.set_otto_write_grant(uuid, text, boolean)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.set_otto_write_grant(uuid, text, boolean)
  TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
