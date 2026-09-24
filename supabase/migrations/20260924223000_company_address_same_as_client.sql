-- Sharing the contact's address for company invoices requires an explicit choice.
-- Existing clients default to a separate company address.
ALTER TABLE public.crm_clients
  ADD COLUMN IF NOT EXISTS company_address_same_as_client boolean NOT NULL DEFAULT false;
