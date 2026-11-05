CREATE TABLE IF NOT EXISTS public.automation_workflow_stage_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  flow_id uuid NOT NULL REFERENCES public.automation_flows(id) ON DELETE CASCADE,
  flow_version integer NOT NULL CHECK (flow_version > 0),
  entity_type text NOT NULL CHECK (entity_type IN ('receivables', 'clients', 'leads', 'proposals')),
  record_id text NOT NULL CHECK (length(record_id) BETWEEN 1 AND 128),
  stage_id text NOT NULL CHECK (length(stage_id) BETWEEN 1 AND 128),
  cadence_mode text NOT NULL CHECK (cadence_mode IN ('once', 'per_run', 'interval_days')),
  cadence_key text NOT NULL CHECK (length(cadence_key) BETWEEN 1 AND 256),
  occurrence_key text NOT NULL CHECK (length(occurrence_key) BETWEEN 1 AND 256),
  local_date date NOT NULL,
  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'succeeded', 'failed', 'unknown')),
  claim_token uuid NOT NULL,
  lease_until timestamptz NOT NULL,
  run_id uuid REFERENCES public.automation_runs(id) ON DELETE SET NULL,
  completed_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT automation_workflow_stage_execution_unique
    UNIQUE (organization_id, flow_id, flow_version, entity_type, record_id, stage_id, cadence_key)
);

