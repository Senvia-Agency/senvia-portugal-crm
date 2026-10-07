ALTER TABLE public.organizations
  ADD COLUMN public_lead_verification_enabled boolean NOT NULL DEFAULT false;

UPDATE public.organizations
SET public_lead_verification_enabled = true
WHERE slug = 'senvia-agency';

CREATE TABLE public.lead_verification_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  form_id uuid REFERENCES public.forms(id) ON DELETE SET NULL,
  email_token_hash text UNIQUE,
  whatsapp_code_hash text UNIQUE,
  phone_digits text,
  payload jsonb,
  email_verified_at timestamptz,
  whatsapp_verified_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  created_at timestamptz NOT NULL DEFAULT now(),
  finalized_lead_id uuid
);

ALTER TABLE public.leads
  ADD COLUMN lead_verification_id uuid UNIQUE
    REFERENCES public.lead_verification_challenges(id) ON DELETE SET NULL;

ALTER TABLE public.lead_verification_challenges
  ADD CONSTRAINT lead_verification_finalized_lead_fk
  FOREIGN KEY (finalized_lead_id) REFERENCES public.leads(id) ON DELETE SET NULL;

CREATE INDEX lead_verification_challenges_expiry_idx
  ON public.lead_verification_challenges (expires_at);

CREATE INDEX lead_verification_challenges_phone_idx
  ON public.lead_verification_challenges (organization_id, phone_digits, expires_at)
  WHERE whatsapp_verified_at IS NULL;

ALTER TABLE public.lead_verification_challenges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.lead_verification_challenges FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lead_verification_challenges TO service_role;

COMMENT ON TABLE public.lead_verification_challenges IS
  'Contact details submitted by Senvia Agency conversational forms; no lead is created until email and WhatsApp ownership are confirmed.';

COMMENT ON COLUMN public.lead_verification_challenges.payload IS
  'Short-lived contact data for an unverified submission. Cleared as soon as a verified lead is created.';
