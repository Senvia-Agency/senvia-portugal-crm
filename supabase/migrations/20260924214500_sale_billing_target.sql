-- A sale can invoice the person or the company on its client record.
-- NULL retains the client-level setting for sales created before this field.
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS billing_target text;

ALTER TABLE public.sales
  DROP CONSTRAINT IF EXISTS sales_billing_target_check;

ALTER TABLE public.sales
  ADD CONSTRAINT sales_billing_target_check
  CHECK (billing_target IS NULL OR billing_target IN ('client', 'company'));
