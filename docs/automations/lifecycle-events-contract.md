# Eventos de ciclo comercial

Implementação: `20261105102400_automation_lifecycle_events.sql` e função interna `automation-lifecycle-sweep`.

| Gatilho | Entidade do percurso | Configuração |
|---|---|---|
| `lead_inactive` | lead | `days`, inteiro de 1 a 3660 |
| `proposal_unanswered` | proposal | `days`, inteiro de 1 a 3660 |
| `proposal_expiring` | proposal | `days`, inteiro de 1 a 3660 |
| `sale_fidelization_ending` | sale | `days`, inteiro de 1 a 3660 |

O intervalo é obrigatório no servidor. A interface pode sugerir 10, 3, 3 e 30 dias respectivamente.

`leads.last_activity_at` registra apenas fatos: criação de uma nova lead, mensagem persistida vinculada pela conversa à lead, conclusão de tarefa vinculada e alterações humanas autenticadas em campos comerciais. Atualização isolada de `updated_at` não é atividade. Leads antigas permanecem sem data até um novo fato, sem inferência retroativa. Leads arquivadas, com automações desativadas e em etapas finais configuráveis não entram no gatilho de inatividade.

`proposals.sent_at` é preenchido quando o estado muda para `sent`. Não há backfill por `proposal_date`. O gatilho de ausência de resposta só aceita estado `sent`; mudar para `negotiating` ou outro estado o retira. A validade vem de `proposals.valid_until`, data explícita e opcional. Deve ser exposta no editor de propostas ou na ação de atualizar campo; uma validade ausente não dispara expiração.

Fidelização usa a coluna real `sales.fidelizacao_end`, preservando os contratos existentes. Vendas canceladas são excluídas.

O sweep processa páginas rotativas de 100 candidatos por fluxo, deduplica por fluxo, registo, fato e intervalo através de `automation_runs.enrollment_key` e envia inscrições somente ao motor interno. Cron SQL a cada 15 minutos. Endpoint opcional exige service role ou `x-automation-secret` verificado; não deve ser exposto com autenticação anónima sem essa verificação interna.

Ações e condições recebem os campos reais do registo e os dados de contacto associados quando existem. A organização sempre vem do fluxo, e as associações de cliente/lead são validadas na mesma organização.
