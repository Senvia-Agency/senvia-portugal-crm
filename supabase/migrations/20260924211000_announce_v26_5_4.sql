INSERT INTO public.app_announcements (title, content, version, is_active, published_at)
SELECT
  'Correção no detalhe das propostas',
  'As propostas com valor mas sem produtos registados mostram agora um aviso. A impressão, o envio por email e a aceitação ficam indisponíveis até os produtos serem adicionados. A edição guarda as novas linhas antes de remover linhas antigas.',
  '26.5.4',
  true,
  now()
WHERE NOT EXISTS (
  SELECT 1 FROM public.app_announcements WHERE version = '26.5.4'
);
