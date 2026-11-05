BEGIN;
ALTER TABLE public.automation_runs ADD COLUMN IF NOT EXISTS enrollment_key text;
CREATE UNIQUE INDEX IF NOT EXISTS automation_runs_occurrence_unique
  ON public.automation_runs(flow_id, enrollment_key) WHERE enrollment_key IS NOT NULL;
ALTER TABLE public.automation_runs DROP CONSTRAINT IF EXISTS automation_runs_subject_type_check;
ALTER TABLE public.automation_runs ADD CONSTRAINT automation_runs_subject_type_check
  CHECK (subject_type IN ('lead','client','sale','proposal','contact','organization'));

CREATE TABLE IF NOT EXISTS public.automation_schedule_occurrences (
  flow_id uuid NOT NULL REFERENCES public.automation_flows(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  subject_id uuid NOT NULL,
  occurrence_key text NOT NULL,
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing','completed','failed')),
  lease_until timestamptz NOT NULL DEFAULT now() + interval '5 minutes',
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  PRIMARY KEY(flow_id,subject_id,occurrence_key)
);
ALTER TABLE public.automation_schedule_occurrences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.automation_schedule_occurrences FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.automation_schedule_occurrences TO service_role;

CREATE OR REPLACE FUNCTION public.claim_automation_schedule_occurrence(
  p_flow_id uuid, p_organization_id uuid, p_subject_id uuid, p_occurrence_key text
) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE claimed boolean;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.automation_flows WHERE id=p_flow_id AND organization_id=p_organization_id AND status='active') THEN
    RETURN false;
  END IF;
  INSERT INTO public.automation_schedule_occurrences(flow_id,organization_id,subject_id,occurrence_key)
    VALUES(p_flow_id,p_organization_id,p_subject_id,p_occurrence_key)
    ON CONFLICT(flow_id,subject_id,occurrence_key) DO UPDATE SET
      status='processing',lease_until=now()+interval '5 minutes',updated_at=now(),last_error=NULL
    WHERE automation_schedule_occurrences.status='failed'
      OR (automation_schedule_occurrences.status='processing' AND automation_schedule_occurrences.lease_until<now())
    RETURNING true INTO claimed;
  RETURN coalesce(claimed,false);
END;
$$;
REVOKE ALL ON FUNCTION public.claim_automation_schedule_occurrence(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_automation_schedule_occurrence(uuid,uuid,uuid,text) TO service_role;

DO $$
DECLARE tick_url text;
BEGIN
  IF to_regclass('cron.job') IS NULL THEN RETURN; END IF;
  SELECT substring(command FROM '(https://[a-zA-Z0-9.-]+/functions/v1/automation-engine)')
    INTO tick_url FROM cron.job WHERE jobname='automation-engine-tick' LIMIT 1;
  IF tick_url IS NULL THEN RETURN; END IF;
  PERFORM cron.schedule('automation-schedule-tick','* * * * *',format(
    'SELECT net.http_post(url := %L, headers := jsonb_build_object(''Content-Type'', ''application/json'', ''x-automation-secret'', public.automation_internal_secret()), body := ''{}''::jsonb);',
    replace(tick_url,'/automation-engine','/automation-schedule')
  ));
END;
$$;
COMMIT;
