BEGIN;

ALTER TABLE public.operators ADD COLUMN IF NOT EXISTS commission_payment_month_offset integer NOT NULL DEFAULT 0
  CHECK (commission_payment_month_offset BETWEEN 0 AND 24);
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS commission_payment_month_offset integer NOT NULL DEFAULT 0
  CHECK (commission_payment_month_offset BETWEEN 0 AND 24);
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS commission_expected_date date;

COMMENT ON COLUMN public.operators.commission_payment_month_offset IS
  'Calendar-month offset from actual activation/installation. Zero preserves immediate recognition. M+2 means September activations are expected in November, not a fixed number of days.';
COMMENT ON COLUMN public.sales.commission_expected_date IS
  'For deferred telecom commissions, first day of the expected payment MONTH; not an exact payment day or proof of payment. NULL until activation/installation is known.';

CREATE OR REPLACE FUNCTION public.set_sale_commission_payment_month()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  month_offset integer;
  reference_date date;
BEGIN
  -- Match only frozen operator IDs belonging to this sale's organization.
  -- A multi-operator sale is due once its latest operator payment is due.
  SELECT coalesce(max(o.commission_payment_month_offset), 0) INTO month_offset
  FROM jsonb_each(CASE WHEN jsonb_typeof(NEW.servicos_details) = 'object'
    THEN NEW.servicos_details ELSE '{}'::jsonb END) line
  JOIN public.operators o ON o.id::text = line.value->>'operator_id'
    AND o.organization_id = NEW.organization_id;

  NEW.commission_payment_month_offset := month_offset;
  reference_date := NEW.activation_date;
  IF NEW.telecom_status = 'instalado' THEN
    reference_date := coalesce(reference_date, (NEW.scheduled_install_date AT TIME ZONE 'Europe/Lisbon')::date);
  END IF;
  NEW.commission_expected_date := CASE
    WHEN month_offset = 0 THEN coalesce(reference_date, NEW.sale_date)
    WHEN NEW.telecom_status IN ('ativo', 'instalado') AND reference_date IS NOT NULL
      THEN (date_trunc('month', reference_date) + make_interval(months => month_offset))::date
    ELSE NULL
  END;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_sale_commission_payment_month
BEFORE INSERT OR UPDATE OF organization_id, servicos_details, telecom_status, activation_date,
  scheduled_install_date, sale_date, commission_payment_month_offset, commission_expected_date
ON public.sales FOR EACH ROW EXECUTE FUNCTION public.set_sale_commission_payment_month();

UPDATE public.operators SET commission_payment_month_offset = 2
WHERE organization_id = '78a42249-4dd6-4e6c-b78b-fe862da7e956'
  AND id = '83f654e4-7af4-476b-9078-ac46d096f109';

-- Backfill only BDS sales carrying the configured Digi operator snapshot.
UPDATE public.sales SET commission_payment_month_offset = 2
WHERE organization_id = '78a42249-4dd6-4e6c-b78b-fe862da7e956'
  AND EXISTS (SELECT 1 FROM jsonb_each(servicos_details) line
    WHERE line.value->>'operator_id' = '83f654e4-7af4-476b-9078-ac46d096f109');

COMMIT;
