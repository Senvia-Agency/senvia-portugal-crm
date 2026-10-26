-- Workplace Mensagens: internal conversations between members of the SAME organization
-- (1:1, groups and the organization's "Geral" channel), with private files and realtime.
-- Only conversation members read messages: organization admins have no access to others' chats.
-- Conversations and memberships are created only through the functions below, which validate
-- the organization. Messages are never hard-deleted by clients: deleting clears the content.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- 1. Tables ----------------------------------------------------------------------------------

CREATE TABLE public.workplace_chat_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('direct', 'group', 'channel')),
  title text CHECK (title IS NULL OR char_length(btrim(title)) BETWEEN 1 AND 80),
  -- "<organization>:<smaller user id>:<larger user id>" keeps one 1:1 conversation per pair.
  direct_key text UNIQUE,
  is_default boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz,
  last_message_id uuid,
  CHECK ((kind = 'direct') = (direct_key IS NOT NULL)),
  CHECK (kind = 'direct' OR title IS NOT NULL)
);
CREATE UNIQUE INDEX workplace_chat_default_channel ON public.workplace_chat_conversations (organization_id) WHERE is_default;
CREATE INDEX workplace_chat_conversations_org ON public.workplace_chat_conversations (organization_id, last_message_at DESC);

CREATE TABLE public.workplace_chat_members (
  conversation_id uuid NOT NULL REFERENCES public.workplace_chat_conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  -- Visible to the other members: it is what drives unread counts and "Visto".
  last_read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX workplace_chat_members_user ON public.workplace_chat_members (user_id);

-- Personal preferences, visible only to their owner.
CREATE TABLE public.workplace_chat_member_settings (
  conversation_id uuid NOT NULL,
  user_id uuid NOT NULL,
  is_pinned boolean NOT NULL DEFAULT false,
  is_muted boolean NOT NULL DEFAULT false,
  is_archived boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id),
  FOREIGN KEY (conversation_id, user_id) REFERENCES public.workplace_chat_members(conversation_id, user_id) ON DELETE CASCADE
);

CREATE TABLE public.workplace_chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.workplace_chat_conversations(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sender_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  kind text NOT NULL DEFAULT 'text' CHECK (kind IN ('text', 'image', 'file', 'audio')),
  body text CHECK (body IS NULL OR char_length(body) <= 4000),
  attachment_path text,
  attachment_name text CHECK (attachment_name IS NULL OR char_length(attachment_name) <= 255),
  attachment_size bigint CHECK (attachment_size IS NULL OR attachment_size BETWEEN 0 AND 26214400),
  attachment_mime text,
  duration_sec numeric(6, 1),
  reply_to_id uuid REFERENCES public.workplace_chat_messages(id) ON DELETE SET NULL,
  forwarded boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  UNIQUE (id, conversation_id),
  CHECK (
    deleted_at IS NOT NULL
    OR (kind = 'text' AND body IS NOT NULL AND char_length(btrim(body)) > 0)
    OR (kind <> 'text' AND attachment_path IS NOT NULL)
  )
);
CREATE INDEX workplace_chat_messages_conversation ON public.workplace_chat_messages (conversation_id, created_at DESC);
CREATE INDEX workplace_chat_messages_org ON public.workplace_chat_messages (organization_id, created_at DESC);

ALTER TABLE public.workplace_chat_conversations
  ADD CONSTRAINT workplace_chat_conversations_last_message_fk
  FOREIGN KEY (last_message_id) REFERENCES public.workplace_chat_messages(id) ON DELETE SET NULL;

CREATE TABLE public.workplace_chat_reactions (
  message_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  emoji text NOT NULL CHECK (emoji IN ('👍', '❤️', '👏', '🎉', '😂', '😮', '😢', '🙏')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id, emoji),
  FOREIGN KEY (message_id, conversation_id) REFERENCES public.workplace_chat_messages(id, conversation_id) ON DELETE CASCADE
);
CREATE INDEX workplace_chat_reactions_conversation ON public.workplace_chat_reactions (conversation_id);

-- 2. Access helpers --------------------------------------------------------------------------

