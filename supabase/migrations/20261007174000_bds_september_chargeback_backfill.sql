-- Assign the six reviewed BDS chargebacks to the September 2026 commission.
-- IDs and expected values were checked against the live database on 7 October.
DO $$
DECLARE
  manual_ids uuid[] := ARRAY[
    'cd910239-7a66-4a02-8dea-1294fa36ce8e', -- Vitor: 80
    '7909b131-5511-45bb-8e9a-edd6961271d7', -- Vitor: 150
    'd703667d-cf41-4931-a659-071fcb9dfd56', -- Sara: 180
    '65ab6c32-5840-4d11-a8e3-e079e443321e', -- Sara: 39
    '43140123-6caa-4be0-87eb-9934f0dd2873'  -- Sara: 39
  ]::uuid[];
  target_sale_chargeback_id uuid := '3d003290-0cb4-4b28-9490-3d2a5ad5355d'; -- Sale 0009, Sara: 60
BEGIN
  IF (
    SELECT count(*) = 5 AND sum(cb.amount) = 488
    FROM public.bds_manual_chargebacks cb
    JOIN public.organizations org ON org.id = cb.organization_id
    WHERE cb.id = ANY(manual_ids)
      AND org.name = 'BDS Telecomunicações'
      AND cb.status = 'reconciled'
  ) IS NOT TRUE THEN
    RAISE EXCEPTION 'The five reviewed BDS manual chargebacks no longer match; no rows were updated';
  END IF;

  IF (
    SELECT count(*) = 1 AND sum(cb.amount) = 60
    FROM public.sale_chargebacks cb
    JOIN public.sales sale ON sale.id = cb.sale_id
    JOIN public.organizations org ON org.id = cb.organization_id
    WHERE cb.id = target_sale_chargeback_id
      AND org.name = 'BDS Telecomunicações'
      AND sale.code = '0009'
      AND cb.status = 'reconciled'
  ) IS NOT TRUE THEN
    RAISE EXCEPTION 'The reviewed BDS sale chargeback no longer matches; no rows were updated';
  END IF;

  UPDATE public.bds_manual_chargebacks SET application_month = date '2026-09-01' WHERE id = ANY(manual_ids);
  UPDATE public.sale_chargebacks SET application_month = date '2026-09-01' WHERE id = target_sale_chargeback_id;
END;
$$;
