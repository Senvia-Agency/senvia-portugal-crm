-- WebMail (Realize-style) on top of the existing IMAP gateway.
-- Mailboxes stay organization caixas (messaging_channels, created by admins, synced by the gateway).
-- What this adds is personal: each person's name, colour, order, default and alerts per caixa,
-- their own signatures (with images), the contacts they write to and their contact lists.
-- Every row belongs to one person and is visible only to them, and only for caixas they can open
-- (pode_aceder_caixa). Nothing existing is changed except the new-mail push, which now skips people
-- who switched alerts off for that caixa.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- 1. Tables ----------------------------------------------------------------------------------

-- Personal view of a caixa. The admin's caixa name (messaging_channels.label) stays the shared one.
CREATE TABLE public.email_account_preferences (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES public.messaging_channels(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  label text CHECK (label IS NULL OR char_length(btrim(label)) BETWEEN 1 AND 60),
  color text CHECK (color IS NULL OR color ~ '^#[0-9a-fA-F]{6}$'),
  notify boolean NOT NULL DEFAULT true,
  -- The caixa "Escrever" opens with.
  is_default boolean NOT NULL DEFAULT false,
  position integer CHECK (position IS NULL OR position BETWEEN 0 AND 1000),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, channel_id)
);
CREATE UNIQUE INDEX email_account_preferences_one_default
  ON public.email_account_preferences (user_id, organization_id) WHERE is_default;
CREATE INDEX email_account_preferences_muted
  ON public.email_account_preferences (channel_id) WHERE NOT notify;

-- Several signatures per person and caixa; at most one is the default.
CREATE TABLE public.email_signatures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES public.messaging_channels(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  html text NOT NULL DEFAULT '' CHECK (char_length(html) <= 20000),
  is_default boolean NOT NULL DEFAULT false,
  position integer NOT NULL DEFAULT 0 CHECK (position BETWEEN 0 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX email_signatures_one_default ON public.email_signatures (user_id, channel_id) WHERE is_default;
CREATE INDEX email_signatures_owner ON public.email_signatures (user_id, channel_id, position);

-- Addresses this person wrote to, ranked by use for the recipient suggestions.
CREATE TABLE public.email_contacts (
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email text NOT NULL CHECK (email = lower(email) AND char_length(email) <= 254
    AND email ~ '^[^[:space:]@<>,;]+@[^[:space:]@<>,;]+\.[^[:space:]@<>,;]+$'),
  name text CHECK (name IS NULL OR char_length(name) <= 120),
  uses integer NOT NULL DEFAULT 1 CHECK (uses >= 0),
  last_used_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, organization_id, email)
);
CREATE INDEX email_contacts_rank ON public.email_contacts (user_id, organization_id, uses DESC, last_used_at DESC);

-- Private lists: choosing one in "Para" adds all its members.
CREATE TABLE public.email_contact_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  -- [{ "email": "...", "name": "..." }]
  members jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(members) = 'array' AND jsonb_array_length(members) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX email_contact_lists_name ON public.email_contact_lists (user_id, organization_id, lower(btrim(name)));

-- 2. Organization always follows the caixa --------------------------------------------------

CREATE OR REPLACE FUNCTION public.email_personal_row_org()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.organization_id := (
    SELECT c.organization_id FROM public.messaging_channels c
     WHERE c.id = NEW.channel_id AND c.channel_type = 'email'
  );
  IF NEW.organization_id IS NULL THEN
    RAISE EXCEPTION 'email_channel_not_found' USING ERRCODE = '23503';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.email_personal_row_org() FROM PUBLIC;

CREATE TRIGGER email_account_preferences_org BEFORE INSERT OR UPDATE ON public.email_account_preferences
  FOR EACH ROW EXECUTE FUNCTION public.email_personal_row_org();
CREATE TRIGGER email_signatures_org BEFORE INSERT OR UPDATE ON public.email_signatures
  FOR EACH ROW EXECUTE FUNCTION public.email_personal_row_org();
CREATE TRIGGER email_contact_lists_updated BEFORE UPDATE ON public.email_contact_lists
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Row level security ---------------------------------------------------------------------

ALTER TABLE public.email_account_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_signatures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_contact_lists ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.email_account_preferences, public.email_signatures, public.email_contacts,
  public.email_contact_lists FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_account_preferences, public.email_signatures,
  public.email_contacts, public.email_contact_lists TO authenticated;
GRANT ALL ON public.email_account_preferences, public.email_signatures, public.email_contacts,
  public.email_contact_lists TO service_role;

CREATE POLICY email_account_preferences_own ON public.email_account_preferences FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()) AND public.pode_aceder_caixa((SELECT auth.uid()), channel_id))
  WITH CHECK (user_id = (SELECT auth.uid()) AND public.pode_aceder_caixa((SELECT auth.uid()), channel_id));
