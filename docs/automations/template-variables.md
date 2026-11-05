# Variáveis nas automações

O motor e a pré-visualização usam o mesmo interpretador de expressões. Os botões do editor agrupam as variáveis disponíveis por Contacto, Registo, Responsável, Organização, Passos anteriores e Otto. Só apresentam resultados de passos anteriores ligados ao passo atual.

| Expressão | Resultado |
| --- | --- |
| `{{primeiro_nome}}` | Valor do campo; vazio quando não existe. |
| `{{primeiro_nome | "olá"}}` | Usa `olá` se o campo não existir, for nulo, vazio ou apenas espaços. |
| `{{valor | moeda}}` | Formata em euros, com a convenção pt-PT. |
| `{{data_vencimento | data}}` | Data longa em português, no fuso Europe/Lisbon. |
| `{{valor | "0" | moeda}}` | Aplica a omissão antes do formato. |

As omissões são strings JSON entre aspas duplas: aceitam escapes como `\"` e podem conter `|`. Os valores `0` e `false` são preservados. Só existe uma omissão e um formato por expressão; a omissão deve preceder o formato.

`moeda` aceita números finitos, strings decimais com ponto e valores portugueses como `1.234,50 €`. `data` aceita `YYYY-MM-DD` ou uma data ISO com hora e fuso explícito (`Z` ou `+01:00`). Datas impossíveis e horas sem fuso não são convertidas. Campos ausentes ou não convertíveis ficam vazios e são assinalados na pré-visualização.

Os nomes aceitam letras, números, underscore, dois pontos e caminhos com pontos. Um nome plano exato tem precedência sobre um caminho aninhado. Só propriedades próprias dos dados são lidas. As expressões não executam JavaScript, chamadas de funções ou filtros arbitrários. Expressões não suportadas são removidas e apresentadas como inválidas na pré-visualização. O limite por expressão é 512 caracteres.

Na pré-visualização HTML os valores interpolados são escapados; o HTML do modelo é depois sanitizado pela interface. As mensagens simples mantêm o texto literal.

Os modelos de email guardados também usam esta sintaxe quando enviados por uma execução de automação autenticada e validada no servidor. Os envios de campanhas e envios manuais conservam o interpretador anterior. O marcador reservado `{{unsubscribe}}` permanece disponível para a etapa que cria a ligação assinada de cancelamento de subscrição.

No envio de automações, os corpos HTML (inline e modelos guardados) escapam os valores das variáveis, incluindo aspas em atributos, preservando as etiquetas do próprio modelo. Os assuntos continuam a ser texto simples. A mesma política aplica-se aos valores usados como omissão.
