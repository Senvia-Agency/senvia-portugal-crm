-- Keep a free-text customer snapshot for manual historical chargebacks.
ALTER TABLE public.bds_manual_chargebacks
  ADD COLUMN IF NOT EXISTS client_name text;

COMMENT ON COLUMN public.bds_manual_chargebacks.client_name IS
  'Optional customer name entered on a manual chargeback; does not create a CRM client.';