CREATE POLICY email_signatures_own ON public.email_signatures FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()) AND public.pode_aceder_caixa((SELECT auth.uid()), channel_id))
  WITH CHECK (user_id = (SELECT auth.uid()) AND public.pode_aceder_caixa((SELECT auth.uid()), channel_id));
CREATE POLICY email_contacts_own ON public.email_contacts FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()) AND public.is_org_member((SELECT auth.uid()), organization_id))
  WITH CHECK (user_id = (SELECT auth.uid()) AND public.is_org_member((SELECT auth.uid()), organization_id));
CREATE POLICY email_contact_lists_own ON public.email_contact_lists FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()) AND public.is_org_member((SELECT auth.uid()), organization_id))
  WITH CHECK (user_id = (SELECT auth.uid()) AND public.is_org_member((SELECT auth.uid()), organization_id));

-- 4. Functions (run as the caller: the policies above still apply) ---------------------------

-- Replaces this person's signatures for one caixa in one step: keeps the given order, removes the
-- missing ones and leaves exactly one default (the first one when none is marked).
CREATE OR REPLACE FUNCTION public.email_save_signatures(_channel_id uuid, _items jsonb)
RETURNS SETOF public.email_signatures
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
  item jsonb;
  pos integer := 0;
  keep uuid[] := '{}';
  chosen uuid;
  row_id uuid;
BEGIN
  IF me IS NULL OR NOT public.pode_aceder_caixa(me, _channel_id) THEN
    RAISE EXCEPTION 'email_signature_forbidden' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(_items) IS DISTINCT FROM 'array' OR jsonb_array_length(_items) > 20 THEN
    RAISE EXCEPTION 'email_signature_invalid' USING ERRCODE = '22023';
  END IF;

  -- Clear the default first so the one-default index never sees two at once.
  UPDATE public.email_signatures SET is_default = false
   WHERE user_id = me AND channel_id = _channel_id AND is_default;

  FOR item IN SELECT value FROM jsonb_array_elements(_items) LOOP
    row_id := NULL;
    IF item->>'id' ~ '^[0-9a-fA-F-]{36}$' THEN
      UPDATE public.email_signatures
         SET name = btrim(item->>'name'), html = COALESCE(item->>'html', ''), position = pos
       WHERE id = (item->>'id')::uuid AND user_id = me AND channel_id = _channel_id
      RETURNING id INTO row_id;
    END IF;
    IF row_id IS NULL THEN
      INSERT INTO public.email_signatures (user_id, channel_id, name, html, position)
      VALUES (me, _channel_id, btrim(item->>'name'), COALESCE(item->>'html', ''), pos)
      RETURNING id INTO row_id;
    END IF;
    keep := keep || row_id;
    IF chosen IS NULL AND COALESCE((item->>'is_default')::boolean, false) THEN chosen := row_id; END IF;
    pos := pos + 1;
  END LOOP;

  DELETE FROM public.email_signatures
   WHERE user_id = me AND channel_id = _channel_id AND NOT (id = ANY (keep));

  chosen := COALESCE(chosen, keep[1]);
  IF chosen IS NOT NULL THEN
    UPDATE public.email_signatures SET is_default = true WHERE id = chosen;
  END IF;

  RETURN QUERY SELECT * FROM public.email_signatures
   WHERE user_id = me AND channel_id = _channel_id ORDER BY position;
END;
$$;

