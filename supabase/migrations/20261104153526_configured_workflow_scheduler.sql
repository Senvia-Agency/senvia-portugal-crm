ALTER TABLE public.automation_flows
  ADD COLUMN IF NOT EXISTS activated_at timestamptz;

CREATE OR REPLACE FUNCTION public.set_automation_flow_activated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.activated_at := CASE WHEN NEW.status = 'active' THEN now() ELSE NULL END;
  ELSIF NEW.status = 'active' AND OLD.status IS DISTINCT FROM 'active' THEN
    NEW.activated_at := now();
  ELSE
    NEW.activated_at := OLD.activated_at;
  END IF;
  RETURN NEW;
END;
$$;

UPDATE public.automation_flows
SET activated_at = updated_at
WHERE status = 'active' AND activated_at IS NULL;

DROP TRIGGER IF EXISTS trg_automation_flow_activated_at ON public.automation_flows;
CREATE TRIGGER trg_automation_flow_activated_at
  BEFORE INSERT OR UPDATE ON public.automation_flows
  FOR EACH ROW EXECUTE FUNCTION public.set_automation_flow_activated_at();

CREATE TABLE IF NOT EXISTS public.automation_workflow_occurrences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  flow_id uuid NOT NULL REFERENCES public.automation_flows(id) ON DELETE CASCADE,
  flow_version integer NOT NULL CHECK (flow_version > 0),
  local_date date NOT NULL,
  scheduled_for timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'claimed', 'completed', 'failed')),
  claim_token uuid,
  lease_until timestamptz,
  claimed_at timestamptz,
  completed_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT automation_workflow_occurrence_unique
    UNIQUE (organization_id, flow_id, flow_version, local_date)
);

CREATE INDEX IF NOT EXISTS idx_workflow_occurrences_claimable
  ON public.automation_workflow_occurrences (scheduled_for, lease_until)
  WHERE status IN ('pending', 'claimed');

ALTER TABLE public.automation_workflow_occurrences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members view org workflow occurrences"
  ON public.automation_workflow_occurrences FOR SELECT TO authenticated
  USING (
    public.is_org_member((SELECT auth.uid()), organization_id)
    OR public.has_role((SELECT auth.uid()), 'super_admin'::public.app_role)
  );

