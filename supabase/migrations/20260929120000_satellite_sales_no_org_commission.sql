CREATE OR REPLACE FUNCTION public.normalize_satellite_sale_commission()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  _seller_commission numeric;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM jsonb_each(COALESCE(NEW.servicos_details, '{}'::jsonb)) AS detail(product_name, value)
    WHERE detail.value->>'tecnologia' = 'satelite'
  ) THEN
    SELECT COALESCE(SUM(amount), 0)
      INTO _seller_commission
    FROM public.sale_commission_splits
    WHERE sale_id = NEW.id;

    NEW.comissao := ROUND(_seller_commission, 2);
    NEW.org_commission := 0;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS normalize_satellite_sale_commission_trg ON public.sales;
CREATE TRIGGER normalize_satellite_sale_commission_trg
  BEFORE UPDATE OF comissao, org_commission, servicos_details
  ON public.sales
  FOR EACH ROW
  EXECUTE FUNCTION public.normalize_satellite_sale_commission();

UPDATE public.sales AS sale
SET
  comissao = COALESCE((
    SELECT ROUND(SUM(split.amount), 2)
    FROM public.sale_commission_splits AS split
    WHERE split.sale_id = sale.id
  ), 0),
  org_commission = 0
WHERE EXISTS (
  SELECT 1
  FROM jsonb_each(COALESCE(sale.servicos_details, '{}'::jsonb)) AS detail(product_name, value)
  WHERE detail.value->>'tecnologia' = 'satelite'
);
