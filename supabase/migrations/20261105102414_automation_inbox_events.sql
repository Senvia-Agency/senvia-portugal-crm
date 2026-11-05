BEGIN;
ALTER TABLE public.email_sends ADD COLUMN IF NOT EXISTS replied_at timestamptz;
ALTER TABLE public.email_sends ADD COLUMN IF NOT EXISTS reply_message_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS email_messages_id_org_unique ON public.email_messages(id,organization_id);
ALTER TABLE public.email_sends ADD CONSTRAINT email_sends_reply_org_fk FOREIGN KEY(reply_message_id,organization_id) REFERENCES public.email_messages(id,organization_id) ON DELETE SET NULL (reply_message_id);
CREATE OR REPLACE FUNCTION public.automation_message_id(p_value text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT nullif(btrim(btrim(p_value),'<>'),'');
$$;
REVOKE ALL ON FUNCTION public.automation_message_id(text) FROM PUBLIC,anon,authenticated;
CREATE INDEX IF NOT EXISTS email_sends_rfc_message_idx ON public.email_sends(organization_id,public.automation_message_id(brevo_message_id)) WHERE brevo_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS automation_latest_incoming_idx ON public.meta_messages(conversation_id,sent_at DESC,id) WHERE direction='incoming';
CREATE INDEX IF NOT EXISTS automation_latest_team_reply_idx ON public.meta_messages(conversation_id,sent_at DESC) WHERE direction='outgoing' AND sent_by IS NOT NULL;

CREATE OR REPLACE FUNCTION public.dispatch_automation_inbox_event(p_type text,p_org uuid,p_channel uuid,p_subject uuid,p_record jsonb,p_key text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE f record; secret text;
BEGIN
 secret:=public.automation_internal_secret();
 IF nullif(secret,'') IS NULL THEN RETURN; END IF;
 FOR f IN SELECT id FROM public.automation_flows WHERE organization_id=p_org AND status='active' AND trigger_type=p_type
  AND (nullif(trigger_config->>'channel_id','') IS NULL OR trigger_config->>'channel_id'=p_channel::text)
 LOOP
  PERFORM net.http_post(url:='https://chhmfwlimtbsyjmgtokn.supabase.co/functions/v1/automation-engine',
   headers:=jsonb_build_object('Content-Type','application/json','x-automation-secret',secret),
   body:=jsonb_build_object('action','enroll','flow_id',f.id,'trigger_type',p_type,'organization_id',p_org,
    'subject_type','contact','record',p_record||jsonb_build_object('id',p_subject),'occurrence_key',p_key));
 END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.dispatch_automation_inbox_event(text,uuid,uuid,uuid,jsonb,text) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.capture_automation_meta_message() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE conv public.meta_conversations%ROWTYPE; kind text; provider text;
BEGIN
 IF NEW.direction<>'incoming' OR NEW.sent_at IS NULL OR NEW.sent_at<now()-interval '10 minutes' OR NEW.sent_at>now()+interval '5 minutes' THEN RETURN NEW; END IF;
 SELECT * INTO conv FROM public.meta_conversations WHERE id=NEW.conversation_id AND organization_id=NEW.organization_id;
 IF NOT FOUND THEN RETURN NEW; END IF;
 SELECT channel_type,c.provider INTO kind,provider FROM public.messaging_channels c WHERE id=conv.channel_id AND organization_id=NEW.organization_id AND archived_at IS NULL;
 IF NOT FOUND OR provider='evolution' THEN RETURN NEW; END IF;
 PERFORM public.dispatch_automation_inbox_event('meta_message_received',NEW.organization_id,conv.channel_id,conv.id,
  jsonb_build_object('conversa_id',conv.id,'channel_id',conv.channel_id,'name',conv.contact_name,
   'phone',CASE WHEN kind='whatsapp' THEN conv.contact_ref ELSE NULL END,'mensagem_inicial',NEW.content,
   'message_id',NEW.id,'message_sent_at',NEW.sent_at,'channel_type',kind),NEW.id::text);
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.capture_automation_meta_message() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER capture_automation_meta_message AFTER INSERT ON public.meta_messages FOR EACH ROW EXECUTE FUNCTION public.capture_automation_meta_message();

CREATE OR REPLACE FUNCTION public.guard_automation_email_reply() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.replied_at IS NOT DISTINCT FROM OLD.replied_at AND NEW.reply_message_id IS NOT DISTINCT FROM OLD.reply_message_id THEN RETURN NEW; END IF;
 IF (NEW.replied_at IS NOT NULL OR NEW.reply_message_id IS NOT NULL) AND current_user NOT IN ('postgres','service_role','supabase_admin') THEN
  RAISE EXCEPTION 'Email reply correlation is service-only' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_automation_email_reply() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER guard_automation_email_reply BEFORE INSERT OR UPDATE ON public.email_sends FOR EACH ROW EXECUTE FUNCTION public.guard_automation_email_reply();

CREATE OR REPLACE FUNCTION public.capture_automation_inbound_email() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE inbox boolean; related_ids text[]; sent record;
BEGIN
 SELECT role='inbox' INTO inbox FROM public.email_folders WHERE id=NEW.folder_id AND channel_id=NEW.channel_id AND organization_id=NEW.organization_id;
 IF inbox IS DISTINCT FROM true OR NEW.draft OR NEW.date IS NULL THEN RETURN NEW; END IF;
 IF public.automation_message_id(NEW.in_reply_to) IS NOT NULL THEN
  related_ids:=ARRAY[public.automation_message_id(NEW.in_reply_to)];
 ELSE
  related_ids:=ARRAY[public.automation_message_id(NEW.email_references[cardinality(NEW.email_references)])];
 END IF;
 FOR sent IN SELECT s.id,s.automation_run_id,s.automation_node_id FROM public.email_sends s
  WHERE s.organization_id=NEW.organization_id AND s.automation_run_id IS NOT NULL
   AND s.sent_at IS NOT NULL AND NEW.date>=s.sent_at
   AND lower(trim(s.recipient_email))=lower(trim(NEW.from_address))
   AND public.automation_message_id(s.brevo_message_id)=ANY(related_ids)
 LOOP
  UPDATE public.email_sends SET replied_at=coalesce(replied_at,NEW.date),reply_message_id=coalesce(reply_message_id,NEW.id)
   WHERE id=sent.id AND organization_id=NEW.organization_id;
  UPDATE public.automation_runs SET context=coalesce(context,'{}'::jsonb)||jsonb_build_object('email_replied',true,'ultima_resposta_email',coalesce(NEW.text_body,NEW.snippet,''),
   'email_reply_message_id',NEW.id,'email_events',coalesce(context->'email_events','{}'::jsonb)||jsonb_build_object(sent.automation_node_id,
    coalesce(context#>ARRAY['email_events',sent.automation_node_id],'{}'::jsonb)||jsonb_build_object('email_replied',true,'reply_message_id',NEW.id)))
   WHERE id=sent.automation_run_id AND organization_id=NEW.organization_id;
 END LOOP;
 IF NEW.date>=now()-interval '10 minutes' AND NEW.date<=now()+interval '5 minutes' THEN
  PERFORM public.dispatch_automation_inbox_event('email_received',NEW.organization_id,NEW.channel_id,NEW.id,
   jsonb_build_object('email_message_id',NEW.id,'channel_id',NEW.channel_id,'name',NEW.from_name,'email',NEW.from_address,
    'email_subject',NEW.subject,'mensagem_inicial',coalesce(NEW.text_body,NEW.snippet,''),'message_sent_at',NEW.date),
   coalesce(public.automation_message_id(NEW.message_id),NEW.id::text));
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.capture_automation_inbound_email() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER capture_automation_inbound_email AFTER INSERT ON public.email_messages FOR EACH ROW EXECUTE FUNCTION public.capture_automation_inbound_email();

CREATE OR REPLACE FUNCTION public.dispatch_unanswered_automation_conversations() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE f record; c record; minutes integer; total bigint; page_offset integer; secret text;
BEGIN
 secret:=public.automation_internal_secret();
 IF nullif(secret,'') IS NULL THEN RETURN; END IF;
 FOR f IN SELECT id,organization_id,trigger_config,created_at FROM public.automation_flows WHERE status='active' AND trigger_type='conversation_unanswered'
 LOOP
  IF coalesce(f.trigger_config->>'minutes','15') !~ '^[0-9]{1,5}$' THEN CONTINUE; END IF;
  minutes:=greatest(1,least(10080,(coalesce(f.trigger_config->>'minutes','15'))::integer));
  SELECT count(*) INTO total FROM public.meta_conversations conv
   JOIN LATERAL(SELECT id,sent_at FROM public.meta_messages WHERE conversation_id=conv.id AND organization_id=f.organization_id AND direction='incoming' ORDER BY sent_at DESC,id DESC LIMIT 1) incoming ON true
   WHERE conv.organization_id=f.organization_id AND conv.status='open'
    AND incoming.sent_at<=now()-make_interval(mins=>minutes) AND incoming.sent_at>=f.created_at
    AND (nullif(f.trigger_config->>'channel_id','') IS NULL OR f.trigger_config->>'channel_id'=conv.channel_id::text)
    AND NOT EXISTS(SELECT 1 FROM public.meta_messages outgoing WHERE outgoing.conversation_id=conv.id AND outgoing.organization_id=f.organization_id AND outgoing.direction='outgoing' AND outgoing.sent_by IS NOT NULL AND outgoing.sent_at>=incoming.sent_at)
    AND NOT EXISTS(SELECT 1 FROM public.automation_runs r WHERE r.flow_id=f.id AND r.enrollment_key=conv.id::text||':'||incoming.id::text||':'||minutes::text);
  page_offset:=((floor(extract(epoch FROM now())/60)::bigint % greatest(ceil(total/100.0)::bigint,1))*100)::integer;
  FOR c IN SELECT conv.*,incoming.id AS incoming_id,incoming.sent_at AS incoming_at,incoming.content AS incoming_content,ch.channel_type
   FROM public.meta_conversations conv JOIN public.messaging_channels ch ON ch.id=conv.channel_id AND ch.organization_id=f.organization_id AND ch.archived_at IS NULL
   JOIN LATERAL(SELECT id,sent_at,content FROM public.meta_messages WHERE conversation_id=conv.id AND organization_id=f.organization_id AND direction='incoming' ORDER BY sent_at DESC,id DESC LIMIT 1) incoming ON true
   WHERE conv.organization_id=f.organization_id AND conv.status='open'
    AND incoming.sent_at<=now()-make_interval(mins=>minutes) AND incoming.sent_at>=f.created_at
    AND (nullif(f.trigger_config->>'channel_id','') IS NULL OR f.trigger_config->>'channel_id'=conv.channel_id::text)
    AND NOT EXISTS(SELECT 1 FROM public.meta_messages outgoing WHERE outgoing.conversation_id=conv.id AND outgoing.organization_id=f.organization_id AND outgoing.direction='outgoing' AND outgoing.sent_by IS NOT NULL AND outgoing.sent_at>=incoming.sent_at)
    AND NOT EXISTS(SELECT 1 FROM public.automation_runs r WHERE r.flow_id=f.id AND r.enrollment_key=conv.id::text||':'||incoming.id::text||':'||minutes::text)
   ORDER BY incoming.sent_at,conv.id LIMIT 100 OFFSET page_offset
  LOOP
   PERFORM net.http_post(url:='https://chhmfwlimtbsyjmgtokn.supabase.co/functions/v1/automation-engine',headers:=jsonb_build_object('Content-Type','application/json','x-automation-secret',secret),
    body:=jsonb_build_object('action','enroll','flow_id',f.id,'trigger_type','conversation_unanswered','organization_id',f.organization_id,'subject_type','contact',
     'record',jsonb_build_object('id',c.id,'conversa_id',c.id,'channel_id',c.channel_id,'name',c.contact_name,'assigned_to',c.assigned_to,
      'phone',CASE WHEN c.channel_type='whatsapp' THEN c.contact_ref ELSE NULL END,'mensagem_inicial',c.incoming_content,'last_incoming_at',c.incoming_at,'unanswered_minutes',minutes),
     'occurrence_key',c.id::text||':'||c.incoming_id::text||':'||minutes::text));
  END LOOP;
 END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.dispatch_unanswered_automation_conversations() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_unanswered_automation_conversations() TO service_role;
DO $$ BEGIN
 IF to_regclass('cron.job') IS NOT NULL THEN
  PERFORM cron.schedule('automation-conversation-unanswered','* * * * *','SELECT public.dispatch_unanswered_automation_conversations();');
 END IF;
END; $$;
COMMIT;