CREATE OR REPLACE FUNCTION public.automation_workflow_scheduled_at(
  p_local_date date, p_local_time time, p_time_zone text
)
RETURNS timestamptz LANGUAGE plpgsql STABLE SET search_path TO 'pg_catalog' AS $$
DECLARE
  v_local timestamp := p_local_date + p_local_time;
  v_candidate timestamptz;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = p_time_zone) THEN
    RETURN NULL;
  END IF;
  v_candidate := v_local AT TIME ZONE p_time_zone;
  -- Prefer the first instant when the wall-clock minute repeats at a DST fold.
  IF (v_candidate - interval '1 hour') AT TIME ZONE p_time_zone = v_local THEN
    RETURN v_candidate - interval '1 hour';
  END IF;
  RETURN v_candidate;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_due_automation_workflow_occurrences(
  p_now timestamptz DEFAULT now(), p_limit integer DEFAULT 25,
  p_lease_seconds integer DEFAULT 300
)
RETURNS TABLE (
  occurrence_id uuid, organization_id uuid, flow_id uuid, flow_version integer,
  local_date date, scheduled_for timestamptz, claim_token uuid, lease_until timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog' AS $$
DECLARE
  v_claim_token uuid := gen_random_uuid();
BEGIN
  IF p_limit < 1 OR p_limit > 100 OR p_lease_seconds < 30 OR p_lease_seconds > 3600 THEN
    RAISE EXCEPTION 'invalid workflow occurrence claim bounds';
  END IF;
  WITH configured AS (
    SELECT f.id AS flow_id, f.organization_id, f.version AS flow_version,
      COALESCE(f.activated_at, f.updated_at) AS activated_at,
      f.trigger_config #>> '{workflow,trigger,localTime}' AS local_time_text,
      f.trigger_config #>> '{workflow,trigger,timeZone}' AS time_zone
    FROM public.automation_flows f
    WHERE f.status = 'active' AND f.trigger_type = 'configured_workflow'
      AND f.trigger_config #>> '{workflow,trigger,kind}' = 'daily_schedule'
      AND f.trigger_config #>> '{workflow,trigger,localTime}' ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
      AND EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names tz
        WHERE tz.name = f.trigger_config #>> '{workflow,trigger,timeZone}')
  ), current_local AS (
    SELECT c.*, (p_now AT TIME ZONE c.time_zone)::date AS today,
      (c.local_time_text || ':00')::time AS local_time FROM configured c
  ), due AS (
    SELECT c.*, CASE
      WHEN public.automation_workflow_scheduled_at(c.today, c.local_time, c.time_zone) <= p_now
        THEN c.today ELSE c.today - 1 END AS occurrence_date
    FROM current_local c
  ), eligible AS (
    SELECT d.organization_id, d.flow_id, d.flow_version, d.occurrence_date,
      d.activated_at, d.time_zone,
      public.automation_workflow_scheduled_at(d.occurrence_date, d.local_time, d.time_zone) AS scheduled_at
    FROM due d
  )
  INSERT INTO public.automation_workflow_occurrences
    (organization_id, flow_id, flow_version, local_date, scheduled_for)
  SELECT e.organization_id, e.flow_id, e.flow_version, e.occurrence_date, e.scheduled_at
  FROM eligible e JOIN public.automation_flows f ON f.id = e.flow_id
  WHERE e.scheduled_at <= p_now AND f.status = 'active' AND f.version = e.flow_version
    AND (
      e.scheduled_at >= e.activated_at
      OR e.occurrence_date = (e.activated_at AT TIME ZONE e.time_zone)::date
    )
  ON CONFLICT ON CONSTRAINT automation_workflow_occurrence_unique DO NOTHING;

  RETURN QUERY
  WITH candidates AS (
    SELECT o.id FROM public.automation_workflow_occurrences o
    JOIN public.automation_flows f ON f.id = o.flow_id
      AND f.organization_id = o.organization_id AND f.version = o.flow_version
    WHERE f.status = 'active' AND f.trigger_type = 'configured_workflow'
      AND o.scheduled_for <= p_now
      AND (o.status = 'pending' OR (o.status = 'claimed' AND o.lease_until <= p_now))
    ORDER BY o.scheduled_for, o.id FOR UPDATE OF o SKIP LOCKED LIMIT p_limit
  ), claimed AS (
    UPDATE public.automation_workflow_occurrences o SET status = 'claimed',
      claim_token = v_claim_token, claimed_at = p_now,
      lease_until = p_now + make_interval(secs => p_lease_seconds),
      last_error = NULL, updated_at = p_now
    FROM candidates c WHERE o.id = c.id RETURNING o.*
  )
  SELECT c.id, c.organization_id, c.flow_id, c.flow_version, c.local_date,
    c.scheduled_for, c.claim_token, c.lease_until FROM claimed c
  ORDER BY c.scheduled_for, c.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_automation_workflow_occurrence(
  p_occurrence_id uuid, p_claim_token uuid, p_outcome text, p_error text DEFAULT NULL
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog' AS $$
DECLARE v_updated integer;
BEGIN
  IF p_outcome NOT IN ('completed', 'failed') THEN
    RAISE EXCEPTION 'invalid workflow occurrence outcome';
  END IF;
  UPDATE public.automation_workflow_occurrences SET status = p_outcome,
    completed_at = now(), lease_until = NULL,
    last_error = CASE WHEN p_outcome = 'failed' THEN left(p_error, 2000) ELSE NULL END,
    updated_at = now()
  WHERE id = p_occurrence_id AND status = 'claimed' AND claim_token = p_claim_token;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

REVOKE ALL ON TABLE public.automation_workflow_occurrences FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.automation_workflow_occurrences TO authenticated;
GRANT ALL ON TABLE public.automation_workflow_occurrences TO service_role;
REVOKE ALL ON FUNCTION public.set_automation_flow_activated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.automation_workflow_scheduled_at(date, time, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_due_automation_workflow_occurrences(timestamptz, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_automation_workflow_occurrence(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_automation_workflow_occurrences(timestamptz, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_automation_workflow_occurrence(uuid, uuid, text, text) TO service_role;
