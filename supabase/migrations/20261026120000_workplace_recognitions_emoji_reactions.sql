-- Workplace Feed: recognitions and emoji reactions. Additive; existing likes become ❤️.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- 1. A recognition is a post kind, so it reuses comments, reactions, realtime and the timeline.
ALTER TABLE public.workplace_posts
  ADD COLUMN recipient_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  ADD COLUMN recognition_type text;
ALTER TABLE public.workplace_posts
  DROP CONSTRAINT workplace_posts_kind_check,
  ADD CONSTRAINT workplace_posts_kind_check CHECK (kind IN ('publication', 'announcement', 'recognition')),
  ADD CONSTRAINT workplace_posts_recognition_shape CHECK (CASE WHEN kind = 'recognition'
    THEN recipient_id IS NOT NULL AND recipient_id <> author_id
      AND recognition_type IN ('great_work', 'team_spirit', 'creativity', 'leadership', 'helpful',
                               'professional', 'innovation', 'dedication', 'congrats', 'thanks')
      AND char_length(btrim(body)) BETWEEN 30 AND 1000
    ELSE recipient_id IS NULL AND recognition_type IS NULL END);

CREATE INDEX workplace_posts_recipient ON public.workplace_posts (organization_id, recipient_id, created_at DESC)
  WHERE kind = 'recognition';
CREATE INDEX workplace_posts_recognition_sender ON public.workplace_posts (organization_id, author_id, created_at DESC)
  WHERE kind = 'recognition';

-- Members may recognise; announcements and pinning stay admin-only.
DROP POLICY workplace_post_insert ON public.workplace_posts;
CREATE POLICY workplace_post_insert ON public.workplace_posts FOR INSERT TO authenticated
  WITH CHECK (author_id = (SELECT auth.uid()) AND ((kind IN ('publication', 'recognition') AND NOT pinned)
    OR public.is_org_admin((SELECT auth.uid()), organization_id)));

-- The recipient must be an active member; anti-spam limits apply per organization.
CREATE FUNCTION public.guard_workplace_recognition_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NEW.kind <> 'recognition' OR current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  NEW.created_at := now();
  IF NOT public.is_org_member(NEW.recipient_id, NEW.organization_id) THEN
    RAISE EXCEPTION 'Recognition recipient must be an active organization member' USING ERRCODE = '42501';
  END IF;
  IF (SELECT count(*) FROM public.workplace_posts p
      WHERE p.organization_id = NEW.organization_id AND p.author_id = NEW.author_id
        AND p.kind = 'recognition' AND p.created_at > now() - interval '24 hours') >= 3 THEN
    RAISE EXCEPTION 'workplace_recognition_daily_limit' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM public.workplace_posts p
      WHERE p.organization_id = NEW.organization_id AND p.author_id = NEW.author_id
        AND p.recipient_id = NEW.recipient_id AND p.kind = 'recognition'
        AND p.created_at > now() - interval '24 hours') THEN
    RAISE EXCEPTION 'workplace_recognition_recipient_limit' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_workplace_recognition_insert() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER workplace_recognition_insert_guard BEFORE INSERT ON public.workplace_posts
  FOR EACH ROW EXECUTE FUNCTION public.guard_workplace_recognition_insert();

-- Who was recognised, and for what, never changes after publication.
CREATE OR REPLACE FUNCTION public.guard_workplace_post_update()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.author_id IS DISTINCT FROM OLD.author_id OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.recipient_id IS DISTINCT FROM OLD.recipient_id OR NEW.recognition_type IS DISTINCT FROM OLD.recognition_type THEN
    RAISE EXCEPTION 'Post identity is immutable' USING ERRCODE = '42501';
  END IF;
  IF current_user IN ('authenticated', 'anon') AND
    (OLD.kind = 'announcement' OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW.pinned IS DISTINCT FROM OLD.pinned)
    AND NOT public.is_org_admin(auth.uid(), OLD.organization_id) THEN
    RAISE EXCEPTION 'Administrator required for announcements and pinning' USING ERRCODE = '42501';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_workplace_post_update() FROM PUBLIC, anon, authenticated;

-- 2. Emoji reactions: one row per person per emoji. The default keeps older clients liking with ❤️.
ALTER TABLE public.workplace_reactions
  ADD COLUMN emoji text NOT NULL DEFAULT '❤️'
    CHECK (emoji IN ('👍', '❤️', '👏', '🎉', '😂', '😮', '😢', '🙏'));
ALTER TABLE public.workplace_reactions
  DROP CONSTRAINT workplace_reactions_pkey,
  ADD PRIMARY KEY (post_id, user_id, emoji);

NOTIFY pgrst, 'reload schema';
COMMIT;
