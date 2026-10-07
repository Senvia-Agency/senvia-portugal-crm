-- A chargeback is booked in the commission month selected at confirmation.
-- Creation time and the original sale date remain audit fields, not accounting periods.
ALTER TABLE public.sale_chargebacks
  ADD COLUMN IF NOT EXISTS application_month date,
  ADD COLUMN IF NOT EXISTS applied_at timestamptz;

ALTER TABLE public.bds_manual_chargebacks
  ADD COLUMN IF NOT EXISTS application_month date,
  ADD COLUMN IF NOT EXISTS applied_at timestamptz;

-- Preserve a meaningful period for chargebacks confirmed before this feature.
UPDATE public.sale_chargebacks
SET application_month = date_trunc('month', created_at AT TIME ZONE 'Europe/Lisbon')::date
WHERE status = 'reconciled' AND application_month IS NULL;

UPDATE public.bds_manual_chargebacks
SET application_month = date_trunc('month', created_at AT TIME ZONE 'Europe/Lisbon')::date
WHERE status = 'reconciled' AND application_month IS NULL;

ALTER TABLE public.sale_chargebacks
  ADD CONSTRAINT sale_chargebacks_application_month_check
  CHECK (
    (application_month IS NULL OR EXTRACT(DAY FROM application_month) = 1)
    AND (status <> 'reconciled' OR application_month IS NOT NULL)
    AND (status = 'reconciled' OR applied_at IS NULL)
  );

ALTER TABLE public.bds_manual_chargebacks
  ADD CONSTRAINT bds_manual_chargebacks_application_month_check
  CHECK (
    (application_month IS NULL OR EXTRACT(DAY FROM application_month) = 1)
    AND (status <> 'reconciled' OR application_month IS NOT NULL)
    AND (status = 'reconciled' OR applied_at IS NULL)
  );

CREATE INDEX IF NOT EXISTS sale_chargebacks_org_month_idx
  ON public.sale_chargebacks (organization_id, application_month, status);
CREATE INDEX IF NOT EXISTS bds_manual_chargebacks_org_month_idx
  ON public.bds_manual_chargebacks (organization_id, application_month, status);
