-- A configured workflow may reach existing records immediately after activation.
-- A UI-only preview is therefore not a sufficient guard: every transition to
-- active must consume a short-lived, server-recorded proof of the exact flow
-- version and graph that an authenticated administrator reviewed.

ALTER TABLE public.automation_flows
  ADD COLUMN IF NOT EXISTS activated_by uuid;

CREATE TABLE public.automation_workflow_activation_previews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  flow_id uuid NOT NULL REFERENCES public.automation_flows(id) ON DELETE CASCADE,
  flow_version integer NOT NULL CHECK (flow_version > 0),
  flow_updated_at timestamptz NOT NULL,
  flow_status text NOT NULL CHECK (flow_status IN ('draft', 'paused')),
  flow_graph jsonb NOT NULL,
  flow_trigger_config jsonb NOT NULL,
  flow_entry_node_id text,
  previewed_by uuid NOT NULL,
  data_scope text NOT NULL DEFAULT 'all' CHECK (data_scope = 'all'),
  snapshot_digest text NOT NULL CHECK (snapshot_digest ~ '^[0-9a-f]{64}$'),
  scanned_records integer NOT NULL CHECK (scanned_records >= 0),
  eligible_records integer NOT NULL CHECK (
    eligible_records >= 0 AND eligible_records <= scanned_records
  ),
  eligible_stages integer NOT NULL CHECK (eligible_stages >= 0),
  stage_counts jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(stage_counts) = 'array'),
  observed_local_date date NOT NULL,
  time_zone text NOT NULL CHECK (length(btrim(time_zone)) > 0),
  requires_revalidation boolean NOT NULL DEFAULT true CHECK (requires_revalidation),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CHECK (expires_at > created_at),
  CHECK (consumed_at IS NULL OR consumed_at >= created_at)
);

CREATE INDEX automation_workflow_activation_previews_flow_idx
  ON public.automation_workflow_activation_previews (flow_id, expires_at DESC)
  WHERE consumed_at IS NULL;

ALTER TABLE public.automation_workflow_activation_previews ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.automation_workflow_activation_previews
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.record_configured_workflow_activation_preview(
  p_flow_id uuid,
  p_previewed_by uuid,
  p_snapshot_digest text,
  p_scanned_records integer,
  p_eligible_records integer,
  p_eligible_stages integer,
  p_stage_counts jsonb,
  p_observed_local_date date,
  p_time_zone text
)
RETURNS TABLE(preview_id uuid, expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_flow public.automation_flows%ROWTYPE;
  v_preview_id uuid := gen_random_uuid();
  v_expires_at timestamptz := clock_timestamp() + interval '5 minutes';
  v_stage_total bigint;
BEGIN
  SELECT * INTO v_flow
  FROM public.automation_flows
  WHERE id = p_flow_id
  FOR SHARE;

  IF NOT FOUND
    OR v_flow.trigger_type <> 'configured_workflow'
    OR v_flow.status NOT IN ('draft', 'paused') THEN
    RAISE EXCEPTION 'configured workflow is not previewable' USING ERRCODE = '22023';
  END IF;

  IF p_previewed_by IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.organization_members om
    LEFT JOIN public.organization_profiles op
      ON op.id = om.profile_id AND op.organization_id = om.organization_id
    WHERE om.user_id = p_previewed_by
      AND om.organization_id = v_flow.organization_id
      AND om.is_active
      AND (om.role = 'admin' OR op.base_role = 'admin')
  ) THEN
    RAISE EXCEPTION 'preview actor is not an active organization administrator'
      USING ERRCODE = '42501';
  END IF;

  IF p_snapshot_digest IS NULL OR p_snapshot_digest !~ '^[0-9a-f]{64}$'
    OR p_scanned_records < 0
    OR p_eligible_records < 0
    OR p_eligible_records > p_scanned_records
    OR p_eligible_stages < 0
    OR jsonb_typeof(p_stage_counts) IS DISTINCT FROM 'array'
    OR p_observed_local_date IS NULL
    OR nullif(btrim(p_time_zone), '') IS NULL THEN
    RAISE EXCEPTION 'invalid configured workflow preview' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_stage_counts) item
    WHERE jsonb_typeof(item) <> 'object'
      OR (item->>'stageId') IS NULL
      OR (item->>'nodeId') IS NULL
      OR (item->>'eligibleRecords') !~ '^[0-9]+$'
  ) THEN
    RAISE EXCEPTION 'invalid configured workflow stage counts' USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(sum((item->>'eligibleRecords')::bigint), 0)
  INTO v_stage_total
  FROM jsonb_array_elements(p_stage_counts) item;

  IF v_stage_total <> p_eligible_stages THEN
    RAISE EXCEPTION 'configured workflow stage total does not match preview'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.automation_workflow_activation_previews (
    id, organization_id, flow_id, flow_version, flow_updated_at, flow_status,
    flow_graph, flow_trigger_config, flow_entry_node_id, previewed_by,
    snapshot_digest, scanned_records, eligible_records, eligible_stages,
    stage_counts, observed_local_date, time_zone, expires_at
  ) VALUES (
    v_preview_id, v_flow.organization_id, v_flow.id, v_flow.version,
    v_flow.updated_at, v_flow.status, v_flow.graph, v_flow.trigger_config,
    v_flow.entry_node_id, p_previewed_by, p_snapshot_digest,
    p_scanned_records, p_eligible_records, p_eligible_stages,
    p_stage_counts, p_observed_local_date, p_time_zone, v_expires_at
  );

  RETURN QUERY SELECT v_preview_id, v_expires_at;