/** Member of the conversation, still an active member of its organization and MFA-compliant. */
CREATE FUNCTION public.workplace_chat_is_member(_conversation_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workplace_chat_members m
    JOIN public.workplace_chat_conversations c ON c.id = m.conversation_id
    WHERE m.conversation_id = _conversation_id AND m.user_id = (SELECT auth.uid())
      AND public.is_org_member((SELECT auth.uid()), c.organization_id)
      AND public.meets_mfa_policy((SELECT auth.uid()))
  );
$$;

/** Conversation that owns a file in the bucket ("<conversation>/<file>"). */
CREATE FUNCTION public.workplace_chat_path_conversation(_name text)
RETURNS uuid LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
  RETURN split_part(_name, '/', 1)::uuid;
EXCEPTION WHEN invalid_text_representation THEN
  RETURN NULL;
END $$;

/** Raises unless the caller is an active, MFA-compliant member of the organization. */
CREATE FUNCTION public.workplace_chat_require_org(_organization_id uuid)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_me uuid := auth.uid();
BEGIN
  IF v_me IS NULL OR NOT public.is_org_member(v_me, _organization_id) OR NOT public.meets_mfa_policy(v_me) THEN
    RAISE EXCEPTION 'workplace_chat_not_member' USING ERRCODE = '42501';
  END IF;
  RETURN v_me;
END $$;

-- 3. Row level security ---------------------------------------------------------------------

ALTER TABLE public.workplace_chat_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workplace_chat_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workplace_chat_member_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workplace_chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workplace_chat_reactions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.workplace_chat_conversations, public.workplace_chat_members, public.workplace_chat_member_settings,
  public.workplace_chat_messages, public.workplace_chat_reactions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.workplace_chat_conversations, public.workplace_chat_members TO authenticated;
GRANT SELECT, INSERT, UPDATE (is_pinned, is_muted, is_archived, updated_at) ON public.workplace_chat_member_settings TO authenticated;
GRANT SELECT, INSERT ON public.workplace_chat_messages TO authenticated;
GRANT UPDATE (body, deleted_at) ON public.workplace_chat_messages TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.workplace_chat_reactions TO authenticated;
GRANT ALL ON public.workplace_chat_conversations, public.workplace_chat_members, public.workplace_chat_member_settings,
  public.workplace_chat_messages, public.workplace_chat_reactions TO service_role;

CREATE POLICY workplace_chat_conversation_read ON public.workplace_chat_conversations FOR SELECT TO authenticated
  USING (public.workplace_chat_is_member(id));
CREATE POLICY workplace_chat_member_read ON public.workplace_chat_members FOR SELECT TO authenticated
  USING (public.workplace_chat_is_member(conversation_id));

CREATE POLICY workplace_chat_settings_read ON public.workplace_chat_member_settings FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
CREATE POLICY workplace_chat_settings_insert ON public.workplace_chat_member_settings FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()) AND public.workplace_chat_is_member(conversation_id));
CREATE POLICY workplace_chat_settings_update ON public.workplace_chat_member_settings FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY workplace_chat_message_read ON public.workplace_chat_messages FOR SELECT TO authenticated
  USING (public.workplace_chat_is_member(conversation_id));
CREATE POLICY workplace_chat_message_send ON public.workplace_chat_messages FOR INSERT TO authenticated
  WITH CHECK (sender_id = (SELECT auth.uid()) AND public.workplace_chat_is_member(conversation_id));
CREATE POLICY workplace_chat_message_own ON public.workplace_chat_messages FOR UPDATE TO authenticated
  USING (sender_id = (SELECT auth.uid()) AND public.workplace_chat_is_member(conversation_id))
  WITH CHECK (sender_id = (SELECT auth.uid()));

CREATE POLICY workplace_chat_reaction_read ON public.workplace_chat_reactions FOR SELECT TO authenticated
  USING (public.workplace_chat_is_member(conversation_id));
CREATE POLICY workplace_chat_reaction_add ON public.workplace_chat_reactions FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()) AND public.workplace_chat_is_member(conversation_id));
CREATE POLICY workplace_chat_reaction_remove ON public.workplace_chat_reactions FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- 4. Message integrity -----------------------------------------------------------------------

