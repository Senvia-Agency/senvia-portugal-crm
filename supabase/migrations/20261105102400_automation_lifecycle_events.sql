BEGIN;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS last_activity_at timestamptz;
ALTER TABLE public.leads ALTER COLUMN last_activity_at SET DEFAULT now();
ALTER TABLE public.proposals ADD COLUMN IF NOT EXISTS sent_at timestamptz;
ALTER TABLE public.proposals ADD COLUMN IF NOT EXISTS valid_until date;
CREATE INDEX IF NOT EXISTS automation_lead_activity_idx ON public.leads(organization_id,last_activity_at) WHERE automation_enabled IS DISTINCT FROM false;
CREATE INDEX IF NOT EXISTS automation_proposal_validity_idx ON public.proposals(organization_id,valid_until) WHERE valid_until IS NOT NULL;

CREATE OR REPLACE FUNCTION public.capture_automation_lifecycle_fact() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE lead uuid; org uuid; activity timestamptz;
BEGIN
  IF TG_TABLE_NAME='proposals' THEN
    IF NEW.status='sent' AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN NEW.sent_at:=now();
    ELSIF TG_OP='UPDATE' THEN NEW.sent_at:=OLD.sent_at;
    ELSE NEW.sent_at:=NULL; END IF;
    RETURN NEW;
  ELSIF TG_TABLE_NAME='leads' THEN
    IF TG_OP='INSERT' THEN NEW.last_activity_at:=coalesce(NEW.created_at,now());
    ELSIF auth.uid() IS NOT NULL AND
      (to_jsonb(NEW)-ARRAY['updated_at','last_activity_at','automation_enabled']) IS DISTINCT FROM
      (to_jsonb(OLD)-ARRAY['updated_at','last_activity_at','automation_enabled']) THEN NEW.last_activity_at:=now(); END IF;
    RETURN NEW;
  ELSIF TG_TABLE_NAME='meta_messages' THEN
    SELECT c.lead_id,c.organization_id INTO lead,org FROM public.meta_conversations c
      WHERE c.id=NEW.conversation_id AND c.organization_id=NEW.organization_id;
    activity:=least(coalesce(NEW.sent_at,NEW.created_at,now()),now());
  ELSE
    IF NEW.done_at IS NULL OR (TG_OP='UPDATE' AND OLD.done_at IS NOT NULL) THEN RETURN NEW; END IF;
    lead:=NEW.lead_id; org:=NEW.organization_id; activity:=least(NEW.done_at,now());
  END IF;
  IF lead IS NOT NULL THEN UPDATE public.leads SET last_activity_at=greatest(last_activity_at,activity)
    WHERE id=lead AND organization_id=org; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.capture_automation_lifecycle_fact() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER capture_automation_lead_activity BEFORE INSERT OR UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION public.capture_automation_lifecycle_fact();
CREATE TRIGGER capture_automation_proposal_sent BEFORE INSERT OR UPDATE ON public.proposals FOR EACH ROW EXECUTE FUNCTION public.capture_automation_lifecycle_fact();
CREATE TRIGGER capture_automation_message_activity AFTER INSERT ON public.meta_messages FOR EACH ROW EXECUTE FUNCTION public.capture_automation_lifecycle_fact();
CREATE TRIGGER capture_automation_task_activity AFTER INSERT OR UPDATE ON public.inbox_tasks FOR EACH ROW EXECUTE FUNCTION public.capture_automation_lifecycle_fact();

CREATE OR REPLACE FUNCTION public.dispatch_automation_lifecycle_events() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE f record; item record; payload jsonb; contact jsonb; occurrence text; secret text;
  days integer; sent integer:=0; subject text; local_today date:=(now() AT TIME ZONE 'Europe/Lisbon')::date;
