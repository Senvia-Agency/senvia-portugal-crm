# Contrato de repetição por passo

Implementação pura: `supabase/functions/_shared/automation-retry.ts`.

```ts
const decision = decideAutomationRetry(
  node.config.retry,
  run.context[`__retry_${node.id}`],
  { status: providerStatus, message: outcome.error },
  now,
);
```

`retry` aceita `{ max_attempts: 1..5, interval_minutes: 1..60 }`. A quantidade inclui a execução original. Três tentativas permitem duas repetições após a primeira falha. Política ausente desativa repetições.

Se `kind === 'retry'`, guardar `decision.state` em `context[__retry_<node>]`, estacionar até `decision.wakeAt` e retomar o mesmo nó (`resumeSelf`). O estado contém `attempts` (falhas já observadas) e `next_attempt_at`. Limpar o estado apenas depois do sucesso; não reiniciar o contador ao acordar. Não gravar um passo final de sucesso antes de repetir.

Se `kind === 'fail'`, preservar a falha original e expor `reason` para diagnóstico. Configuração inválida, estado corrompido, tentativa esgotada e erro não transitório nunca agendam novas tentativas.

São transitórios: HTTP 408, 429 e 5xx; sem status estruturado, mensagens explícitas de timeout, ECONNRESET/ECONNREFUSED/EAI_AGAIN e canal desligado/desconectado. Status HTTP explícito tem precedência sobre o texto: uma rejeição 403 não passa a ser transitória porque a mensagem inclui a palavra timeout. Falhas desconhecidas não são repetidas por suposição.

O módulo decide elegibilidade e prazo; a integração deve preservar a identidade da operação no provedor para não reenviar uma operação já aceita quando a confirmação se perde. O módulo sozinho não fornece garantia de envio único.

Verificação: testes determinísticos com relógio injetado, sem chamadas externas ou temporizadores.

## Erros de funções e identidade de visitas

`formatAutomationInvocationError(error, label)` preserva o código HTTP inteiro de
`error.context.status` entre 400 e 599, incluindo o `Response` usado pelo SDK em
`FunctionsHttpError`. Não lê o corpo da resposta. Assim, email, Otto e subfluxos
conservam a classificação de 429/5xx para repetição; 400 falha imediatamente.

Efeitos deduplicados por passo recebem `visitStepKey(context, nodeId)`: primeira
visita usa o identificador original e visitas seguintes usam `__visit:<id>:<n>`.
Pedidos financeiros, ações CRM, expiração de proposta e rascunhos humanos usam
essa identidade. A chamada ao provedor Otto conserva o identificador original
para a autorização pelo grafo; só a persistência do rascunho usa a visita.
