-- Atomic, server-only cache fill. Does not send, move or delete mailbox messages.
CREATE OR REPLACE FUNCTION public.cache_email_message_content(
 _message_id uuid, _channel_id uuid, _organization_id uuid, _uid bigint,
 _html text, _text text, _attachments jsonb
) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE existing public.email_messages%ROWTYPE; item jsonb;
BEGIN
 SELECT * INTO existing FROM public.email_messages WHERE id=_message_id
  AND channel_id=_channel_id AND organization_id=_organization_id AND uid=_uid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Message unavailable'; END IF;
 IF existing.body_fetched THEN RETURN; END IF;
 IF jsonb_typeof(_attachments) IS DISTINCT FROM 'array' OR jsonb_array_length(_attachments)>100
  OR coalesce(octet_length(_html),0)+coalesce(octet_length(_text),0)>31457280
  OR octet_length(_attachments::text)>23068672 THEN RAISE EXCEPTION 'Content too large'; END IF;
 -- Preserve any attachment IDs/bytes already referenced by open clients.
 IF NOT EXISTS(SELECT 1 FROM public.email_attachments WHERE message_id=_message_id) THEN
  FOR item IN SELECT value FROM jsonb_array_elements(_attachments) LOOP
   INSERT INTO public.email_attachments(organization_id,message_id,part_id,filename,content_type,size,inline,content_id,data_b64)
    VALUES(_organization_id,_message_id,item->>'part_id',item->>'filename',item->>'content_type',
     (item->>'size')::integer,coalesce((item->>'inline')::boolean,false),item->>'content_id',item->>'data_b64');
  END LOOP;
 END IF;
 UPDATE public.email_messages SET html_body=_html,text_body=_text,
  snippet=left(regexp_replace(coalesce(_text,''),'\s+',' ','g'),200),body_fetched=true,updated_at=now()
  WHERE id=_message_id AND channel_id=_channel_id AND organization_id=_organization_id;
END $$;
REVOKE ALL ON FUNCTION public.cache_email_message_content(uuid,uuid,uuid,bigint,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cache_email_message_content(uuid,uuid,uuid,bigint,text,text,jsonb) TO service_role;