BEGIN
  secret:=public.automation_internal_secret();
  IF nullif(secret,'') IS NULL THEN RETURN 0; END IF;
  FOR f IN SELECT id,organization_id,trigger_type,trigger_config FROM public.automation_flows
    WHERE status='active' AND trigger_type IN ('lead_inactive','proposal_unanswered','proposal_expiring','sale_fidelization_ending')
  LOOP
    IF coalesce(f.trigger_config->>'days','') !~ '^[0-9]{1,4}$' THEN CONTINUE; END IF;
    days:=(f.trigger_config->>'days')::integer;
    IF days<1 OR days>3660 THEN CONTINUE; END IF;
    FOR item IN WITH candidates AS (
      SELECT 'lead' AS entity,to_jsonb(l) AS data FROM public.leads l
        WHERE f.trigger_type='lead_inactive' AND l.organization_id=f.organization_id AND l.automation_enabled IS DISTINCT FROM false
        AND l.last_activity_at IS NOT NULL AND l.last_activity_at<=now()-make_interval(days=>days)
        AND coalesce(l.status,'') NOT IN ('won','lost') AND l.archived_at IS NULL
        AND NOT EXISTS(SELECT 1 FROM public.pipeline_stages stage WHERE stage.organization_id=f.organization_id
          AND stage.key=l.status AND (stage.is_final_positive OR stage.is_final_negative))
      UNION ALL
      SELECT 'proposal',to_jsonb(p) FROM public.proposals p
        WHERE p.organization_id=f.organization_id AND p.status IN ('sent','negotiating') AND (
          (f.trigger_type='proposal_unanswered' AND p.status='sent' AND p.sent_at IS NOT NULL AND p.sent_at<=now()-make_interval(days=>days)) OR
          (f.trigger_type='proposal_expiring' AND p.valid_until BETWEEN local_today AND local_today+days))
      UNION ALL
      SELECT 'sale',to_jsonb(s) FROM public.sales s
        WHERE f.trigger_type='sale_fidelization_ending' AND s.organization_id=f.organization_id AND s.status IS DISTINCT FROM 'cancelled'
        AND s.fidelizacao_end BETWEEN local_today AND local_today+days
    ) SELECT * FROM candidates ORDER BY data->>'id'
      LIMIT 100 OFFSET ((floor(extract(epoch FROM now())/900)::bigint % greatest(ceil((SELECT count(*) FROM candidates)/100.0)::bigint,1))*100)::integer
    LOOP
      payload:=item.data; subject:=item.entity; contact:=NULL;
      IF subject='lead' THEN
        occurrence:=(payload->>'id')||':'||(payload->>'last_activity_at')||':'||days::text;
      ELSE
        IF payload->>'client_id' IS NOT NULL THEN SELECT to_jsonb(c) INTO contact FROM public.crm_clients c WHERE c.id=(payload->>'client_id')::uuid AND c.organization_id=f.organization_id;
        ELSIF payload->>'lead_id' IS NOT NULL THEN SELECT to_jsonb(l) INTO contact FROM public.leads l WHERE l.id=(payload->>'lead_id')::uuid AND l.organization_id=f.organization_id AND l.automation_enabled IS DISTINCT FROM false; END IF;
        payload:=coalesce(contact,'{}'::jsonb)||payload;
        occurrence:=(payload->>'id')||':'||coalesce(payload->>'valid_until',payload->>'sent_at',payload->>'fidelizacao_end','')||':'||days::text;
      END IF;
      IF EXISTS(SELECT 1 FROM public.automation_runs r WHERE r.flow_id=f.id AND r.enrollment_key=occurrence) THEN CONTINUE; END IF;
      PERFORM net.http_post(url:='https://chhmfwlimtbsyjmgtokn.supabase.co/functions/v1/automation-engine',
        headers:=jsonb_build_object('Content-Type','application/json','x-automation-secret',secret),
        body:=jsonb_build_object('action','enroll','flow_id',f.id,'trigger_type',f.trigger_type,'organization_id',f.organization_id,
          'subject_type',subject,'record',payload,'occurrence_key',occurrence));
      sent:=sent+1;
    END LOOP;
  END LOOP;
  RETURN sent;
END;
$$;
REVOKE ALL ON FUNCTION public.dispatch_automation_lifecycle_events() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_automation_lifecycle_events() TO service_role;
DO $$ BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN PERFORM cron.schedule('automation-lifecycle-events','*/15 * * * *','SELECT public.dispatch_automation_lifecycle_events();'); END IF;
END; $$;
COMMIT;
