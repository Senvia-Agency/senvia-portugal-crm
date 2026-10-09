BEGIN;

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS commission_month_override date;

COMMENT ON COLUMN public.sales.commission_month_override IS
  'Optional sale-specific commission month. When set, it overrides the operator schedule for this sale only.';

CREATE OR REPLACE FUNCTION public.set_sale_commission_payment_month()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  month_offset integer;
  reference_date date;
BEGIN
  reference_date := NEW.activation_date;
  IF NEW.telecom_status = 'instalado' THEN
    reference_date := coalesce(reference_date, (NEW.scheduled_install_date AT TIME ZONE 'Europe/Lisbon')::date);
  END IF;

  IF NEW.commission_month_override IS NOT NULL THEN
    reference_date := coalesce(reference_date, NEW.sale_date);
    month_offset := CASE WHEN reference_date IS NULL THEN 1 ELSE
      (extract(year FROM NEW.commission_month_override)::integer - extract(year FROM reference_date)::integer) * 12
      + extract(month FROM NEW.commission_month_override)::integer - extract(month FROM reference_date)::integer
    END;
    NEW.commission_payment_month_offset := least(greatest(month_offset, 1), 24);
    NEW.commission_expected_date := date_trunc('month', NEW.commission_month_override)::date;
    RETURN NEW;
  END IF;

  SELECT coalesce(max(o.commission_payment_month_offset), 0) INTO month_offset
  FROM jsonb_each(CASE WHEN jsonb_typeof(NEW.servicos_details) = 'object'
    THEN NEW.servicos_details ELSE '{}'::jsonb END) line
  JOIN public.operators o ON o.id::text = line.value->>'operator_id'
    AND o.organization_id = NEW.organization_id;

  NEW.commission_payment_month_offset := month_offset;
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
  scheduled_install_date, sale_date, commission_payment_month_offset, commission_expected_date,
  commission_month_override
ON public.sales FOR EACH ROW EXECUTE FUNCTION public.set_sale_commission_payment_month();

COMMIT;
