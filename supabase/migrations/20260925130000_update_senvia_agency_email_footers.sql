-- Standardize footer branding in SENVIA Agency email templates only.
-- Preserve each email's body and unsubscribe link.
DO $$
DECLARE
  v_org uuid := '06fe9e1d-9670-45b0-8717-c5a6e90be380';
  v_slogan text;
  v_changed integer;
BEGIN
  FOREACH v_slogan IN ARRAY ARRAY[
    'Transforme tráfego em lucro.',
    'Tecnologia inteligente para negócios que não param.',
    'O seu tempo é dinheiro. Nós poupamos ambos.',
    'Potência absoluta. Zero limites.',
    'A sua operação não pode parar.',
    '"Não fale com curiosos."'
  ] LOOP
    UPDATE public.email_templates
    SET html_content = replace(html_content, v_slogan, 'SENVIA · Soluções digitais para empresas')
    WHERE organization_id = v_org
      AND html_content LIKE '%' || v_slogan || '%';
  END LOOP;

  UPDATE public.email_templates
  SET html_content = replace(
    replace(
      replace(html_content,
        '© 2025 SENVIA - AI Software House.',
        '© 2026 SENVIA · Soluções digitais para empresas.'),
      '© 2026 SENVIA - AI Software House.',
      '© 2026 SENVIA · Soluções digitais para empresas.'),
    '© 2026 SENVIA Agency.',
    '© 2026 SENVIA · Soluções digitais para empresas.')
  WHERE organization_id = v_org
    AND (
      html_content LIKE '%© 2025 SENVIA - AI Software House.%'
      OR html_content LIKE '%© 2026 SENVIA - AI Software House.%'
      OR html_content LIKE '%© 2026 SENVIA Agency.%'
    );

  SELECT count(*) INTO v_changed
  FROM public.email_templates
  WHERE organization_id = v_org
    AND html_content LIKE '%SENVIA · Soluções digitais para empresas%';
  RAISE NOTICE 'SENVIA Agency templates with updated footer: %', v_changed;
END $$;