CREATE FUNCTION public.workplace_chat_messages_before_write()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT c.organization_id INTO NEW.organization_id FROM public.workplace_chat_conversations c WHERE c.id = NEW.conversation_id;
    NEW.created_at := now();
    NEW.edited_at := NULL;
    NEW.deleted_at := NULL;
    IF NEW.reply_to_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.workplace_chat_messages r WHERE r.id = NEW.reply_to_id AND r.conversation_id = NEW.conversation_id
    ) THEN
      RAISE EXCEPTION 'workplace_chat_reply_other_conversation' USING ERRCODE = '23514';
    END IF;
    IF NEW.attachment_path IS NOT NULL
      AND public.workplace_chat_path_conversation(NEW.attachment_path) IS DISTINCT FROM NEW.conversation_id THEN
      RAISE EXCEPTION 'workplace_chat_attachment_other_conversation' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: clients may only change body (text edits) or deleted_at (see the column grants).
  IF OLD.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'workplace_chat_message_deleted' USING ERRCODE = '23514';
  END IF;
  IF NEW.deleted_at IS NOT NULL THEN
    -- Deleting clears the content; the app removes the stored file.
    NEW.deleted_at := now();
    NEW.body := NULL;
    NEW.attachment_path := NULL;
    NEW.attachment_name := NULL;
    NEW.attachment_size := NULL;
    NEW.attachment_mime := NULL;
    NEW.duration_sec := NULL;
  ELSIF NEW.body IS DISTINCT FROM OLD.body THEN
    IF OLD.kind <> 'text' THEN
      RAISE EXCEPTION 'workplace_chat_only_text_editable' USING ERRCODE = '23514';
    END IF;
    NEW.edited_at := now();
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.workplace_chat_messages_before_write() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER workplace_chat_messages_before_write BEFORE INSERT OR UPDATE ON public.workplace_chat_messages
  FOR EACH ROW EXECUTE FUNCTION public.workplace_chat_messages_before_write();

/** New message: conversation preview, read for the sender, back from the archive unless muted. */
CREATE FUNCTION public.workplace_chat_messages_after_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.workplace_chat_conversations
     SET last_message_at = NEW.created_at, last_message_id = NEW.id
   WHERE id = NEW.conversation_id;
  UPDATE public.workplace_chat_members
     SET last_read_at = NEW.created_at
   WHERE conversation_id = NEW.conversation_id AND user_id = NEW.sender_id;
  UPDATE public.workplace_chat_member_settings
     SET is_archived = false, updated_at = now()
   WHERE conversation_id = NEW.conversation_id AND is_archived AND NOT is_muted;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.workplace_chat_messages_after_insert() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER workplace_chat_messages_after_insert AFTER INSERT ON public.workplace_chat_messages
  FOR EACH ROW EXECUTE FUNCTION public.workplace_chat_messages_after_insert();

-- 5. Conversation functions ------------------------------------------------------------------

