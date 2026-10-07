-- A sale chargeback only applies while the sale remains cancelled. Returning
-- to an earned telecom state removes every automatic chargeback for that sale,
-- including ones previously marked reconciled.
CREATE OR REPLACE FUNCTION public.sync_sale_chargebacks()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.telecom_status = 'cancelado' THEN
    INSERT INTO public.sale_chargebacks (organization_id, sale_id, user_id, amount)
    SELECT NEW.organization_id, NEW.id, split.user_id, COALESCE(SUM(split.amount), 0)
    FROM public.sale_commission_splits split
    WHERE split.sale_id = NEW.id
    GROUP BY split.user_id
    HAVING COALESCE(SUM(split.amount), 0) <> 0
    ON CONFLICT (sale_id, user_id) DO UPDATE
      SET amount = EXCLUDED.amount, updated_at = now()
      WHERE sale_chargebacks.status = 'pending';

  ELSIF NEW.telecom_status IN ('ativo', 'instalado') THEN
    DELETE FROM public.sale_chargebacks WHERE sale_id = NEW.id;

  ELSIF OLD.telecom_status = 'cancelado' THEN
    DELETE FROM public.sale_chargebacks
    WHERE sale_id = NEW.id AND status = 'pending';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.sync_sale_chargebacks() IS
  'Stages automatic chargebacks on cancellation and removes them when the sale returns to ativo or instalado, regardless of confirmation status.';

-- Reconcile sales reactivated before this rule was installed. The current
-- production audit found one such row: sale 0009 (Florante Azul), 60 EUR.
DELETE FROM public.sale_chargebacks cb
USING public.sales sale
WHERE cb.sale_id = sale.id
  AND sale.telecom_status IN ('ativo', 'instalado');
