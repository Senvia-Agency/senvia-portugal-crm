BEGIN;
CREATE OR REPLACE FUNCTION public.record_automation_reply_fact(p_org_id uuid,p_phone text,p_text text,p_received_at timestamptz,p_conversation_id uuid DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE affected integer; phone text;
BEGIN
 IF p_received_at IS NULL OR p_received_at>now()+interval '5 minutes' OR nullif(trim(p_text),'') IS NULL THEN RETURN 0; END IF;
 phone:=public.automation_phone_key(p_phone);
 IF phone IS NULL AND p_conversation_id IS NULL THEN RETURN 0; END IF;
 IF p_conversation_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.meta_conversations WHERE id=p_conversation_id AND organization_id=p_org_id) THEN RETURN 0; END IF;
 UPDATE public.automation_runs SET context=coalesce(context,'{}'::jsonb)||jsonb_build_object(
  'ultima_resposta',p_text,'ultima_resposta_received_at',p_received_at,'respondeu',true)
 WHERE organization_id=p_org_id AND status IN ('running','waiting','awaiting_reply') AND started_at<=p_received_at
  AND CASE WHEN nullif(context->>'__action_reply_phone_key','') IS NOT NULL
   THEN context->>'__action_reply_phone_key'=phone
   ELSE ((phone IS NOT NULL AND contact_phone_key=phone) OR
    (p_conversation_id IS NOT NULL AND (context->>'conversa_id'=p_conversation_id::text OR (subject_type='contact' AND subject_id=p_conversation_id)))) END
  AND (nullif(context->>'ultima_resposta_received_at','') IS NULL OR (context->>'ultima_resposta_received_at')::timestamptz<=p_received_at);
 GET DIAGNOSTICS affected=ROW_COUNT;
 RETURN affected;
END;
$$;
REVOKE ALL ON FUNCTION public.record_automation_reply_fact(uuid,text,text,timestamptz,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_automation_reply_fact(uuid,text,text,timestamptz,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.wake_automation_persisted_reply() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE received timestamptz; boundary timestamptz; consumed timestamptz; deadline timestamptz; cursor jsonb;
BEGIN
 IF NEW.status<>'awaiting_reply' OR NEW.current_node_id IS NULL THEN RETURN NEW; END IF;
 received:=nullif(NEW.context->>'ultima_resposta_received_at','')::timestamptz;
 boundary:=coalesce(nullif(NEW.context->>('__reply_after_'||NEW.current_node_id),'')::timestamptz,NEW.started_at);
 consumed:=nullif(NEW.context->>'__reply_consumed_at','')::timestamptz;
 IF received IS NULL OR boundary IS NULL OR received<=boundary OR (consumed IS NOT NULL AND received<=consumed) THEN RETURN NEW; END IF;
 IF jsonb_typeof(NEW.context->'__cursors')='array' THEN
  SELECT value INTO cursor FROM jsonb_array_elements(NEW.context->'__cursors')
  WHERE value->>'node'=NEW.current_node_id AND value->>'status'='awaiting_reply' LIMIT 1;
  IF cursor IS NULL THEN RETURN NEW; END IF;
 END IF;
 deadline:=coalesce(nullif(cursor->>'wake_at','')::timestamptz,
  nullif(NEW.context->>('__reply_deadline_'||NEW.current_node_id),'')::timestamptz,NEW.wake_at);
 IF deadline IS NOT NULL AND received>deadline THEN RETURN NEW; END IF;
 IF cursor IS NULL AND deadline IS NOT NULL THEN
  NEW.context:=coalesce(NEW.context,'{}'::jsonb)||jsonb_build_object('__reply_deadline_'||NEW.current_node_id,deadline);
 END IF;
 NEW.wake_at:=least(coalesce(NEW.wake_at,now()),now());
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.wake_automation_persisted_reply() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER wake_automation_persisted_reply BEFORE UPDATE ON public.automation_runs
FOR EACH ROW EXECUTE FUNCTION public.wake_automation_persisted_reply();
COMMIT;
