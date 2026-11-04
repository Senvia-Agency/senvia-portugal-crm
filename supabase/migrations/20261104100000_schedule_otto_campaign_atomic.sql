BEGIN;

CREATE OR REPLACE FUNCTION public.schedule_otto_campaign_atomic(
  p_organization_id uuid,
  p_campaign_id uuid,
  p_expected_updated_at timestamptz,
  p_scheduled_at timestamptz,
  p_snapshot jsonb,
  p_recipients jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_campaign public.email_campaigns%ROWTYPE;
  v_count integer;
BEGIN
  -- Internal adapter only: Otto performs caller/module/grant/confirmation checks.
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_campaign FROM public.email_campaigns
    WHERE id = p_campaign_id AND organization_id = p_organization_id FOR UPDATE;
  IF NOT FOUND OR v_campaign.status IS DISTINCT FROM 'draft'
    OR v_campaign.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'campaign_changed' USING ERRCODE = '40001';
  END IF;
  IF p_scheduled_at IS NULL OR p_snapshot IS NULL
    OR pg_catalog.jsonb_typeof(p_snapshot) IS DISTINCT FROM 'object'
    OR pg_catalog.jsonb_typeof(p_recipients) IS DISTINCT FROM 'array'
    OR pg_catalog.jsonb_array_length(p_recipients) NOT BETWEEN 1 AND 500
    OR coalesce(p_snapshot->>'subject', '') = ''
    OR coalesce(p_snapshot->>'html_content', '') = ''
    OR coalesce(p_snapshot->>'digest', '') !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'campaign_payload_invalid' USING ERRCODE = '22023';
  END IF;
  v_count := pg_catalog.jsonb_array_length(p_recipients);
  IF EXISTS (
    SELECT 1 FROM pg_catalog.jsonb_array_elements(p_recipients) AS recipient(item)
    LEFT JOIN public.marketing_contacts AS contact
      ON contact.id = (recipient.item->>'id')::uuid
      AND contact.organization_id = p_organization_id
    WHERE contact.id IS NULL OR contact.subscribed IS DISTINCT FROM true
      OR pg_catalog.lower(pg_catalog.btrim(contact.email)) IS DISTINCT FROM
         pg_catalog.lower(pg_catalog.btrim(recipient.item->>'email'))
  ) OR (SELECT pg_catalog.count(DISTINCT item->>'id')
    FROM pg_catalog.jsonb_array_elements(p_recipients) AS recipient(item)) <> v_count
  THEN RAISE EXCEPTION 'campaign_audience_changed' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.email_sends
    WHERE campaign_id = p_campaign_id AND organization_id = p_organization_id AND status = 'queued') THEN
    RAISE EXCEPTION 'campaign_already_queued' USING ERRCODE = '40001';
  END IF;
  INSERT INTO public.email_sends (
    organization_id, campaign_id, template_id, marketing_contact_id,
    recipient_email, recipient_name, subject, status
  ) SELECT p_organization_id, p_campaign_id, v_campaign.template_id,
      (item->>'id')::uuid, item->>'email', item->>'name', p_snapshot->>'subject', 'queued'
    FROM pg_catalog.jsonb_array_elements(p_recipients) AS recipient(item);
  UPDATE public.email_campaigns SET
    status = 'scheduled', scheduled_at = p_scheduled_at, total_recipients = v_count,
    sent_count = 0, failed_count = 0, sent_at = NULL,
    approved_subject = p_snapshot->>'subject', approved_html_content = p_snapshot->>'html_content',
    approved_settings = p_snapshot->'settings', approved_settings_data = p_snapshot->'settings_data',
    approved_content_digest = p_snapshot->>'digest', approved_at = pg_catalog.now()
    WHERE id = p_campaign_id AND organization_id = p_organization_id;
  RETURN p_campaign_id;
END;
$$;
REVOKE ALL ON FUNCTION public.schedule_otto_campaign_atomic(uuid,uuid,timestamptz,timestamptz,jsonb,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_otto_campaign_atomic(uuid,uuid,timestamptz,timestamptz,jsonb,jsonb) TO service_role;
COMMIT;
