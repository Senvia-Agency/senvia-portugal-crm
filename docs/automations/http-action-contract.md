# Pedido HTTP das automações

O passo `webhook` aceita GET, POST, PUT e PATCH. O método omitido continua POST. Cabeçalhos e corpo configurados são objetos JSON; os valores de texto usam o interpretador de variáveis das automações. O corpo é interpretado antes da substituição dos valores, por isso nomes com aspas não alteram a estrutura JSON. GET não envia corpo. Se o corpo estiver vazio, os restantes métodos mantêm o payload legado `{run_id, flow_id, contact}`.

Antes de enviar, o servidor valida protocolo HTTP/HTTPS, credenciais no URL, destinos locais/privados/reservados e resolução DNS. Todos os endereços devolvidos devem ser públicos. Não segue redirecionamentos. O prazo conjunto de resolução e pedido é 30 segundos; falhas HTTP conservam o código, incluindo 429 para a política de repetição. A execução não grava os cabeçalhos, corpo nem parâmetros da URL no resultado.

A resolução prévia bloqueia nomes que já resolvem para redes privadas. O fetch padrão faz a sua própria resolução na conexão; proteção absoluta contra uma alteração maliciosa de DNS entre as duas etapas depende de um proxy de saída com política de rede ou de transporte com fixação do IP.

Os testes usam exclusivamente resolução e transporte injetados; não chamam destinos externos.
