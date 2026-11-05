BEGIN;
ALTER TABLE public.inbox_tasks ADD COLUMN IF NOT EXISTS automation_origin_run_id uuid;

CREATE OR REPLACE FUNCTION public.dispatch_automation_record_event(
  p_trigger_type text,p_organization_id uuid,p_subject_type text,p_record jsonb,p_old_record jsonb DEFAULT NULL,
  p_occurrence_key text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE f record; secret text; changed text; k text;
BEGIN
  IF current_setting('app.skip_lead_side_effects',true)='on' THEN RETURN; END IF;
  secret:=public.automation_internal_secret();
  IF nullif(secret,'') IS NULL THEN RETURN; END IF;
  FOR f IN SELECT id,trigger_config FROM public.automation_flows
    WHERE organization_id=p_organization_id AND trigger_type=p_trigger_type AND status='active'
  LOOP
    IF p_trigger_type='lead_updated' THEN
      changed:=f.trigger_config->>'changed_field';
      IF nullif(changed,'') IS NULL OR NOT(f.trigger_config ? 'to_value') THEN CONTINUE; END IF;
      IF changed IN ('id','organization_id','updated_at','created_at','automation_enabled') THEN CONTINUE; END IF;
      IF (p_record->changed) IS NOT DISTINCT FROM (p_old_record->changed) THEN CONTINUE; END IF;
      IF (p_record->>changed) IS DISTINCT FROM (f.trigger_config->>'to_value') THEN CONTINUE; END IF;
      IF f.trigger_config ? 'from_value' AND (p_old_record->>changed) IS DISTINCT FROM (f.trigger_config->>'from_value') THEN CONTINUE; END IF;
    END IF;
    PERFORM net.http_post(
      url:='https://chhmfwlimtbsyjmgtokn.supabase.co/functions/v1/automation-engine',
      headers:=jsonb_build_object('Content-Type','application/json','x-automation-secret',secret),
      body:=jsonb_build_object('action','enroll','flow_id',f.id,'trigger_type',p_trigger_type,
        'organization_id',p_organization_id,'subject_type',p_subject_type,'record',p_record,
        'old_record',p_old_record,'changed_field',changed,'occurrence_key',p_occurrence_key)
    );
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.dispatch_automation_record_event(text,uuid,text,jsonb,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_automation_record_event(text,uuid,text,jsonb,jsonb,text) TO service_role;

CREATE OR REPLACE FUNCTION public.capture_automation_crm_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE event_name text; subject text; subject_id uuid; payload jsonb; previous jsonb; contact jsonb;
BEGIN
  IF current_setting('app.skip_lead_side_effects',true)='on' THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME='leads' THEN
    IF NEW.automation_enabled=false THEN RETURN NEW; END IF;
    IF (to_jsonb(NEW)-'updated_at') IS NOT DISTINCT FROM (to_jsonb(OLD)-'updated_at') THEN RETURN NEW; END IF;
    PERFORM public.dispatch_automation_record_event('lead_updated',NEW.organization_id,'lead',to_jsonb(NEW),to_jsonb(OLD));
    RETURN NEW;
  END IF;
  payload:=to_jsonb(NEW);
  IF TG_OP='UPDATE' THEN previous:=to_jsonb(OLD); END IF;
  IF TG_TABLE_NAME='inbox_tasks' THEN
    IF TG_OP='INSERT' AND NEW.automation_origin_run_id IS NOT NULL THEN RETURN NEW; END IF;
    IF TG_OP='INSERT' THEN event_name:='task_created';
    ELSIF OLD.done_at IS NULL AND NEW.done_at IS NOT NULL THEN event_name:='task_completed';
    ELSE RETURN NEW; END IF;
    payload:=payload || jsonb_build_object('task_id',NEW.id,'task_title',NEW.title,'task_due_at',NEW.due_at,'task_done_at',NEW.done_at);
  ELSE
    IF TG_OP='INSERT' THEN event_name:='meeting_created';
    ELSIF OLD.status IS DISTINCT FROM NEW.status THEN event_name:='meeting_status_changed';
    ELSE RETURN NEW; END IF;
    payload:=payload || jsonb_build_object('event_id',NEW.id,'event_title',NEW.title,'event_start_time',NEW.start_time,'event_status',NEW.status);
  END IF;
  subject_id:=nullif(payload->>'lead_id','')::uuid;
  IF subject_id IS NOT NULL THEN
    subject:='lead';
    SELECT to_jsonb(l) INTO contact FROM public.leads l WHERE l.id=subject_id AND l.organization_id=NEW.organization_id AND l.automation_enabled IS DISTINCT FROM false;
  ELSE
    subject_id:=nullif(payload->>'client_id','')::uuid;
    IF subject_id IS NOT NULL THEN
      subject:='client';
      SELECT to_jsonb(c) INTO contact FROM public.crm_clients c WHERE c.id=subject_id AND c.organization_id=NEW.organization_id;
    END IF;
  END IF;
  IF contact IS NULL THEN RETURN NEW; END IF;
  payload:=payload || contact || jsonb_build_object('source_record_id',NEW.id);
  PERFORM public.dispatch_automation_record_event(event_name,NEW.organization_id,subject,payload,previous);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.capture_automation_crm_event() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER capture_automation_lead_updated AFTER UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION public.capture_automation_crm_event();
CREATE TRIGGER capture_automation_task_event AFTER INSERT OR UPDATE ON public.inbox_tasks FOR EACH ROW EXECUTE FUNCTION public.capture_automation_crm_event();
CREATE TRIGGER capture_automation_meeting_event AFTER INSERT OR UPDATE ON public.calendar_events FOR EACH ROW EXECUTE FUNCTION public.capture_automation_crm_event();

DO $$
DECLARE definition text;
BEGIN
  SELECT pg_get_functiondef('public.notify_automation_trigger()'::regprocedure) INTO definition;
  definition:=replace(definition,'BEGIN',E'BEGIN\n  IF TG_TABLE_NAME = ''leads'' AND (to_jsonb(NEW)->>''automation_enabled'')::boolean = false THEN RETURN NEW; END IF;');
  definition:=replace(definition,'ELSE ''contact''','WHEN ''proposals'' THEN ''proposal'' ELSE ''contact''');
  EXECUTE definition;
END;
$$;
COMMIT;
