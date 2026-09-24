-- A company linked to a contact has its own fiscal address. Never infer it
-- from the contact's personal address.
ALTER TABLE public.crm_clients
  ADD COLUMN IF NOT EXISTS company_address_line1 text,
  ADD COLUMN IF NOT EXISTS company_address_line2 text,
  ADD COLUMN IF NOT EXISTS company_city text,
  ADD COLUMN IF NOT EXISTS company_postal_code text,
  ADD COLUMN IF NOT EXISTS company_country text;
