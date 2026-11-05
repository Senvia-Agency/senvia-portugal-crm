BEGIN;
CREATE OR REPLACE FUNCTION public.dispatch_due_automation_events() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE f record; r record; payload jsonb; contact jsonb; subject text; subject_id uuid;
  occurrence text; secret text; hours_before integer; candidate_count bigint; page_offset integer;
BEGIN
  secret:=public.automation_internal_secret();
  IF nullif(secret,'') IS NULL THEN RETURN; END IF;
  FOR f IN SELECT id,organization_id,trigger_type,trigger_config FROM public.automation_flows
    WHERE status='active' AND trigger_type IN ('task_overdue','meeting_upcoming')
  LOOP
    IF f.trigger_type='meeting_upcoming' THEN
      IF coalesce(f.trigger_config->>'hours_before','24') !~ '^[0-9]{1,4}$' THEN CONTINUE; END IF;
      hours_before:=least(8760,(coalesce(f.trigger_config->>'hours_before','24'))::integer);
      SELECT count(*) INTO candidate_count FROM public.calendar_events e
        WHERE e.organization_id=f.organization_id AND e.status NOT IN ('cancelled','completed')
        AND e.start_time>now() AND e.start_time<=now()+make_interval(hours=>hours_before)
        AND NOT EXISTS(SELECT 1 FROM public.automation_runs a WHERE a.flow_id=f.id
          AND a.enrollment_key=e.id::text||':'||e.start_time::text||':'||hours_before::text);
      page_offset:=((floor(extract(epoch FROM now())/60)::bigint % greatest(ceil(candidate_count/100.0)::bigint,1))*100)::integer;
      FOR r IN SELECT to_jsonb(e) AS data FROM public.calendar_events e
        WHERE e.organization_id=f.organization_id AND e.status NOT IN ('cancelled','completed')
        AND e.start_time>now() AND e.start_time<=now()+make_interval(hours=>hours_before)
        AND NOT EXISTS(SELECT 1 FROM public.automation_runs a WHERE a.flow_id=f.id
          AND a.enrollment_key=e.id::text||':'||e.start_time::text||':'||hours_before::text)
        ORDER BY e.start_time,e.id LIMIT 100 OFFSET page_offset
      LOOP
        payload:=r.data || jsonb_build_object('event_id',r.data->>'id','event_title',r.data->>'title',
          'event_start_time',r.data->>'start_time','event_status',r.data->>'status');
        occurrence:=(r.data->>'id')||':'||(r.data->>'start_time')::timestamptz::text||':'||hours_before::text;
        subject_id:=nullif(r.data->>'lead_id','')::uuid; contact:=NULL;
        IF subject_id IS NOT NULL THEN
          subject:='lead';
          SELECT to_jsonb(l) INTO contact FROM public.leads l WHERE l.id=subject_id AND l.organization_id=f.organization_id AND l.automation_enabled IS DISTINCT FROM false;
        ELSE
          subject_id:=nullif(r.data->>'client_id','')::uuid; subject:='client';
          SELECT to_jsonb(c) INTO contact FROM public.crm_clients c WHERE c.id=subject_id AND c.organization_id=f.organization_id;
        END IF;
        IF contact IS NULL THEN CONTINUE; END IF;
        payload:=payload || contact || jsonb_build_object('source_record_id',r.data->>'id');
        PERFORM net.http_post(url:='https://chhmfwlimtbsyjmgtokn.supabase.co/functions/v1/automation-engine',
          headers:=jsonb_build_object('Content-Type','application/json','x-automation-secret',secret),
          body:=jsonb_build_object('action','enroll','flow_id',f.id,'trigger_type',f.trigger_type,'organization_id',f.organization_id,
            'subject_type',subject,'record',payload,'occurrence_key',occurrence));
      END LOOP;
    ELSE
      SELECT count(*) INTO candidate_count FROM public.inbox_tasks t
        WHERE t.organization_id=f.organization_id AND t.done_at IS NULL AND t.due_at<now()
        AND NOT EXISTS(SELECT 1 FROM public.automation_runs a WHERE a.flow_id=f.id
          AND a.enrollment_key=t.id::text||':'||t.due_at::text);
      page_offset:=((floor(extract(epoch FROM now())/60)::bigint % greatest(ceil(candidate_count/100.0)::bigint,1))*100)::integer;
      FOR r IN SELECT to_jsonb(t) AS data FROM public.inbox_tasks t
        WHERE t.organization_id=f.organization_id AND t.done_at IS NULL AND t.due_at<now()
        AND NOT EXISTS(SELECT 1 FROM public.automation_runs a WHERE a.flow_id=f.id
          AND a.enrollment_key=t.id::text||':'||t.due_at::text)
        ORDER BY t.due_at,t.id LIMIT 100 OFFSET page_offset
      LOOP
        payload:=r.data || jsonb_build_object('task_id',r.data->>'id','task_title',r.data->>'title','task_due_at',r.data->>'due_at');
        occurrence:=(r.data->>'id')||':'||(r.data->>'due_at')::timestamptz::text;
        subject_id:=nullif(r.data->>'lead_id','')::uuid; contact:=NULL;
        IF subject_id IS NOT NULL THEN
          subject:='lead';
          SELECT to_jsonb(l) INTO contact FROM public.leads l WHERE l.id=subject_id AND l.organization_id=f.organization_id AND l.automation_enabled IS DISTINCT FROM false;
        ELSE
          subject_id:=nullif(r.data->>'client_id','')::uuid; subject:='client';
          SELECT to_jsonb(c) INTO contact FROM public.crm_clients c WHERE c.id=subject_id AND c.organization_id=f.organization_id;
        END IF;
        IF contact IS NULL THEN CONTINUE; END IF;
        payload:=payload || contact || jsonb_build_object('source_record_id',r.data->>'id');
        PERFORM net.http_post(url:='https://chhmfwlimtbsyjmgtokn.supabase.co/functions/v1/automation-engine',
          headers:=jsonb_build_object('Content-Type','application/json','x-automation-secret',secret),
          body:=jsonb_build_object('action','enroll','flow_id',f.id,'trigger_type',f.trigger_type,'organization_id',f.organization_id,
            'subject_type',subject,'record',payload,'occurrence_key',occurrence));
      END LOOP;
    END IF;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.dispatch_due_automation_events() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_due_automation_events() TO service_role;
DO $$ BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    PERFORM cron.schedule('automation-time-events','* * * * *','SELECT public.dispatch_due_automation_events();');
  END IF;
END; $$;
COMMIT;