-- Called after each send: adds new addresses and bumps the ones already known.
CREATE OR REPLACE FUNCTION public.email_remember_contacts(_organization_id uuid, _items jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
BEGIN
  IF me IS NULL OR NOT public.is_org_member(me, _organization_id) THEN
    RAISE EXCEPTION 'email_contacts_forbidden' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(_items) IS DISTINCT FROM 'array' OR jsonb_array_length(_items) > 100 THEN
    RAISE EXCEPTION 'email_contacts_invalid' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.email_contacts (user_id, organization_id, email, name)
  SELECT DISTINCT ON (address) me, _organization_id, address, label
    FROM (
      SELECT lower(btrim(value->>'email')) AS address,
             NULLIF(left(btrim(COALESCE(value->>'name', '')), 120), '') AS label
        FROM jsonb_array_elements(_items)
    ) given
   WHERE char_length(address) <= 254
     AND address ~ '^[^[:space:]@<>,;]+@[^[:space:]@<>,;]+\.[^[:space:]@<>,;]+$'
   ORDER BY address, label NULLS LAST
  ON CONFLICT (user_id, organization_id, email) DO UPDATE
     SET uses = public.email_contacts.uses + 1,
         last_used_at = now(),
         name = COALESCE(EXCLUDED.name, public.email_contacts.name);
END;
$$;

REVOKE ALL ON FUNCTION public.email_save_signatures(uuid, jsonb), public.email_remember_contacts(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.email_save_signatures(uuid, jsonb), public.email_remember_contacts(uuid, jsonb) TO authenticated;

-- 5. Signature images -------------------------------------------------------------------------
-- Public on purpose: the people who receive the email must be able to load the images.
-- Each person writes only inside their own folder: "<user id>/<file>".
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('email-signatures', 'email-signatures', true, 5242880,
  ARRAY['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Email signatures: owner uploads" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'email-signatures' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);
CREATE POLICY "Email signatures: owner deletes" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'email-signatures' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);

-- 6. New-mail push respects "Avisos" ---------------------------------------------------------
-- Same function as 20260813150000, plus: people who switched alerts off for this caixa are left
-- out. With nobody left, no push is sent.
CREATE OR REPLACE FUNCTION public.notificar_email_novo()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_canal   RECORD;
  v_pasta   RECORD;
  v_quem    TEXT;
  v_titulo  TEXT;
  v_corpo   TEXT;
  v_destino JSONB;
  v_chave   TEXT;
  v_mudos   uuid[];
  v_pessoas uuid[];
BEGIN
  IF NEW.seen THEN RETURN NEW; END IF;

  SELECT id, organization_id, label, assigned_user_ids
    INTO v_canal
    FROM public.messaging_channels
   WHERE id = NEW.channel_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  SELECT role INTO v_pasta FROM public.email_folders WHERE id = NEW.folder_id;
  IF NOT FOUND OR v_pasta.role <> 'inbox' THEN RETURN NEW; END IF;

  v_quem := COALESCE(NULLIF(NEW.from_name, ''), NEW.from_address, 'Novo contacto');
  v_titulo := '📧 ' || v_quem;
  v_corpo := left(COALESCE(NULLIF(NEW.subject, ''), NEW.snippet, 'Nova mensagem'), 140);

  v_destino := jsonb_build_object(
    'organization_id', v_canal.organization_id,
    'title', v_titulo,
    'body', v_corpo,
    'url', '/inbox',
    'tag', 'email-' || COALESCE(NEW.from_address, NEW.id::text)
  );

  -- Best effort: a notification problem must never stop the gateway from saving the message.
  BEGIN
    SELECT array_agg(p.user_id) INTO v_mudos
      FROM public.email_account_preferences p
     WHERE p.channel_id = NEW.channel_id AND NOT p.notify;

    IF v_canal.assigned_user_ids IS NOT NULL AND cardinality(v_canal.assigned_user_ids) > 0 THEN
      v_pessoas := ARRAY(SELECT u FROM unnest(v_canal.assigned_user_ids) AS u
                          WHERE v_mudos IS NULL OR NOT (u = ANY (v_mudos)));
    ELSIF v_mudos IS NOT NULL THEN
      v_pessoas := ARRAY(SELECT m.user_id FROM public.organization_members m
                          WHERE m.organization_id = v_canal.organization_id AND m.is_active
                            AND NOT (m.user_id = ANY (v_mudos)));
    END IF;

    -- NULL = the whole organization (nobody muted and no assignees), as before.
    IF v_pessoas IS NOT NULL THEN
      IF cardinality(v_pessoas) = 0 THEN RETURN NEW; END IF;
      v_destino := v_destino || jsonb_build_object('user_ids', to_jsonb(v_pessoas));
    END IF;

    SELECT decrypted_secret INTO v_chave
      FROM vault.decrypted_secrets WHERE name = 'service_role_key';

    IF v_chave IS NULL THEN
      RAISE WARNING 'notificar_email_novo: service_role_key não está no Vault';
      RETURN NEW;
    END IF;

    PERFORM extensions.net.http_post(
      url := 'https://chhmfwlimtbsyjmgtokn.supabase.co/functions/v1/send-push-notification',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_chave
      ),
      body := v_destino
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notificar_email_novo: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
