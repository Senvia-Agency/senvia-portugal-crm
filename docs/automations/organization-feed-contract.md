# Feed da organização

A ação `publish_feed` publica em `organization_feed_posts` através de `publish_automation_feed_post`. Não utiliza anúncios globais. O motor renderiza as variáveis de `title` (opcional, até 120 caracteres) e `message` (obrigatória, até 4000 caracteres). Os valores são texto puro; a interface deve renderizá-los como texto, sem interpretar HTML.

O serviço verifica organização e percurso ativo, bloqueia a linha do percurso e publica uma única vez por percurso/visita do nó. O resultado contém `post_id`. Repetições preservam o conteúdo e a identificação da primeira publicação. Erros de validação ou banco fazem o passo falhar explicitamente.

Membros ativos leem apenas o Feed da sua organização. Navegadores não recebem permissões de escrita na tabela nem de execução da publicação. O autor é o criador da automação somente se ainda for membro ativo da organização; caso contrário, fica vazio.

Eliminar automação ou percurso preserva a publicação, seu texto, nome original da automação e identificação do nó. As referências eliminadas passam a nulas. Eliminar a organização remove seu Feed. Esta implementação não foi aplicada a nenhum banco externo.
