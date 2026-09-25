-- Link automatically recorded Stripe fees to their invoice for idempotency.
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS stripe_invoice_id text;

CREATE UNIQUE INDEX IF NOT EXISTS expenses_org_stripe_invoice_id_key
  ON public.expenses (organization_id, stripe_invoice_id);
