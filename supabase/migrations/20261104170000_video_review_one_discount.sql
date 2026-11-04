-- Avaliação em vídeo: a rejected video can be sent again; an approved one earns the discount once.
--
-- Replaces 20261104160000 (one video per organization, ever), which was stricter than wanted.
-- Rule: an organization has at most one LIVE review — waiting for Senvia, waiting for the Instagram
-- post, or already rewarded. A rejected review does not count, so the organization may send another;
-- once one is approved, no further review can be opened: the discount is given once.

BEGIN;

DROP INDEX IF EXISTS public.review_submissions_one_per_org_idx;
CREATE UNIQUE INDEX review_submissions_one_active_idx ON public.review_submissions (organization_id)
  WHERE status IN ('pending', 'video_approved', 'post_submitted', 'approved');

CREATE OR REPLACE FUNCTION public.submit_review_video(_organization_id uuid, _video_path text, _duration_seconds numeric, _consent boolean)
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
  -- Already rewarded: the discount is given once.
  IF EXISTS (SELECT 1 FROM public.review_submissions r WHERE r.organization_id = _organization_id AND r.status = 'approved') THEN
    RAISE EXCEPTION 'review_already_rewarded';
  END IF;
  -- One at a time: wait for the one in progress. A rejected one does not block.
  IF EXISTS (SELECT 1 FROM public.review_submissions r WHERE r.organization_id = _organization_id
             AND r.status IN ('pending', 'video_approved', 'post_submitted')) THEN
    RAISE EXCEPTION 'review_already_active';
  END IF;
  INSERT INTO public.review_submissions (organization_id, submitted_by, video_path, duration_seconds, consent_publish)
  VALUES (_organization_id, v_me, _video_path, _duration_seconds, true) RETURNING id INTO v_id;
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.submit_review_video(uuid, text, numeric, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_review_video(uuid, text, numeric, boolean) TO authenticated;

COMMIT;
