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

CREATE OR REPLACE FUNCTION public.preserve_automation_reply_fact() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF nullif(OLD.context->>'ultima_resposta_received_at','') IS NOT NULL
  AND (nullif(NEW.context->>'ultima_resposta_received_at','') IS NULL OR (OLD.context->>'ultima_resposta_received_at')::timestamptz>(NEW.context->>'ultima_resposta_received_at')::timestamptz) THEN
  NEW.context:=coalesce(NEW.context,'{}'::jsonb)||jsonb_build_object('ultima_resposta',OLD.context->'ultima_resposta',
   'ultima_resposta_received_at',OLD.context->'ultima_resposta_received_at','respondeu',OLD.context->'respondeu');
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.preserve_automation_reply_fact() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER preserve_automation_reply_fact BEFORE UPDATE ON public.automation_runs FOR EACH ROW EXECUTE FUNCTION public.preserve_automation_reply_fact();

CREATE OR REPLACE FUNCTION public.capture_automation_reply_fact() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE conv public.meta_conversations%ROWTYPE; kind text;
BEGIN
 IF NEW.direction<>'incoming' OR nullif(trim(NEW.content),'') IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO conv FROM public.meta_conversations WHERE id=NEW.conversation_id AND organization_id=NEW.organization_id;
 IF NOT FOUND THEN RETURN NEW; END IF;
 SELECT channel_type INTO kind FROM public.messaging_channels WHERE id=conv.channel_id AND organization_id=NEW.organization_id;
 -- Reply freshness is server ingestion time; provider sent_at stays on the message for display/history.
 -- The unique conversation/external_id index rejects redelivery before this INSERT trigger executes.
 PERFORM public.record_automation_reply_fact(NEW.organization_id,CASE WHEN kind='whatsapp' THEN conv.contact_ref ELSE NULL END,NEW.content,NEW.created_at,conv.id);
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.capture_automation_reply_fact() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER capture_automation_reply_fact AFTER INSERT ON public.meta_messages FOR EACH ROW EXECUTE FUNCTION public.capture_automation_reply_fact();
COMMIT;