/** Ensures the organization's "Geral" channel exists and that the caller belongs to it. */
CREATE FUNCTION public.workplace_chat_bootstrap(_organization_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_me uuid := public.workplace_chat_require_org(_organization_id); v_id uuid;
BEGIN
  INSERT INTO public.workplace_chat_conversations (organization_id, kind, title, is_default)
  VALUES (_organization_id, 'channel', 'Geral', true)
  ON CONFLICT (organization_id) WHERE is_default DO NOTHING;
  SELECT id INTO v_id FROM public.workplace_chat_conversations WHERE organization_id = _organization_id AND is_default;
  INSERT INTO public.workplace_chat_members (conversation_id, user_id) VALUES (v_id, v_me) ON CONFLICT DO NOTHING;
  RETURN v_id;
END $$;

/** Opens (or creates) the 1:1 conversation with a colleague of the same organization. */
CREATE FUNCTION public.workplace_chat_start_direct(_organization_id uuid, _other_user_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_me uuid := public.workplace_chat_require_org(_organization_id); v_key text; v_id uuid;
BEGIN
  IF _other_user_id IS NULL OR _other_user_id = v_me OR NOT public.is_org_member(_other_user_id, _organization_id) THEN
    RAISE EXCEPTION 'workplace_chat_invalid_colleague' USING ERRCODE = '23514';
  END IF;
  v_key := _organization_id::text || ':' || least(v_me::text, _other_user_id::text) || ':' || greatest(v_me::text, _other_user_id::text);
  INSERT INTO public.workplace_chat_conversations (organization_id, kind, direct_key, created_by)
  VALUES (_organization_id, 'direct', v_key, v_me)
  ON CONFLICT (direct_key) DO NOTHING;
  SELECT id INTO v_id FROM public.workplace_chat_conversations WHERE direct_key = v_key;
  INSERT INTO public.workplace_chat_members (conversation_id, user_id)
  VALUES (v_id, v_me), (v_id, _other_user_id) ON CONFLICT DO NOTHING;
  RETURN v_id;
END $$;

/** Creates a group with colleagues of the same organization; the creator owns it. */
CREATE FUNCTION public.workplace_chat_create_group(_organization_id uuid, _title text, _member_ids uuid[])
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_me uuid := public.workplace_chat_require_org(_organization_id); v_id uuid; v_member uuid; v_count integer := 0;
BEGIN
  IF _title IS NULL OR char_length(btrim(_title)) NOT BETWEEN 1 AND 80 THEN
    RAISE EXCEPTION 'workplace_chat_invalid_title' USING ERRCODE = '23514';
  END IF;
  INSERT INTO public.workplace_chat_conversations (organization_id, kind, title, created_by)
  VALUES (_organization_id, 'group', btrim(_title), v_me) RETURNING id INTO v_id;
  INSERT INTO public.workplace_chat_members (conversation_id, user_id, role) VALUES (v_id, v_me, 'owner');
  FOREACH v_member IN ARRAY coalesce(_member_ids, '{}') LOOP
    CONTINUE WHEN v_member IS NULL OR v_member = v_me;
    IF NOT public.is_org_member(v_member, _organization_id) THEN
      RAISE EXCEPTION 'workplace_chat_invalid_colleague' USING ERRCODE = '23514';
    END IF;
    INSERT INTO public.workplace_chat_members (conversation_id, user_id) VALUES (v_id, v_member) ON CONFLICT DO NOTHING;
    v_count := v_count + 1;
  END LOOP;
  IF v_count = 0 OR v_count > 99 THEN
    RAISE EXCEPTION 'workplace_chat_invalid_group_size' USING ERRCODE = '23514';
  END IF;
  RETURN v_id;
END $$;

/** Group owners and admins add colleagues of the same organization. */
CREATE FUNCTION public.workplace_chat_add_members(_conversation_id uuid, _member_ids uuid[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_me uuid := auth.uid(); v_org uuid; v_member uuid;
BEGIN
  SELECT c.organization_id INTO v_org FROM public.workplace_chat_conversations c
   JOIN public.workplace_chat_members m ON m.conversation_id = c.id AND m.user_id = v_me AND m.role IN ('owner', 'admin')
   WHERE c.id = _conversation_id AND c.kind = 'group';
  IF v_org IS NULL OR NOT public.workplace_chat_is_member(_conversation_id) THEN
    RAISE EXCEPTION 'workplace_chat_not_group_admin' USING ERRCODE = '42501';
  END IF;
  FOREACH v_member IN ARRAY coalesce(_member_ids, '{}') LOOP
    CONTINUE WHEN v_member IS NULL;
    IF NOT public.is_org_member(v_member, v_org) THEN
      RAISE EXCEPTION 'workplace_chat_invalid_colleague' USING ERRCODE = '23514';
    END IF;
    INSERT INTO public.workplace_chat_members (conversation_id, user_id) VALUES (_conversation_id, v_member) ON CONFLICT DO NOTHING;
  END LOOP;
  IF (SELECT count(*) FROM public.workplace_chat_members WHERE conversation_id = _conversation_id) > 100 THEN
    RAISE EXCEPTION 'workplace_chat_invalid_group_size' USING ERRCODE = '23514';
  END IF;
END $$;

/** Leaves a group. If no owner remains, the longest-standing member becomes the owner. */
CREATE FUNCTION public.workplace_chat_leave_group(_conversation_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_me uuid := auth.uid();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.workplace_chat_conversations WHERE id = _conversation_id AND kind = 'group')
    OR NOT public.workplace_chat_is_member(_conversation_id) THEN
    RAISE EXCEPTION 'workplace_chat_not_group_member' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.workplace_chat_members WHERE conversation_id = _conversation_id AND user_id = v_me;
  IF NOT EXISTS (SELECT 1 FROM public.workplace_chat_members WHERE conversation_id = _conversation_id AND role = 'owner') THEN
    UPDATE public.workplace_chat_members SET role = 'owner'
     WHERE (conversation_id, user_id) = (
       SELECT conversation_id, user_id FROM public.workplace_chat_members
        WHERE conversation_id = _conversation_id ORDER BY joined_at, user_id LIMIT 1);
  END IF;
END $$;

/** Any group member renames the group (like WhatsApp); 1:1 conversations and channels cannot be renamed. */
CREATE FUNCTION public.workplace_chat_rename_group(_conversation_id uuid, _title text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF _title IS NULL OR char_length(btrim(_title)) NOT BETWEEN 1 AND 80 THEN
    RAISE EXCEPTION 'workplace_chat_invalid_title' USING ERRCODE = '23514';
  END IF;
  IF NOT public.workplace_chat_is_member(_conversation_id) THEN
    RAISE EXCEPTION 'workplace_chat_not_group_member' USING ERRCODE = '42501';
  END IF;
  UPDATE public.workplace_chat_conversations SET title = btrim(_title) WHERE id = _conversation_id AND kind = 'group';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'workplace_chat_not_group' USING ERRCODE = '23514';
  END IF;
END $$;

CREATE FUNCTION public.workplace_chat_mark_read(_conversation_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF public.workplace_chat_is_member(_conversation_id) THEN
    UPDATE public.workplace_chat_members SET last_read_at = now()
     WHERE conversation_id = _conversation_id AND user_id = (SELECT auth.uid());
  END IF;
END $$;

/** The caller's conversations in one organization, with preferences, unread count and last message. */
CREATE FUNCTION public.workplace_chat_list_conversations(_organization_id uuid)
RETURNS TABLE (
  id uuid, kind text, title text, is_default boolean, created_at timestamptz, last_message_at timestamptz,
  my_role text, is_pinned boolean, is_muted boolean, is_archived boolean, member_count integer, unread integer,
  peer_user_id uuid, last_sender_id uuid, last_kind text, last_body text, last_attachment_name text, last_deleted boolean
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_me uuid := public.workplace_chat_require_org(_organization_id);
BEGIN
  RETURN QUERY
  SELECT c.id, c.kind, c.title, c.is_default, c.created_at, c.last_message_at,
    m.role, coalesce(s.is_pinned, false), coalesce(s.is_muted, false), coalesce(s.is_archived, false),
    (SELECT count(*)::integer FROM public.workplace_chat_members x WHERE x.conversation_id = c.id),
    (SELECT count(*)::integer FROM public.workplace_chat_messages u
      WHERE u.conversation_id = c.id AND u.created_at > m.last_read_at AND u.sender_id IS DISTINCT FROM v_me AND u.deleted_at IS NULL),
    CASE WHEN c.kind = 'direct' THEN (SELECT p.user_id FROM public.workplace_chat_members p WHERE p.conversation_id = c.id AND p.user_id <> v_me LIMIT 1) END,
    l.sender_id, l.kind, left(l.body, 160), l.attachment_name, l.deleted_at IS NOT NULL
  FROM public.workplace_chat_members m
  JOIN public.workplace_chat_conversations c ON c.id = m.conversation_id AND c.organization_id = _organization_id
  LEFT JOIN public.workplace_chat_member_settings s ON s.conversation_id = c.id AND s.user_id = v_me
  LEFT JOIN public.workplace_chat_messages l ON l.id = c.last_message_id
  WHERE m.user_id = v_me
  ORDER BY coalesce(c.last_message_at, c.created_at) DESC;
END $$;

/** Accent- and case-insensitive search across the caller's conversations (RLS applies). */
CREATE FUNCTION public.workplace_chat_search_messages(_organization_id uuid, _term text, _limit integer DEFAULT 20)
RETURNS TABLE (id uuid, conversation_id uuid, sender_id uuid, body text, created_at timestamptz)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT msg.id, msg.conversation_id, msg.sender_id, msg.body, msg.created_at
  FROM public.workplace_chat_messages msg
  WHERE msg.organization_id = _organization_id AND msg.deleted_at IS NULL AND msg.body IS NOT NULL
    AND char_length(btrim(_term)) >= 2
    AND public.immutable_unaccent(lower(msg.body)) LIKE '%' || public.immutable_unaccent(lower(btrim(_term))) || '%'
  ORDER BY msg.created_at DESC
  LIMIT least(greatest(coalesce(_limit, 20), 1), 50);
$$;

REVOKE ALL ON FUNCTION public.workplace_chat_is_member(uuid), public.workplace_chat_path_conversation(text),
  public.workplace_chat_require_org(uuid), public.workplace_chat_bootstrap(uuid), public.workplace_chat_start_direct(uuid, uuid),
  public.workplace_chat_create_group(uuid, text, uuid[]), public.workplace_chat_add_members(uuid, uuid[]),
  public.workplace_chat_leave_group(uuid), public.workplace_chat_rename_group(uuid, text), public.workplace_chat_mark_read(uuid),
  public.workplace_chat_list_conversations(uuid), public.workplace_chat_search_messages(uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.workplace_chat_is_member(uuid), public.workplace_chat_path_conversation(text),
  public.workplace_chat_bootstrap(uuid), public.workplace_chat_start_direct(uuid, uuid),
  public.workplace_chat_create_group(uuid, text, uuid[]), public.workplace_chat_add_members(uuid, uuid[]),
  public.workplace_chat_leave_group(uuid), public.workplace_chat_rename_group(uuid, text), public.workplace_chat_mark_read(uuid),
  public.workplace_chat_list_conversations(uuid), public.workplace_chat_search_messages(uuid, text, integer) TO authenticated;

-- 6. Private files ---------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'workplace-chat-files', 'workplace-chat-files', false, 26214400,
  ARRAY[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic',
    'application/pdf', 'text/plain', 'text/csv', 'application/zip', 'application/x-zip-compressed',
    'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/wav'
  ]
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Workplace chat: members read files" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'workplace-chat-files' AND public.workplace_chat_is_member(public.workplace_chat_path_conversation(name)));
CREATE POLICY "Workplace chat: members upload files" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'workplace-chat-files' AND public.workplace_chat_is_member(public.workplace_chat_path_conversation(name)));
CREATE POLICY "Workplace chat: uploader deletes file" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'workplace-chat-files' AND owner_id = (SELECT auth.uid())::text);

-- 7. Realtime ---------------------------------------------------------------------------------
-- Rows reach members through postgres_changes (RLS applies). Typing and reaction nudges use the
-- private broadcast channel "workplace-chat-<conversation>", open only to that conversation's members.
DO $$
DECLARE target text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    FOREACH target IN ARRAY ARRAY['workplace_chat_messages', 'workplace_chat_members', 'workplace_chat_member_settings', 'workplace_chat_conversations'] LOOP
      IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = target) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', target);
      END IF;
    END LOOP;
  END IF;
END $$;

CREATE POLICY "Workplace chat: members read realtime" ON realtime.messages FOR SELECT TO authenticated
  USING (realtime.topic() LIKE 'workplace-chat-%'
    AND public.workplace_chat_is_member((substring(realtime.topic() FROM '[0-9a-fA-F-]{36}$'))::uuid));
CREATE POLICY "Workplace chat: members send realtime" ON realtime.messages FOR INSERT TO authenticated
  WITH CHECK (realtime.topic() LIKE 'workplace-chat-%'
    AND public.workplace_chat_is_member((substring(realtime.topic() FROM '[0-9a-fA-F-]{36}$'))::uuid));

NOTIFY pgrst, 'reload schema';
COMMIT;
