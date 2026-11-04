-- Programa de avaliações em vídeo.
--
-- An organization sends a video (30 s or more) saying how Senvia OS helped it. Senvia approves the
-- video; the organization then posts it on Instagram tagging @senvia_agency and sends the post link;
-- Senvia checks the post, and only then does the 25% discount reach the next monthly invoice (Stripe,
-- applied by the edge function review-video). One review per organization.
--
-- Status: pending → video_approved → post_submitted → approved   (rejected from any step, with a reason;
-- a rejected one can be sent again).
--
-- Clients never write the table: the organization's admins go through the two RPCs below, and Senvia
-- reviews through the edge function (service role).

BEGIN;

CREATE TABLE public.review_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  submitted_by uuid NOT NULL,
  video_path text NOT NULL,
  duration_seconds numeric(8, 2) NOT NULL CHECK (duration_seconds >= 30),
  consent_publish boolean NOT NULL CHECK (consent_publish),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'video_approved', 'post_submitted', 'approved', 'rejected')),
  instagram_url text CHECK (instagram_url ~ '^https://(www\.)?instagram\.com/(p|reel|reels|tv)/[A-Za-z0-9_-]+'),
  post_submitted_at timestamptz,
  video_reviewed_by uuid,
  video_reviewed_at timestamptz,
  post_reviewed_by uuid,
  post_reviewed_at timestamptz,
  reject_reason text CHECK (char_length(reject_reason) <= 500),
  discount_percent smallint NOT NULL DEFAULT 25 CHECK (discount_percent BETWEEN 1 AND 100),
  stripe_coupon_id text,
  applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- One live review per organization: pending, waiting for the post, or already rewarded.
CREATE UNIQUE INDEX review_submissions_one_active_idx ON public.review_submissions (organization_id)
  WHERE status IN ('pending', 'video_approved', 'post_submitted', 'approved');
CREATE INDEX review_submissions_status_idx ON public.review_submissions (status, created_at DESC);

ALTER TABLE public.review_submissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.review_submissions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.review_submissions TO authenticated;
GRANT ALL ON public.review_submissions TO service_role;

CREATE POLICY "Members read their organization reviews" ON public.review_submissions FOR SELECT TO authenticated
USING (public.is_org_member((SELECT auth.uid()), organization_id));

-- Sends a new review: the video is already in the bucket, under <organization>/.
CREATE FUNCTION public.submit_review_video(_organization_id uuid, _video_path text, _duration_seconds numeric, _consent boolean)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_me uuid := auth.uid(); v_id uuid;
BEGIN
  IF v_me IS NULL OR NOT public.is_org_admin(v_me, _organization_id) THEN
    RAISE EXCEPTION 'review_forbidden' USING ERRCODE = '42501';
  END IF;
  IF _consent IS NOT TRUE THEN RAISE EXCEPTION 'review_consent_required'; END IF;
  IF _duration_seconds IS NULL OR _duration_seconds < 30 THEN RAISE EXCEPTION 'review_too_short'; END IF;
  IF _video_path IS NULL OR split_part(_video_path, '/', 1) <> _organization_id::text THEN RAISE EXCEPTION 'review_bad_path'; END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'review-videos' AND o.name = _video_path) THEN
    RAISE EXCEPTION 'review_video_missing';
  END IF;
  IF EXISTS (SELECT 1 FROM public.review_submissions r WHERE r.organization_id = _organization_id
             AND r.status IN ('pending', 'video_approved', 'post_submitted', 'approved')) THEN
    RAISE EXCEPTION 'review_already_active';
  END IF;
  INSERT INTO public.review_submissions (organization_id, submitted_by, video_path, duration_seconds, consent_publish)
  VALUES (_organization_id, v_me, _video_path, _duration_seconds, true) RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- After Senvia approved the video: the organization sends the link of its Instagram post.
CREATE FUNCTION public.submit_review_post(_review_id uuid, _instagram_url text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_me uuid := auth.uid(); v_org uuid; v_status text; v_url text := btrim(coalesce(_instagram_url, ''));
BEGIN
  SELECT r.organization_id, r.status INTO v_org, v_status FROM public.review_submissions r WHERE r.id = _review_id FOR UPDATE;
  IF v_org IS NULL THEN RAISE EXCEPTION 'review_not_found'; END IF;
  IF v_me IS NULL OR NOT public.is_org_admin(v_me, v_org) THEN
    RAISE EXCEPTION 'review_forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_status NOT IN ('video_approved', 'post_submitted') THEN RAISE EXCEPTION 'review_wrong_status'; END IF;
  IF v_url !~ '^https://(www\.)?instagram\.com/(p|reel|reels|tv)/[A-Za-z0-9_-]+' THEN RAISE EXCEPTION 'review_bad_link'; END IF;
  UPDATE public.review_submissions
  SET instagram_url = v_url, status = 'post_submitted', post_submitted_at = now(), reject_reason = NULL
  WHERE id = _review_id;
END $$;

REVOKE ALL ON FUNCTION public.submit_review_video(uuid, text, numeric, boolean), public.submit_review_post(uuid, text)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_review_video(uuid, text, numeric, boolean), public.submit_review_post(uuid, text) TO authenticated;

-- Private bucket for the videos: <organization id>/<file>.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('review-videos', 'review-videos', false, 209715200, ARRAY['video/mp4', 'video/quicktime', 'video/webm'])
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Review videos: org admins upload" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'review-videos' AND CASE
  WHEN (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  THEN public.is_org_admin((SELECT auth.uid()), ((storage.foldername(name))[1])::uuid) ELSE false END);

CREATE POLICY "Review videos: org admins read" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'review-videos' AND CASE
  WHEN (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  THEN public.is_org_admin((SELECT auth.uid()), ((storage.foldername(name))[1])::uuid) ELSE false END);

COMMIT;

NOTIFY pgrst, 'reload schema';
