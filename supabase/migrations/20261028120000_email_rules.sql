-- Email rules per caixa (WebMail).
-- Each rule belongs to one caixa: whoever can open the caixa (pode_aceder_caixa) sees and edits its
-- rules, the same people who already send, move and archive its mail. The email gateway applies the
-- enabled rules, in order, to every new message that reaches the Inbox; mail already there is never
-- touched. Deleting a rule never changes any email.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- 1. Shape of conditions and actions ---------------------------------------------------------
-- conditions: [{ "field": "from|to|cc|subject|body|has_attachments",
--                "operator": "contains|not_contains|equals|starts_with|ends_with", "value": "..." }]
--             has_attachments only takes operator "equals" with value "true" or "false".
-- actions:    [{ "type": "move", "folderId": "<email_folders.id>" } | { "type": "mark_read|flag|archive|trash|spam" }]
--             each type at most once, and at most one destination (move, archive, trash, spam).
CREATE OR REPLACE FUNCTION public.email_rule_shape_ok(_conditions jsonb, _actions jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  item jsonb;
  kinds text[] := '{}';
BEGIN
  IF jsonb_typeof(_conditions) IS DISTINCT FROM 'array' OR jsonb_array_length(_conditions) NOT BETWEEN 1 AND 10
     OR jsonb_typeof(_actions) IS DISTINCT FROM 'array' OR jsonb_array_length(_actions) NOT BETWEEN 1 AND 5 THEN
    RETURN false;
  END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(_conditions) LOOP
    IF jsonb_typeof(item) IS DISTINCT FROM 'object'
       OR COALESCE(item->>'field', '') <> ALL (ARRAY['from', 'to', 'cc', 'subject', 'body', 'has_attachments'])
       OR COALESCE(item->>'operator', '') <> ALL (ARRAY['contains', 'not_contains', 'equals', 'starts_with', 'ends_with'])
       OR jsonb_typeof(item->'value') IS DISTINCT FROM 'string'
       OR char_length(btrim(item->>'value')) NOT BETWEEN 1 AND 200 THEN
      RETURN false;
    END IF;
    IF item->>'field' = 'has_attachments'
       AND (item->>'operator' <> 'equals' OR item->>'value' NOT IN ('true', 'false')) THEN
      RETURN false;
    END IF;
  END LOOP;

  FOR item IN SELECT value FROM jsonb_array_elements(_actions) LOOP
    IF jsonb_typeof(item) IS DISTINCT FROM 'object'
       OR COALESCE(item->>'type', '') <> ALL (ARRAY['move', 'mark_read', 'flag', 'archive', 'trash', 'spam'])
       OR item->>'type' = ANY (kinds) THEN
      RETURN false;
    END IF;
    IF item->>'type' = 'move' AND COALESCE(item->>'folderId', '')
       !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
      RETURN false;
    END IF;
    kinds := kinds || (item->>'type');
  END LOOP;

  -- A message can only end up in one folder.
  RETURN (SELECT count(*) FROM unnest(kinds) AS kind WHERE kind IN ('move', 'archive', 'trash', 'spam')) <= 1;
END;
$$;

-- 2. Table ----------------------------------------------------------------------------------

CREATE TABLE public.email_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES public.messaging_channels(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  enabled boolean NOT NULL DEFAULT true,
  -- Lower runs first.
  position integer NOT NULL DEFAULT 0 CHECK (position BETWEEN 0 AND 1000),
  -- true: every condition must hold; false: any one is enough.
  match_all boolean NOT NULL DEFAULT true,
  conditions jsonb NOT NULL,
  actions jsonb NOT NULL,
  -- Rules after this one are skipped for a message this one matched.
  stop_processing boolean NOT NULL DEFAULT false,
  -- Written by the gateway each time the rule acts on a message.
  match_count integer NOT NULL DEFAULT 0 CHECK (match_count >= 0),
  last_matched_at timestamptz,
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_rules_shape CHECK (public.email_rule_shape_ok(conditions, actions))
);
-- The gateway reads a caixa's rules in order on every new message; the screen lists them the same way.
CREATE INDEX email_rules_channel_position ON public.email_rules (channel_id, position);
CREATE INDEX email_rules_organization ON public.email_rules (organization_id);

-- 3. Organization, limits and folders always follow the caixa --------------------------------

CREATE OR REPLACE FUNCTION public.email_rules_before_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  item jsonb;
BEGIN
  NEW.organization_id := (
    SELECT c.organization_id FROM public.messaging_channels c
     WHERE c.id = NEW.channel_id AND c.channel_type = 'email'
  );
  IF NEW.organization_id IS NULL THEN
    RAISE EXCEPTION 'email_channel_not_found' USING ERRCODE = '23503';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF (SELECT count(*) FROM public.email_rules r WHERE r.channel_id = NEW.channel_id) >= 50 THEN
      RAISE EXCEPTION 'email_rule_limit' USING ERRCODE = '54000';
    END IF;
    NEW.created_by := COALESCE(auth.uid(), NEW.created_by);
    NEW.created_at := now();
    NEW.match_count := 0;
    NEW.last_matched_at := NULL;
  END IF;

  -- "Mover para" only to a folder of this same caixa (never its Inbox). Checked when the actions
  -- change, so a rule whose folder was removed later can still be switched off or reordered.
  IF (TG_OP = 'INSERT' OR NEW.actions IS DISTINCT FROM OLD.actions OR NEW.channel_id IS DISTINCT FROM OLD.channel_id)
     AND jsonb_typeof(NEW.actions) = 'array' THEN
    FOR item IN SELECT value FROM jsonb_array_elements(NEW.actions) LOOP
      IF item->>'type' = 'move'
         AND COALESCE(item->>'folderId', '') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
         AND NOT EXISTS (
           SELECT 1 FROM public.email_folders f
            WHERE f.id = (item->>'folderId')::uuid AND f.channel_id = NEW.channel_id AND f.role <> 'inbox'
         ) THEN
        RAISE EXCEPTION 'email_rule_folder' USING ERRCODE = '23503';
      END IF;
    END LOOP;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.email_rules_before_write() FROM PUBLIC;

-- Not fired by the gateway's match_count / last_matched_at updates.
CREATE TRIGGER email_rules_before_write
  BEFORE INSERT OR UPDATE OF channel_id, name, enabled, position, match_all, conditions, actions, stop_processing
  ON public.email_rules
  FOR EACH ROW EXECUTE FUNCTION public.email_rules_before_write();

-- 4. Row level security ---------------------------------------------------------------------

ALTER TABLE public.email_rules ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.email_rules FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.email_rules TO authenticated;
-- A rule stays in its caixa; its counters and author are not edited by hand.
GRANT UPDATE (name, enabled, position, match_all, conditions, actions, stop_processing) ON public.email_rules TO authenticated;
GRANT ALL ON public.email_rules TO service_role;

CREATE POLICY email_rules_caixa ON public.email_rules FOR ALL TO authenticated
  USING (public.pode_aceder_caixa((SELECT auth.uid()), channel_id))
  WITH CHECK (public.pode_aceder_caixa((SELECT auth.uid()), channel_id));

-- 5. Order in one step (runs as the caller: the policy above still applies) -----------------

CREATE OR REPLACE FUNCTION public.email_reorder_rules(_channel_id uuid, _ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
BEGIN
  IF me IS NULL OR NOT public.pode_aceder_caixa(me, _channel_id) THEN
    RAISE EXCEPTION 'email_rule_forbidden' USING ERRCODE = '42501';
  END IF;
  IF cardinality(_ids) > 50 THEN
    RAISE EXCEPTION 'email_rule_invalid' USING ERRCODE = '22023';
  END IF;
  UPDATE public.email_rules r
     SET position = o.ord - 1
    FROM unnest(_ids) WITH ORDINALITY AS o(id, ord)
   WHERE r.id = o.id AND r.channel_id = _channel_id AND r.position IS DISTINCT FROM o.ord - 1;
END;
$$;
REVOKE ALL ON FUNCTION public.email_reorder_rules(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.email_reorder_rules(uuid, uuid[]) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;

-- Check (expected: 1 | 3 | 1 | 1)
-- SELECT
--   (SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tablename = 'email_rules') AS tabela,
--   (SELECT count(*) FROM pg_proc WHERE proname IN ('email_rule_shape_ok', 'email_rules_before_write', 'email_reorder_rules')) AS funcoes,
--   (SELECT count(*) FROM pg_trigger WHERE tgname = 'email_rules_before_write') AS trigger,
--   (SELECT count(*) FROM pg_policies WHERE tablename = 'email_rules') AS politica;
