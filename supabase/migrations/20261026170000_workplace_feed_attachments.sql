-- Workplace Feed: photos and documents on publications (up to 4 per post, 15 MB each), private storage.
-- Additive: existing posts keep an empty attachment list.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- [{ path, name, size, mime }]; files live in the private bucket under "<post>/<file>".
ALTER TABLE public.workplace_posts
  ADD COLUMN attachments jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(attachments) = 'array' AND jsonb_array_length(attachments) <= 4);

/** Post visible to the caller: same organization (or super admin) and MFA-compliant. */
CREATE FUNCTION public.workplace_feed_can_see(_post_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workplace_posts p
    WHERE p.id = _post_id
      AND public.meets_mfa_policy((SELECT auth.uid()))
      AND (public.is_org_member((SELECT auth.uid()), p.organization_id) OR public.has_role((SELECT auth.uid()), 'super_admin'::public.app_role))
  );
$$;

/** The caller wrote the post and still belongs to its organization. */
CREATE FUNCTION public.workplace_feed_is_author(_post_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workplace_posts p
    WHERE p.id = _post_id AND p.author_id = (SELECT auth.uid())
      AND public.meets_mfa_policy((SELECT auth.uid()))
      AND public.is_org_member((SELECT auth.uid()), p.organization_id)
  );
$$;

/** Post that owns a file in the bucket ("<post>/<file>"). */
CREATE FUNCTION public.workplace_feed_path_post(_name text)
RETURNS uuid LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
  RETURN split_part(_name, '/', 1)::uuid;
EXCEPTION WHEN invalid_text_representation THEN
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION public.workplace_feed_can_see(uuid), public.workplace_feed_is_author(uuid), public.workplace_feed_path_post(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.workplace_feed_can_see(uuid), public.workplace_feed_is_author(uuid), public.workplace_feed_path_post(text) TO authenticated;

-- Every attachment must describe a file of this post, within the bucket limits.
CREATE FUNCTION public.guard_workplace_post_attachments()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE item jsonb;
BEGIN
  FOR item IN SELECT value FROM jsonb_array_elements(NEW.attachments) LOOP
    IF jsonb_typeof(item) <> 'object'
      OR coalesce(item->>'path', '') NOT LIKE NEW.id::text || '/%'
      OR char_length(coalesce(item->>'name', '')) NOT BETWEEN 1 AND 255
      OR jsonb_typeof(item->'size') <> 'number' OR (item->>'size')::numeric NOT BETWEEN 0 AND 15728640
      OR coalesce(item->>'mime', '') = '' THEN
      RAISE EXCEPTION 'workplace_feed_invalid_attachment' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_workplace_post_attachments() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER workplace_post_attachments_guard BEFORE INSERT OR UPDATE OF attachments ON public.workplace_posts
  FOR EACH ROW EXECUTE FUNCTION public.guard_workplace_post_attachments();

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'workplace-feed-files', 'workplace-feed-files', false, 15728640,
  ARRAY[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'application/pdf',
    'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ]
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Workplace feed: members read files" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'workplace-feed-files' AND public.workplace_feed_can_see(public.workplace_feed_path_post(name)));
CREATE POLICY "Workplace feed: author uploads files" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'workplace-feed-files' AND public.workplace_feed_is_author(public.workplace_feed_path_post(name)));
CREATE POLICY "Workplace feed: uploader deletes file" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'workplace-feed-files' AND owner_id = (SELECT auth.uid())::text);

NOTIFY pgrst, 'reload schema';
COMMIT;
