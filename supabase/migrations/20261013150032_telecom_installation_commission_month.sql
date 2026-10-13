BEGIN;

-- Telecom has one date and one rule. Preserve the previous rule for other niches.
CREATE OR REPLACE FUNCTION public.set_sale_commission_payment_month()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  month_offset integer;
  reference_date date;
BEGIN
  IF EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = NEW.organization_id AND o.niche = 'telecom') THEN
    NEW.commission_payment_month_offset := 1;
    NEW.commission_expected_date := CASE
      WHEN NEW.telecom_status IN ('ativo', 'instalado') AND NEW.scheduled_install_date IS NOT NULL
        THEN (date_trunc('month', NEW.scheduled_install_date AT TIME ZONE 'Europe/Lisbon') + interval '1 month')::date
      ELSE NULL
    END;
    RETURN NEW;
  END IF;
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


-- Refresh timing only, without recalculating amounts or beneficiaries.
UPDATE public.sales s SET commission_payment_month_offset = 1
WHERE EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = s.organization_id AND o.niche = 'telecom');

COMMIT;
