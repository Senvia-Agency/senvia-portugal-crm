BEGIN;

ALTER TABLE public.email_campaigns
  ADD COLUMN IF NOT EXISTS approved_subject text,
  ADD COLUMN IF NOT EXISTS approved_html_content text,
  ADD COLUMN IF NOT EXISTS approved_settings jsonb,
  ADD COLUMN IF NOT EXISTS approved_settings_data jsonb,
  ADD COLUMN IF NOT EXISTS approved_content_digest text,
  ADD COLUMN IF NOT EXISTS approved_at timestamp with time zone;

ALTER TABLE public.email_campaigns
  DROP CONSTRAINT IF EXISTS email_campaigns_approved_content_digest_format;

ALTER TABLE public.email_campaigns
  ADD CONSTRAINT email_campaigns_approved_content_digest_format
  CHECK (
    approved_content_digest IS NULL
    OR approved_content_digest ~ '^[0-9a-f]{64}$'
  );

ALTER TABLE public.email_sends
  ADD COLUMN IF NOT EXISTS marketing_contact_id uuid
    REFERENCES public.marketing_contacts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_email_sends_marketing_contact_id
  ON public.email_sends(marketing_contact_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_email_sends_one_queued_campaign_contact
  ON public.email_sends(campaign_id, marketing_contact_id)
  WHERE campaign_id IS NOT NULL
    AND marketing_contact_id IS NOT NULL
    AND status = 'queued';

ALTER TABLE public.email_sends DROP CONSTRAINT IF EXISTS email_sends_status_check;
ALTER TABLE public.email_sends ADD CONSTRAINT email_sends_status_check
  CHECK (status IN ('queued', 'sending', 'sent', 'delivered', 'opened', 'clicked', 'failed', 'bounced', 'blocked', 'spam', 'unsubscribed'));

COMMIT;