END;
$$;

REVOKE ALL ON FUNCTION public.record_configured_workflow_activation_preview(
  uuid, uuid, text, integer, integer, integer, jsonb, date, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_configured_workflow_activation_preview(
  uuid, uuid, text, integer, integer, integer, jsonb, date, text
) TO service_role;

CREATE OR REPLACE FUNCTION public.guard_configured_workflow_activation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_preview_id uuid;
  v_digest text;
  v_activated_by uuid;
BEGIN
  IF NEW.trigger_type <> 'configured_workflow' THEN
    IF TG_OP = 'UPDATE'
      AND OLD.trigger_type = 'configured_workflow'
      AND NEW.activated_by IS DISTINCT FROM OLD.activated_by THEN
      RAISE EXCEPTION 'configured workflow activation actor is server-managed'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.activated_by IS NOT NULL THEN
      RAISE EXCEPTION 'configured workflow activation actor is server-managed'
        USING ERRCODE = '42501';
    END IF;
    IF NEW.status = 'active' THEN
      RAISE EXCEPTION 'configured workflows must be activated from a reviewed preview'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status <> 'active' THEN
    IF NEW.activated_by IS DISTINCT FROM OLD.activated_by THEN
      RAISE EXCEPTION 'configured workflow activation actor is server-managed'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.trigger_type = 'configured_workflow' AND OLD.status = 'active' THEN
    IF NEW.graph IS DISTINCT FROM OLD.graph
      OR NEW.trigger_config IS DISTINCT FROM OLD.trigger_config
      OR NEW.entry_node_id IS DISTINCT FROM OLD.entry_node_id
      OR NEW.version IS DISTINCT FROM OLD.version
      OR NEW.reentry_policy IS DISTINCT FROM OLD.reentry_policy
      OR NEW.quiet_hours IS DISTINCT FROM OLD.quiet_hours
      OR NEW.max_steps_per_run IS DISTINCT FROM OLD.max_steps_per_run
      OR NEW.activated_by IS DISTINCT FROM OLD.activated_by THEN
      RAISE EXCEPTION 'pause and review the configured workflow before changing active behavior'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  BEGIN
    v_preview_id := nullif(
      current_setting('request.configured_workflow_activation_preview', true), ''
    )::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    v_preview_id := NULL;
  END;
  v_digest := nullif(
    current_setting('request.configured_workflow_activation_digest', true), ''
  );

  IF v_preview_id IS NULL OR v_digest IS NULL
    OR NEW.version <> OLD.version + 1
    OR NEW.organization_id <> OLD.organization_id
    OR NEW.graph IS DISTINCT FROM OLD.graph
    OR NEW.trigger_config IS DISTINCT FROM OLD.trigger_config
    OR NEW.entry_node_id IS DISTINCT FROM OLD.entry_node_id THEN
    RAISE EXCEPTION 'configured workflow activation proof is missing or stale'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.automation_workflow_activation_previews proof
  SET consumed_at = clock_timestamp()
  WHERE proof.id = v_preview_id
    AND proof.organization_id = OLD.organization_id
    AND proof.flow_id = OLD.id
    AND proof.flow_version = OLD.version
    AND proof.flow_updated_at = OLD.updated_at
    AND proof.flow_status = OLD.status
    AND proof.flow_graph = OLD.graph
    AND proof.flow_trigger_config = OLD.trigger_config
    AND proof.flow_entry_node_id IS NOT DISTINCT FROM OLD.entry_node_id
    AND proof.previewed_by = auth.uid()
    AND proof.data_scope = 'all'
    AND proof.snapshot_digest = v_digest
    AND proof.requires_revalidation
    AND proof.expires_at > clock_timestamp()
    AND proof.consumed_at IS NULL
  RETURNING proof.previewed_by INTO v_activated_by;

  IF NOT FOUND OR v_activated_by IS NULL THEN
    RAISE EXCEPTION 'configured workflow activation proof is invalid, expired, or consumed'
      USING ERRCODE = '42501';
  END IF;

  NEW.activated_by := v_activated_by;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_configured_workflow_activation()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_configured_workflow_activation_guard
  ON public.automation_flows;
CREATE TRIGGER trg_configured_workflow_activation_guard
  BEFORE INSERT OR UPDATE ON public.automation_flows
  FOR EACH ROW EXECUTE FUNCTION public.guard_configured_workflow_activation();

CREATE OR REPLACE FUNCTION public.activate_configured_workflow_from_preview(
  p_preview_id uuid,
  p_snapshot_digest text
)
RETURNS SETOF public.automation_flows
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_proof public.automation_workflow_activation_previews%ROWTYPE;
  v_flow public.automation_flows%ROWTYPE;
BEGIN
  IF v_actor IS NULL
    OR auth.jwt()->>'aal' IS DISTINCT FROM 'aal2' THEN
    RAISE EXCEPTION 'MFA-authenticated user required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_proof
  FROM public.automation_workflow_activation_previews
  WHERE id = p_preview_id
  FOR UPDATE;

  IF NOT FOUND
    OR v_proof.previewed_by <> v_actor
    OR v_proof.snapshot_digest <> p_snapshot_digest
    OR v_proof.data_scope <> 'all'
    OR NOT v_proof.requires_revalidation
    OR v_proof.expires_at <= clock_timestamp()
    OR v_proof.consumed_at IS NOT NULL THEN
    RAISE EXCEPTION 'configured workflow activation preview is invalid, expired, or consumed'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.organization_members om
    LEFT JOIN public.organization_profiles op
      ON op.id = om.profile_id AND op.organization_id = om.organization_id
    WHERE om.user_id = v_actor
      AND om.organization_id = v_proof.organization_id
      AND om.is_active
      AND (om.role = 'admin' OR op.base_role = 'admin')
  ) OR NOT public.is_org_admin(v_actor, v_proof.organization_id) THEN
    RAISE EXCEPTION 'active organization administrator required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_flow
  FROM public.automation_flows
  WHERE id = v_proof.flow_id
    AND organization_id = v_proof.organization_id
  FOR UPDATE;

  IF NOT FOUND
    OR v_flow.trigger_type <> 'configured_workflow'
    OR v_flow.status NOT IN ('draft', 'paused')
    OR v_flow.version <> v_proof.flow_version
    OR v_flow.updated_at <> v_proof.flow_updated_at
    OR v_flow.graph IS DISTINCT FROM v_proof.flow_graph
    OR v_flow.trigger_config IS DISTINCT FROM v_proof.flow_trigger_config
    OR v_flow.entry_node_id IS DISTINCT FROM v_proof.flow_entry_node_id THEN
    RAISE EXCEPTION 'configured workflow changed after preview' USING ERRCODE = '40001';
  END IF;

  PERFORM set_config(
    'request.configured_workflow_activation_preview', p_preview_id::text, true
  );
  PERFORM set_config(
    'request.configured_workflow_activation_digest', p_snapshot_digest, true
  );

  UPDATE public.automation_flows
  SET status = 'active', version = version + 1
  WHERE id = v_flow.id
    AND organization_id = v_flow.organization_id
    AND status = v_flow.status
    AND version = v_flow.version
    AND updated_at = v_flow.updated_at
  RETURNING * INTO v_flow;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'configured workflow activation conflicted with another update'
      USING ERRCODE = '40001';
  END IF;

  RETURN NEXT v_flow;
END;
$$;

REVOKE ALL ON FUNCTION public.activate_configured_workflow_from_preview(uuid, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.activate_configured_workflow_from_preview(uuid, text)
  TO authenticated;

NOTIFY pgrst, 'reload schema';
