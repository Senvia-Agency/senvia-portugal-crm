INSERT INTO public.app_announcements (title, content, version, is_active, published_at)
SELECT 'Telecom: instalações marcadas e detalhe financeiro',
  'O card Por instalar passa a contar apenas vendas no estado Em instalação com data de instalação marcada. As vendas pendentes e as instalações sem data ficam excluídas deste card, tanto no dashboard como no financeiro e nas respetivas listas de detalhe.

No Financeiro, o card Valor da Organização permite agora consultar as vendas que compõem o total, com o valor da organização em cada venda e os mesmos filtros de período, operadora, vendedor, estado e tipo.',
  '26.4.2', true, now()
WHERE NOT EXISTS (
  SELECT 1 FROM public.app_announcements WHERE version = '26.4.2'
);
