ALTER TABLE public.inbox_tasks
  ADD COLUMN source_channel_id uuid REFERENCES public.messaging_channels(id) ON DELETE RESTRICT;

CREATE POLICY inbox_tasks_source_channel_scope ON public.inbox_tasks
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (source_channel_id IS NULL OR public.pode_aceder_caixa(auth.uid(), source_channel_id))
  WITH CHECK (source_channel_id IS NULL OR public.pode_aceder_caixa(auth.uid(), source_channel_id));

CREATE FUNCTION public.preserve_inbox_task_source_scope()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') AND (
    NEW.source_channel_id IS DISTINCT FROM OLD.source_channel_id
    OR (OLD.source_channel_id IS NOT NULL AND NEW.organization_id IS DISTINCT FROM OLD.organization_id)
  ) THEN
    RAISE EXCEPTION 'Task source scope is immutable' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER inbox_tasks_preserve_source_scope BEFORE UPDATE ON public.inbox_tasks
  FOR EACH ROW EXECUTE FUNCTION public.preserve_inbox_task_source_scope();

CREATE TABLE public.inbox_task_analysis (
  message_id uuid PRIMARY KEY REFERENCES public.meta_messages(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  task_id uuid REFERENCES public.inbox_tasks(id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('processing', 'done')),
  lease_token uuid NOT NULL,
  lease_expires_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inbox_task_analysis ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.inbox_task_analysis FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.inbox_task_analysis TO service_role;

CREATE FUNCTION public.claim_inbox_task_analysis(p_message_id uuid, p_organization_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_token uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.meta_messages WHERE id = p_message_id AND organization_id = p_organization_id AND NOT is_deleted) THEN
    RAISE EXCEPTION 'Message unavailable';
  END IF;
  INSERT INTO public.inbox_task_analysis (message_id, organization_id, status, lease_token, lease_expires_at)
    VALUES (p_message_id, p_organization_id, 'processing', gen_random_uuid(), now() + interval '2 minutes')
  ON CONFLICT (message_id) DO UPDATE SET
    lease_token = gen_random_uuid(), lease_expires_at = now() + interval '2 minutes', updated_at = now()
    WHERE inbox_task_analysis.status = 'processing' AND inbox_task_analysis.lease_expires_at < now()
      AND inbox_task_analysis.organization_id = p_organization_id
  RETURNING lease_token INTO v_token;
  RETURN v_token;
END;
$$;

CREATE FUNCTION public.finish_inbox_task_analysis(p_message_id uuid, p_lease_token uuid, p_title text, p_due_at timestamptz)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_analysis public.inbox_task_analysis; v_message public.meta_messages;
  v_conversation public.meta_conversations; v_channel public.messaging_channels;
  v_task uuid; v_phone_key text;
BEGIN
  SELECT * INTO v_analysis FROM public.inbox_task_analysis
    WHERE message_id = p_message_id AND lease_token = p_lease_token AND status = 'processing'
      AND lease_expires_at > now() FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT * INTO STRICT v_message FROM public.meta_messages
    WHERE id = p_message_id AND organization_id = v_analysis.organization_id;
  SELECT * INTO STRICT v_conversation FROM public.meta_conversations
    WHERE id = v_message.conversation_id AND organization_id = v_analysis.organization_id;
  SELECT * INTO STRICT v_channel FROM public.messaging_channels
    WHERE id = v_conversation.channel_id AND organization_id = v_analysis.organization_id;
  v_phone_key := right(v_conversation.contact_ref, 9);
  PERFORM pg_advisory_xact_lock(hashtextextended(v_analysis.organization_id::text || ':' || v_phone_key, 0));
  IF NOT v_message.is_deleted AND p_title IS NOT NULL AND length(trim(p_title)) BETWEEN 1 AND 160
      AND v_conversation.contact_ref ~ '^[0-9]{9,15}$'
      AND v_channel.channel_type = 'whatsapp' AND v_channel.status = 'connected'
      AND v_channel.archived_at IS NULL AND (v_channel.metadata->>'ai_tasks_enabled') IS DISTINCT FROM 'false'
      AND (SELECT count(*) FROM public.inbox_tasks WHERE organization_id = v_analysis.organization_id
           AND phone_key = v_phone_key AND suggested AND done_at IS NULL) < 3
      AND NOT EXISTS (SELECT 1 FROM public.inbox_tasks WHERE organization_id = v_analysis.organization_id
           AND phone_key = v_phone_key AND done_at IS NULL AND
             (lower(regexp_replace(trim(title), '\s+', ' ', 'g')) = lower(regexp_replace(trim(p_title), '\s+', ' ', 'g'))
              OR source_message = left(v_message.content, 300))) THEN
    INSERT INTO public.inbox_tasks (organization_id, created_by, suggested, source_message, conversation_id, source_channel_id,
      contact_phone, contact_name, title, due_at)
    VALUES (v_analysis.organization_id, NULL, true, left(v_message.content, 300), NULL, v_conversation.channel_id,
      v_conversation.contact_ref, v_conversation.contact_name, trim(p_title),
      CASE WHEN p_due_at > now() THEN p_due_at ELSE NULL END)
    RETURNING id INTO v_task;
  END IF;
  UPDATE public.inbox_task_analysis SET status = 'done', task_id = v_task, updated_at = now()
    WHERE message_id = p_message_id;
  RETURN v_task IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_inbox_task_analysis(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_inbox_task_analysis(uuid, uuid, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_inbox_task_analysis(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_inbox_task_analysis(uuid, uuid, text, timestamptz) TO service_role;
