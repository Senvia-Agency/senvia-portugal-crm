-- Billing details of an organization (the customer Senvia invoices through Stripe).
--
-- Members never read these columns: authenticated only has column-level SELECT on
-- organizations, and none is granted here. Admins read and save them through the
-- edge function billing-details, which also updates the Stripe customer (name,
-- address, invoice email and the NIF as an EU VAT id).

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS billing_name text CHECK (char_length(billing_name) <= 200),
  ADD COLUMN IF NOT EXISTS billing_nif text CHECK (billing_nif ~ '^[A-Z0-9]{2,15}$'),
  ADD COLUMN IF NOT EXISTS billing_address_line1 text CHECK (char_length(billing_address_line1) <= 200),
  ADD COLUMN IF NOT EXISTS billing_address_line2 text CHECK (char_length(billing_address_line2) <= 200),
  ADD COLUMN IF NOT EXISTS billing_postal_code text CHECK (char_length(billing_postal_code) <= 20),
  ADD COLUMN IF NOT EXISTS billing_city text CHECK (char_length(billing_city) <= 100),
  ADD COLUMN IF NOT EXISTS billing_country text NOT NULL DEFAULT 'PT' CHECK (billing_country ~ '^[A-Z]{2}$'),
  ADD COLUMN IF NOT EXISTS billing_email text CHECK (char_length(billing_email) <= 254),
  ADD COLUMN IF NOT EXISTS billing_synced_at timestamptz;

COMMENT ON COLUMN public.organizations.billing_nif IS 'NIF/VAT number without the country prefix (PT: 9 digits).';
COMMENT ON COLUMN public.organizations.billing_synced_at IS 'Last time these details reached the Stripe customer.';

NOTIFY pgrst, 'reload schema';
