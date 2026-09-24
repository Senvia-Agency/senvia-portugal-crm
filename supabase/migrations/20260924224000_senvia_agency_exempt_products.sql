-- Remove three obsolete product VAT overrides. The organization is exempt
-- under article 53 (M10), and these products must inherit its fiscal config.
UPDATE public.products
SET tax_value = NULL
WHERE organization_id = '06fe9e1d-9670-45b0-8717-c5a6e90be380'
  AND name IN ('Pacote Loja Online', 'Pacote Presença', 'Pacote Validação Comercial')
  AND tax_value = 23
  AND EXISTS (
    SELECT 1 FROM public.organizations
    WHERE id = products.organization_id
      AND (tax_config->>'tax_value')::numeric = 0
      AND tax_config->>'tax_exemption_reason' = 'M10'
  );
