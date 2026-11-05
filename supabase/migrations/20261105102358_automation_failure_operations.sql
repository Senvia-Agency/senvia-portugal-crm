BEGIN;
CREATE TABLE IF NOT EXISTS public.automation_failure_pauses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id uuid NOT NULL REFERENCES public.automation_flows(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  failed integer NOT NULL, total integer NOT NULL, rate numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.automation_failure_pauses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.automation_failure_pauses FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.automation_failure_pauses TO service_role;

CREATE INDEX IF NOT EXISTS automation_runs_failure_window_idx ON public.automation_runs(flow_id,completed_at DESC) WHERE status IN ('completed','failed');

CREATE OR REPLACE FUNCTION public.apply_automation_failure_policy(p_flow_id uuid,p_organization_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE flow public.automation_flows%ROWTYPE; policy jsonb; threshold numeric; minimum integer; minutes integer; failures integer; total integer; rate numeric;
BEGIN
  SELECT * INTO flow FROM public.automation_flows WHERE id=p_flow_id AND organization_id=p_organization_id FOR UPDATE;
  IF NOT FOUND OR flow.status<>'active' THEN RETURN jsonb_build_object('paused',false,'reason','inactive'); END IF;
  policy := flow.trigger_config->'failure_policy';
  IF policy IS NULL OR policy->>'enabled' IS DISTINCT FROM 'true' THEN RETURN jsonb_build_object('paused',false,'reason','disabled'); END IF;
  threshold := coalesce((policy->>'threshold_percent')::numeric,20);
  minimum := coalesce((policy->>'min_runs')::integer,10);
  minutes := coalesce((policy->>'window_minutes')::integer,60);
  IF threshold<1 OR threshold>100 OR minimum<2 OR minimum>10000 OR minutes<5 OR minutes>1440 THEN RAISE EXCEPTION 'invalid failure policy'; END IF;
  SELECT count(*)::integer,count(*) FILTER(WHERE status='failed')::integer INTO total,failures FROM public.automation_runs
    WHERE flow_id=flow.id AND organization_id=flow.organization_id AND status IN ('completed','failed')
      AND completed_at>=now()-make_interval(mins=>minutes) AND coalesce(context->>'__test','false')<>'true';
  rate := CASE WHEN total=0 THEN 0 ELSE failures::numeric*100/total END;
  IF total>=minimum AND rate>threshold THEN
    UPDATE public.automation_flows SET status='paused',updated_at=now() WHERE id=flow.id AND status='active';
    INSERT INTO public.automation_failure_pauses(flow_id,organization_id,failed,total,rate) VALUES(flow.id,flow.organization_id,failures,total,rate);
    RETURN jsonb_build_object('paused',true,'failed',failures,'total',total,'rate',rate);
  END IF;
  RETURN jsonb_build_object('paused',false,'failed',failures,'total',total,'rate',rate);
END;
$$;
REVOKE ALL ON FUNCTION public.apply_automation_failure_policy(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.apply_automation_failure_policy(uuid,uuid) TO service_role;

CREATE TABLE IF NOT EXISTS public.automation_failure_summary_claims (
  flow_id uuid NOT NULL REFERENCES public.automation_flows(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  summary_date date NOT NULL, failed integer NOT NULL,
  status text NOT NULL DEFAULT 'claimed' CHECK(status IN ('claimed','sent','failed')),
  claimed_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
  PRIMARY KEY(flow_id,summary_date)
);
ALTER TABLE public.automation_failure_summary_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.automation_failure_summary_claims FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.automation_failure_summary_claims TO service_role;
CREATE TABLE IF NOT EXISTS public.automation_failure_summary_recipients (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL, summary_date date NOT NULL, failed integer NOT NULL,
  flow_ids uuid[] NOT NULL, status text NOT NULL DEFAULT 'claimed' CHECK(status IN ('claimed','sent','failed')),
  attempts integer NOT NULL DEFAULT 1 CHECK(attempts BETWEEN 1 AND 5),
  claim_token uuid NOT NULL DEFAULT gen_random_uuid(), lease_until timestamptz NOT NULL DEFAULT now()+interval '10 minutes',
  claimed_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
  PRIMARY KEY(organization_id,owner_id,summary_date)
);
ALTER TABLE public.automation_failure_summary_recipients ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.automation_failure_summary_recipients FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.automation_failure_summary_recipients TO service_role;
DROP FUNCTION IF EXISTS public.claim_automation_failure_summaries();
CREATE FUNCTION public.claim_automation_failure_summaries()
RETURNS TABLE(flow_id uuid,flow_ids uuid[],organization_id uuid,owner_id uuid,failed integer,summary_date date,claim_token uuid)
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE item record; today date := (now() AT TIME ZONE 'Europe/Lisbon')::date; claimed integer; token uuid;
BEGIN
  INSERT INTO public.automation_failure_summary_claims(flow_id,organization_id,summary_date,failed)
    SELECT f.id,f.organization_id,today,count(*)::integer FROM public.automation_flows f
    JOIN public.automation_runs r ON r.flow_id=f.id AND r.organization_id=f.organization_id
    WHERE f.trigger_config->'failure_policy'->>'daily_summary'='true' AND f.created_by IS NOT NULL
      AND r.status='failed' AND coalesce(r.context->>'__test','false')<>'true'
      AND r.completed_at>=((today-1)::timestamp AT TIME ZONE 'Europe/Lisbon')
      AND r.completed_at<(today::timestamp AT TIME ZONE 'Europe/Lisbon')
    GROUP BY f.id,f.organization_id ON CONFLICT DO NOTHING;
  FOR item IN SELECT c.organization_id,f.created_by AS owner_id,array_agg(c.flow_id ORDER BY c.flow_id) AS flow_ids,sum(c.failed)::integer AS failures
    FROM public.automation_failure_summary_claims c JOIN public.automation_flows f ON f.id=c.flow_id AND f.organization_id=c.organization_id
    WHERE c.summary_date=today AND f.created_by IS NOT NULL
    GROUP BY c.organization_id,f.created_by
  LOOP
    INSERT INTO public.automation_failure_summary_recipients(organization_id,owner_id,summary_date,failed,flow_ids)
      VALUES(item.organization_id,item.owner_id,today,item.failures,item.flow_ids)
      ON CONFLICT ON CONSTRAINT automation_failure_summary_recipients_pkey DO UPDATE SET
        status='claimed',attempts=automation_failure_summary_recipients.attempts+1,
        claim_token=gen_random_uuid(),lease_until=now()+interval '10 minutes',claimed_at=now(),finished_at=NULL
      WHERE automation_failure_summary_recipients.status IN ('claimed','failed')
        AND automation_failure_summary_recipients.lease_until<=now()
        AND automation_failure_summary_recipients.attempts<5;
    GET DIAGNOSTICS claimed=ROW_COUNT;
    IF claimed=1 THEN
      SELECT recipient.claim_token INTO token FROM public.automation_failure_summary_recipients recipient
        WHERE recipient.organization_id=item.organization_id AND recipient.owner_id=item.owner_id AND recipient.summary_date=today;
      flow_id:=item.flow_ids[1];flow_ids:=item.flow_ids;organization_id:=item.organization_id;owner_id:=item.owner_id;failed:=item.failures;summary_date:=today;claim_token:=token;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_automation_failure_summaries() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_automation_failure_summaries() TO service_role;
DO $$
DECLARE tick_url text;
BEGIN
  IF to_regclass('cron.job') IS NULL THEN RETURN; END IF;
  SELECT substring(command FROM '(https://[a-zA-Z0-9.-]+/functions/v1/automation-engine)') INTO tick_url
    FROM cron.job WHERE jobname='automation-engine-tick' LIMIT 1;
  IF tick_url IS NULL THEN RETURN; END IF;
  PERFORM cron.schedule('automation-failure-summary','*/15 * * * *',format(
    'SELECT net.http_post(url := %L,headers := jsonb_build_object(''Content-Type'',''application/json'',''x-automation-secret'',public.automation_internal_secret()),body := ''{}''::jsonb);',
    replace(tick_url,'/automation-engine','/automation-failure-summary')));
END;
$$;
COMMIT;
