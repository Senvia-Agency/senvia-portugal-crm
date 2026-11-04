CREATE TABLE public.otto_pending_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  module_key text NOT NULL CHECK (length(module_key) BETWEEN 1 AND 64),
  tool text NOT NULL CHECK (length(tool) BETWEEN 1 AND 128 AND tool = btrim(tool)),
  args_digest text NOT NULL CHECK (args_digest ~ '^[0-9a-f]{64}$'),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'consumed', 'expired', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '5 minutes'),
  resolved_at timestamptz,
  CONSTRAINT otto_pending_actions_resolution_check CHECK (
    (status = 'pending' AND resolved_at IS NULL)
    OR (status <> 'pending' AND resolved_at IS NOT NULL)
  ),
  CONSTRAINT otto_pending_actions_expiry_check CHECK (
    expires_at = created_at + interval '5 minutes'
  )
);

CREATE INDEX otto_pending_actions_pending_expiry_idx
  ON public.otto_pending_actions (expires_at)
  WHERE status = 'pending';

ALTER TABLE public.otto_pending_actions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.otto_pending_actions FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.otto_pending_actions TO service_role;

COMMENT ON TABLE public.otto_pending_actions IS
  'Short-lived Otto write confirmations retained with their terminal status for audit and replay diagnostics.';
COMMENT ON COLUMN public.otto_pending_actions.payload IS
  'Exact server-side action arguments. Provider credentials and other secrets must never be stored here.';

CREATE FUNCTION public.prepare_otto_pending_action(
  p_user_id uuid,
  p_organization_id uuid,
  p_module_key text,
  p_tool text,
  p_args_digest text,
  p_payload jsonb
)
RETURNS TABLE (
  confirmation_id uuid,
  args_digest text,
  expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  INSERT INTO public.otto_pending_actions (
    user_id,
    organization_id,
    module_key,
    tool,
    args_digest,
    payload
  )
  VALUES (
    p_user_id,
    p_organization_id,
    p_module_key,
    p_tool,
    p_args_digest,
    p_payload
  )
  RETURNING
    otto_pending_actions.id,
    otto_pending_actions.args_digest,
    otto_pending_actions.expires_at;
END;
$$;

CREATE FUNCTION public.consume_otto_pending_action(
  p_action_id uuid,
  p_user_id uuid,
  p_organization_id uuid,
  p_module_key text,
  p_tool text
)
RETURNS TABLE (
  action_id uuid,
  args_digest text,
  payload jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamptz := statement_timestamp();
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  UPDATE public.otto_pending_actions AS pending_action
  SET status = 'consumed', resolved_at = v_now
  WHERE pending_action.id = p_action_id
    AND pending_action.user_id = p_user_id
    AND pending_action.organization_id = p_organization_id
    AND pending_action.module_key = p_module_key
    AND pending_action.tool = p_tool
    AND pending_action.status = 'pending'
    AND pending_action.expires_at > v_now
  RETURNING pending_action.id, pending_action.args_digest, pending_action.payload;

  IF FOUND THEN
    RETURN;
  END IF;

  UPDATE public.otto_pending_actions AS pending_action
  SET status = 'expired', resolved_at = v_now
  WHERE pending_action.id = p_action_id
    AND pending_action.user_id = p_user_id
    AND pending_action.organization_id = p_organization_id
    AND pending_action.module_key = p_module_key
    AND pending_action.tool = p_tool
    AND pending_action.status = 'pending'
    AND pending_action.expires_at <= v_now;
END;
$$;

CREATE FUNCTION public.cancel_otto_pending_action(
  p_action_id uuid,
  p_user_id uuid,
  p_organization_id uuid,
  p_module_key text,
  p_tool text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamptz := statement_timestamp();
  v_cancelled boolean;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;

  UPDATE public.otto_pending_actions AS pending_action
  SET status = 'expired', resolved_at = v_now
  WHERE pending_action.id = p_action_id
    AND pending_action.user_id = p_user_id
    AND pending_action.organization_id = p_organization_id
    AND pending_action.module_key = p_module_key
    AND pending_action.tool = p_tool
    AND pending_action.status = 'pending'
    AND pending_action.expires_at <= v_now;

  UPDATE public.otto_pending_actions AS pending_action
  SET status = 'cancelled', resolved_at = v_now
  WHERE pending_action.id = p_action_id
    AND pending_action.user_id = p_user_id
    AND pending_action.organization_id = p_organization_id
    AND pending_action.module_key = p_module_key
    AND pending_action.tool = p_tool
    AND pending_action.status = 'pending'
    AND pending_action.expires_at > v_now
  RETURNING true INTO v_cancelled;

  RETURN coalesce(v_cancelled, false);
END;
$$;

REVOKE ALL ON FUNCTION public.prepare_otto_pending_action(
  uuid, uuid, text, text, text, jsonb
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.consume_otto_pending_action(
  uuid, uuid, uuid, text, text
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cancel_otto_pending_action(
  uuid, uuid, uuid, text, text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.prepare_otto_pending_action(
  uuid, uuid, text, text, text, jsonb
) TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_otto_pending_action(
  uuid, uuid, uuid, text, text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_otto_pending_action(
  uuid, uuid, uuid, text, text
) TO service_role;
