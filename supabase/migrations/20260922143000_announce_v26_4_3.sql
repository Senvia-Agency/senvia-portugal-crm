INSERT INTO public.app_announcements (title, content, version, is_active, published_at)
SELECT 'Telecom: previsão mensal de comissões',
  'O financeiro passa a respeitar o mês previsto de recebimento das operadoras com prazo configurado. O período aplica-se ao total, à parte da equipa, ao valor da organização e aos detalhes das vendas. Seleciona um mês futuro para consultar a previsão. A previsão não marca as comissões como pagas.',
  '26.4.3', true, now()
WHERE NOT EXISTS (SELECT 1 FROM public.app_announcements WHERE version = '26.4.3');
