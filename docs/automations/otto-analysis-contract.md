# Passos Otto de automação

Tipos: `ai_classify`, `ai_summarize`, `ai_extract`.

Configuração: `text` é um template resolvido pelo motor; `fields` é uma lista de `{name,description}` para extração (1–20 nomes únicos em snake_case).

O motor invoca `automation-ai` com credencial interna, enviando `{run_id,node_id,mode,text,fields?}`. O endpoint confirma o percurso em execução e o nó na versão fixada do grafo, usa o provedor já configurado para Otto e valida a resposta antes de devolver variáveis.

Variáveis: `otto_resumo`, `otto_confianca`; na classificação, `otto_intencao` (comprar/duvida/suporte/cancelar/outro) e `otto_temperatura` (hot/warm/cold); na extração, `otto_campo_<name>`.

Saídas: `ready` / `review`. Confiança inferior a 0,75, intenção ambígua ou campo solicitado ausente exige revisão. O ramo review deve conduzir a tarefa ou notificação humana; o modelo não executa ações.

Limites: entrada 12 mil caracteres; 30 análises por minuto e 500 por dia por organização. Chaves e configuração do provedor vêm de OTTO_*/GEMINI_API_KEY no servidor, nunca do pedido ou browser.

Verificação local: 7 testes de contrato passaram sem chamadas ao modelo; helper passou TypeScript estrito e edge function compilou. Execução com provedor real e implantação pendentes.

## Rascunho de resposta (P3)

`ai_draft` usa o modo `draft`, com `text` como contexto. A saída do provedor deve ser estritamente `{suggested_reply,confidence,motivo}`. Este modo segue sempre por `review`, mesmo com confiança 1.

O texto sugerido não entra em variáveis de envio. O motor grava-o numa tarefa «Rever resposta sugerida pelo Otto», por RPC service-only e atómica, com deduplicação por percurso/nó. A tarefa contém o texto e o que a pessoa deve confirmar; a pessoa revê e envia manualmente na conversa. Não existe aprovação automática inferida por confiança nem envio automático deste rascunho.

Variáveis disponíveis: `otto_rascunho_tarefa_id`, `otto_confianca` e `otto_motivo_revisao`. O detalhe do passo permite inspecionar o rascunho e a tarefa de revisão.

Migração: `20261105102410_automation_reply_drafts.sql`. Ainda requer aplicação e verificação na base. Dez testes de análise/rascunho passaram sem chamadas ao modelo; schema inclui rejeição de aprovação e ações adicionais solicitadas pelo modelo.