CREATE INDEX IF NOT EXISTS idx_workflow_stage_history
  ON public.automation_workflow_stage_executions
    (organization_id, flow_id, flow_version, entity_type, record_id, stage_id, local_date DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_stage_once_across_versions
  ON public.automation_workflow_stage_executions
    (organization_id, flow_id, entity_type, record_id, stage_id)
  WHERE cadence_mode = 'once';

ALTER TABLE public.automation_workflow_stage_executions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members view org workflow stage executions"
  ON public.automation_workflow_stage_executions FOR SELECT TO authenticated
  USING (
    public.is_org_member((SELECT auth.uid()), organization_id)
    OR public.has_role((SELECT auth.uid()), 'super_admin'::public.app_role)
  );

CREATE OR REPLACE FUNCTION public.claim_automation_workflow_stage_execution(
  p_organization_id uuid, p_flow_id uuid, p_flow_version integer,
  p_entity_type text, p_record_id text, p_stage_id text,
  p_cadence_mode text, p_cadence_days integer, p_occurrence_key text,
  p_local_date date, p_lease_seconds integer DEFAULT 300
)
RETURNS TABLE (execution_id uuid, claim_token uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog' AS $$
DECLARE
  v_now timestamptz := now();
  v_token uuid := gen_random_uuid();
  v_key text;
  v_latest public.automation_workflow_stage_executions%ROWTYPE;
BEGIN
  IF p_entity_type NOT IN ('receivables', 'clients', 'leads', 'proposals')
    OR p_cadence_mode NOT IN ('once', 'per_run', 'interval_days')
    OR length(p_record_id) NOT BETWEEN 1 AND 128
    OR length(p_stage_id) NOT BETWEEN 1 AND 128
    OR length(p_occurrence_key) NOT BETWEEN 1 AND 256
    OR p_lease_seconds NOT BETWEEN 30 AND 3600
    OR (p_cadence_mode = 'interval_days' AND (p_cadence_days IS NULL OR p_cadence_days NOT BETWEEN 1 AND 3650))
  THEN RAISE EXCEPTION 'invalid workflow stage claim'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.automation_flows f
    WHERE f.id = p_flow_id AND f.organization_id = p_organization_id
      AND f.version = p_flow_version AND f.status = 'active'
      AND f.trigger_type = 'configured_workflow'
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(COALESCE(f.trigger_config #> '{workflow,stages}', '[]'::jsonb)) stage
        WHERE stage->>'id' = p_stage_id
      )
  ) THEN RETURN; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(concat_ws(':', p_organization_id, p_flow_id,
    CASE WHEN p_cadence_mode = 'once' THEN 'all_versions' ELSE p_flow_version::text END,
    p_entity_type, p_record_id, p_stage_id), 0));

  IF p_cadence_mode = 'once' THEN
    IF EXISTS (
      SELECT 1 FROM public.automation_workflow_stage_executions e
      WHERE e.organization_id = p_organization_id AND e.flow_id = p_flow_id
        AND e.entity_type = p_entity_type AND e.record_id = p_record_id
        AND e.stage_id = p_stage_id AND e.cadence_mode = 'once'
    ) THEN RETURN; END IF;
    v_key := 'once';
  ELSE
    SELECT * INTO v_latest FROM public.automation_workflow_stage_executions e
    WHERE e.organization_id = p_organization_id AND e.flow_id = p_flow_id
      AND e.flow_version = p_flow_version AND e.entity_type = p_entity_type
      AND e.record_id = p_record_id AND e.stage_id = p_stage_id
    ORDER BY e.local_date DESC, e.created_at DESC LIMIT 1 FOR UPDATE;

    IF FOUND AND v_latest.status = 'running' AND v_latest.lease_until <= v_now THEN
      UPDATE public.automation_workflow_stage_executions
      SET status = 'unknown', completed_at = v_now,
        last_error = 'claim lease expired before effect outcome was recorded', updated_at = v_now
      WHERE id = v_latest.id;
      v_latest.status := 'unknown';
    END IF;

    IF p_cadence_mode = 'per_run' THEN
      v_key := 'run:' || p_occurrence_key;
      IF FOUND AND v_latest.status <> 'succeeded' THEN RETURN; END IF;
      IF EXISTS (SELECT 1 FROM public.automation_workflow_stage_executions e
        WHERE e.organization_id = p_organization_id AND e.flow_id = p_flow_id
          AND e.flow_version = p_flow_version AND e.entity_type = p_entity_type
          AND e.record_id = p_record_id AND e.stage_id = p_stage_id
          AND e.cadence_key = v_key) THEN RETURN; END IF;
    ELSE
      IF FOUND AND (v_latest.status <> 'succeeded'
        OR p_local_date < v_latest.local_date + p_cadence_days) THEN RETURN; END IF;
      v_key := 'interval:' || p_local_date::text;
    END IF;
  END IF;

  INSERT INTO public.automation_workflow_stage_executions (
    organization_id, flow_id, flow_version, entity_type, record_id, stage_id,
    cadence_mode, cadence_key, occurrence_key, local_date, claim_token, lease_until
  ) VALUES (
    p_organization_id, p_flow_id, p_flow_version, p_entity_type, p_record_id, p_stage_id,
    p_cadence_mode, v_key, p_occurrence_key, p_local_date, v_token,
    v_now + make_interval(secs => p_lease_seconds)
  ) RETURNING id, automation_workflow_stage_executions.claim_token
    INTO execution_id, claim_token;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_automation_workflow_stage_execution(
  p_execution_id uuid, p_claim_token uuid, p_outcome text,
  p_run_id uuid DEFAULT NULL, p_error text DEFAULT NULL
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog' AS $$
DECLARE v_updated integer;
BEGIN
  IF p_outcome NOT IN ('succeeded', 'failed', 'unknown') THEN
    RAISE EXCEPTION 'invalid workflow stage outcome';
  END IF;
  UPDATE public.automation_workflow_stage_executions SET status = p_outcome,
    run_id = COALESCE(p_run_id, run_id), completed_at = now(), lease_until = now(),
    last_error = CASE WHEN p_outcome = 'succeeded' THEN NULL ELSE left(p_error, 2000) END,
    updated_at = now()
  WHERE id = p_execution_id AND claim_token = p_claim_token
    AND status IN ('running', 'unknown');
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

REVOKE ALL ON TABLE public.automation_workflow_stage_executions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.automation_workflow_stage_executions TO authenticated;
GRANT ALL ON TABLE public.automation_workflow_stage_executions TO service_role;
REVOKE ALL ON FUNCTION public.claim_automation_workflow_stage_execution(
  uuid, uuid, integer, text, text, text, text, integer, text, date, integer
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_automation_workflow_stage_execution(
  uuid, uuid, text, uuid, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_automation_workflow_stage_execution(
  uuid, uuid, integer, text, text, text, text, integer, text, date, integer
) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_automation_workflow_stage_execution(
  uuid, uuid, text, uuid, text
) TO service_role;
