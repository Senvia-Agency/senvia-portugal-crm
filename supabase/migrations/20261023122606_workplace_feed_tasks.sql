BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE public.workplace_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 6000),
  kind text NOT NULL DEFAULT 'publication' CHECK (kind IN ('publication', 'announcement')),
  pinned boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organization_id)
);
CREATE TABLE public.workplace_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  post_id uuid NOT NULL,
  author_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (post_id, organization_id) REFERENCES public.workplace_posts(id, organization_id) ON DELETE CASCADE
);
CREATE TABLE public.workplace_reactions (
  post_id uuid NOT NULL,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id),
  FOREIGN KEY (post_id, organization_id) REFERENCES public.workplace_posts(id, organization_id) ON DELETE CASCADE
);
CREATE INDEX workplace_posts_org_created ON public.workplace_posts (organization_id, created_at DESC);
CREATE INDEX workplace_posts_author ON public.workplace_posts (author_id);
CREATE INDEX workplace_comments_org_post_created ON public.workplace_comments (organization_id, post_id, created_at);
CREATE INDEX workplace_comments_author ON public.workplace_comments (author_id);
CREATE INDEX workplace_reactions_org_post ON public.workplace_reactions (organization_id, post_id);
CREATE INDEX workplace_reactions_user ON public.workplace_reactions (user_id);

ALTER TABLE public.workplace_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workplace_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workplace_reactions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workplace_posts, public.workplace_comments, public.workplace_reactions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.workplace_posts TO authenticated;
GRANT SELECT, INSERT ON public.workplace_comments TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.workplace_reactions TO authenticated;
GRANT ALL ON public.workplace_posts, public.workplace_comments, public.workplace_reactions TO service_role;

-- Separate restrictive membership/MFA policies protect every permitted operation.
DO $$
DECLARE target text;
BEGIN
  FOREACH target IN ARRAY ARRAY['workplace_posts', 'workplace_comments', 'workplace_reactions'] LOOP
    EXECUTE format('CREATE POLICY workplace_scope ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (public.meets_mfa_policy((SELECT auth.uid())) AND (public.is_org_member((SELECT auth.uid()), organization_id) OR public.has_role((SELECT auth.uid()), ''super_admin''::public.app_role))) WITH CHECK (public.meets_mfa_policy((SELECT auth.uid())) AND (public.is_org_member((SELECT auth.uid()), organization_id) OR public.has_role((SELECT auth.uid()), ''super_admin''::public.app_role)))', target);
    EXECUTE format('CREATE POLICY workplace_read ON public.%I FOR SELECT TO authenticated USING (true)', target);
  END LOOP;
END $$;
CREATE POLICY workplace_post_insert ON public.workplace_posts FOR INSERT TO authenticated
  WITH CHECK (author_id = (SELECT auth.uid()) AND ((kind = 'publication' AND NOT pinned) OR public.is_org_admin((SELECT auth.uid()), organization_id)));
CREATE POLICY workplace_post_update ON public.workplace_posts FOR UPDATE TO authenticated
  USING (author_id = (SELECT auth.uid()) OR public.is_org_admin((SELECT auth.uid()), organization_id))
  WITH CHECK (author_id = (SELECT auth.uid()) OR public.is_org_admin((SELECT auth.uid()), organization_id));
CREATE POLICY workplace_comment_insert ON public.workplace_comments FOR INSERT TO authenticated
  WITH CHECK (author_id = (SELECT auth.uid()));
CREATE POLICY workplace_reaction_insert ON public.workplace_reactions FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY workplace_reaction_delete ON public.workplace_reactions FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE FUNCTION public.guard_workplace_post_update()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.author_id IS DISTINCT FROM OLD.author_id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
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
CREATE TRIGGER workplace_post_update_guard BEFORE UPDATE ON public.workplace_posts
  FOR EACH ROW EXECUTE FUNCTION public.guard_workplace_post_update();

-- Fast constant defaults, no historical commission/task data rewrite.
ALTER TABLE public.inbox_tasks
  ADD COLUMN workplace_status text NOT NULL DEFAULT 'todo' CHECK (workplace_status IN ('todo', 'doing', 'done')),
  ADD COLUMN priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high')),
  ADD COLUMN workplace_version bigint NOT NULL DEFAULT 0;

CREATE FUNCTION public.sync_workplace_task_state()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  NEW.workplace_version := CASE WHEN TG_OP = 'INSERT' THEN 0 ELSE OLD.workplace_version + 1 END;
  IF current_user IN ('authenticated', 'anon') THEN
    IF TG_OP = 'UPDATE' AND (NEW.organization_id IS DISTINCT FROM OLD.organization_id
      OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.id IS DISTINCT FROM OLD.id
      OR NEW.created_at IS DISTINCT FROM OLD.created_at) THEN
      RAISE EXCEPTION 'Task identity is immutable' USING ERRCODE = '42501';
    END IF;
    IF NEW.assigned_to IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.assigned_to IS DISTINCT FROM OLD.assigned_to)
      AND NOT public.is_org_member(NEW.assigned_to, NEW.organization_id) THEN
      RAISE EXCEPTION 'Assignee must be an active organization member' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.done_at IS NOT NULL THEN NEW.workplace_status := 'done';
    ELSIF NEW.workplace_status = 'done' THEN NEW.done_at := now(); END IF;
  ELSIF NEW.workplace_status IS DISTINCT FROM OLD.workplace_status THEN
    IF NEW.workplace_status = 'done' THEN NEW.done_at := coalesce(NEW.done_at, now());
    ELSE NEW.done_at := NULL; END IF;
  ELSIF NEW.done_at IS DISTINCT FROM OLD.done_at THEN
    NEW.workplace_status := CASE WHEN NEW.done_at IS NULL THEN 'todo' ELSE 'done' END;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.sync_workplace_task_state() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER inbox_tasks_workplace_state BEFORE INSERT OR UPDATE ON public.inbox_tasks
  FOR EACH ROW EXECUTE FUNCTION public.sync_workplace_task_state();

DO $$
DECLARE target text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    FOREACH target IN ARRAY ARRAY['workplace_posts', 'workplace_comments', 'workplace_reactions', 'inbox_tasks'] LOOP
      IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = target) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', target);
      END IF;
    END LOOP;
  END IF;
END $$;
NOTIFY pgrst, 'reload schema';
COMMIT;
