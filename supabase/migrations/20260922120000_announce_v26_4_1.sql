-- Release notes are idempotent so publication can be retried safely.
INSERT INTO public.app_announcements (title, content, version, is_active, published_at)
SELECT 'Telecom: vendas e comissões',
  '### Vendas e dashboard
O nicho Telecom passa a distinguir os estados Ativo e Instalado, com os cards de Instalados em primeiro lugar. Os filtros de Fibra e Satélite respeitam a tecnologia escolhida na venda.

### Financeiro
As vendas ativas e instaladas contam para as comissões. O total, a parte da equipa e o valor da organização usam os mesmos critérios de período e filtros. Os valores são atualizados após alterações às vendas.',
  '26.4.1', true, now()
WHERE NOT EXISTS (
  SELECT 1 FROM public.app_announcements WHERE version = '26.4.1'
);
