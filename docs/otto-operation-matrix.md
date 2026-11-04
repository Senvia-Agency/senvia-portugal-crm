# Otto — matriz de operações nativas

Estado: catálogo de fonte atualizado durante a implementação de `otto-native-operations`.
As linhas só podem passar a **verificada** quando o nome exportado, o contrato do
tool e a entrada no registry forem confirmados no mesmo snapshot. Este documento
não é uma promessa de funcionalidades que ainda não chegaram ao registry.

## Regra de escopo

Otto só pode trabalhar sobre o recurso nativo que a aplicação já usa para a rota
indicada. O backend deve aplicar `organization_id = ctx.orgId`, associação ao
membro autenticado, `data_scope` (`own | team | all`) e o filtro de permissão da
subárea. Não existe uma tabela paralela, CRUD genérico, SQL enviado pelo modelo,
credencial no browser ou escrita fora do contrato Edge/RPC que a UI usa.

Uma escrita exige, cumulativamente:

1. identidade autenticada, MFA e membro ativo da organização;
2. módulo ativo e grant de escrita Otto da organização;
3. `module/subarea/action` permitido para o perfil (admin não elimina o grant);
4. confirmação estruturada para ações com impacto, com os argumentos exatos,
   validade de cinco minutos e consumo único;
5. auditoria redigida antes da mutação e estado final real (`succeeded`,
   `failed`, `denied` ou `unknown`).

`grant` é sempre por organização e módulo. O estado inicial é desligado. Uma
organização não pode consultar nem alterar o grant de outra organização.
Perfis legados que não tenham uma permissão/subárea nova recebem negação por
defeito; não se converte ausência de chave num acesso amplo.

## Como ler o catálogo

| Estado | Significado |
| --- | --- |
| `verificada` | Export e contrato foram encontrados no código e o registry inclui a operação no snapshot desta revisão. Ainda requer aceitação manual do utilizador. |
| `parcial` | Existe parte do caminho (por exemplo, rascunho ou prévia), mas falta o contrato necessário para afirmar que a operação completa é executável. |
| `pendente` | A rota/recurso existe na UI ou está no plano, mas o export/registry seguro ainda não foi entregue pelo worker responsável. |
| `indisponível` | Bloqueio intencional: não há operação Otto para esse recurso ou o módulo está desativado. |
| `requer confirmação` | Classe de confirmação; não é um estado de implementação. |

As linhas `pendente` e `parcial` devem permanecer no catálogo: tornam visível o
limite real e impedem que o prompt ou o guia de aceitação inventem sucesso.

## Rotas autenticadas canónicas

As rotas abaixo são as únicas referências de navegação que este catálogo usa.

| Área | Rota nativa |
| --- | --- |
| Leads | `/leads` |
| Clientes | `/clients` |
| Prospects | `/prospects` |
| Inbox | `/inbox` |
| Portal Total Link | `/portal-total-link/home`, `/portal-total-link/contratos`, `/portal-total-link/ids`, `/portal-total-link/pendentes`, `/portal-total-link/reclamacoes`, `/portal-total-link/rh` |
| Agenda | `/calendar` |
| Propostas | `/proposals` |
| Vendas | `/sales` |
| Financeiro | `/financeiro`, `/financeiro/nova-fatura`, `/financeiro/pagamentos`, `/financeiro/faturas`, `/financeiro/despesas` |
| Definições | `/settings` |
| Marketing | `/marketing`, `/marketing/templates`, `/marketing/campaigns`, `/marketing/reports`, `/marketing/lists` |
| Automações | `/automacoes`, `/automacoes/:id` |
| E-commerce | `/ecommerce/*` redireciona para `/dashboard`; módulo desativado |
| Suporte Otto | painel Otto no layout autenticado; não é uma rota de dados adicional |

Fonte das rotas: `src/App.tsx:129-166` e `src/components/portal-total-link/portalTotalLinkConfig.ts:19-80`.

## Contrato nativo da UI

Esta tabela liga a operação à mesma entidade/hook usada pela UI. O handler Otto
precisa respeitar o mesmo conjunto de campos, RLS/Edge Function e estados que o
hook, sem copiar uma segunda implementação de negócio.

| Área | Recurso nativo e UI de referência | Limite que o tool deve preservar |
| --- | --- | --- |
| Leads | `leads`, `pipeline_stages`; `src/hooks/useLeads.ts`, `usePipelineStages.ts` | IDs e etapas pertencem à organização; arquivar/apagar/importar em lote não é implícito |
| Clientes | `crm_clients`; `src/hooks/useClients.ts` | `organization_id` e campos aceites pelo formulário; não apagar histórico por conveniência |
| Prospects | hook `src/hooks/useProspects.ts` e o contrato de geração/importação correspondente | IDs, lote e atribuição devem ser validados; sem scraper/credencial exposto ao modelo |
| Vendas | `sales`, `sale_items`, `sale_payments`; `src/hooks/useSales.ts`, `useSalePayments.ts` | venda, pagamento e Stripe são domínios distintos; nunca transformar pagamento em cobrança Stripe |
| Propostas | `proposals` e produtos associados; `src/hooks/useProposals.ts` | proposta tem lead/cliente válido na mesma organização |
| Agenda | `calendar_events`; `src/hooks/useCalendarEvents.ts` e `src/components/calendar/*` | datas/timezone/participantes são argumentos explícitos; apagar requer confirmação |
| Inbox | caixas/conversas/mensagens e tarefas; `useMessagingChannels.ts`, `useMetaInbox.ts`, `useEmail.ts`, `useInboxTasks.ts` | canal e conversa pertencem à organização; envio sai por `meta-send`/`email-message-action`, nunca por token no tool |
| Financeiro | `invoices`, `credit_notes`, `expenses`, `sale_payments`; `useInvoices.ts`, `useInvoiceOperations.ts`, `useExpenses.ts`, `useFinanceStats.ts` | InvoiceXpress/KeyInvoice são Edge Functions; estados pending/failed não são sucesso |
| Marketing | `email_templates`, listas, campanhas e relatórios; `useEmailTemplates.ts`, `useContactLists.ts`, `useCampaigns.ts`, `useEmailStats.ts` | opt-out/consentimento/lista são verificados antes do envio; Brevo não é acesso direto |
| Automações | `automation_flows`, `automation_runs`, `automation_run_steps`; `useAutomationFlows.ts`, `useAutomationFolders.ts` | criação começa em `draft`; grafo, trigger e IDs são validados no servidor |
| Portal Total Link | layout `src/components/portal-total-link/*`, RH em `src/hooks/useRhAbsences.ts` | acesso Perfect2Gether e organização/membro; páginas de métricas estáticas não são prova de uma API de escrita |
| Definições | `organizations`, perfil e integrações; `src/pages/Settings.tsx` | nunca alterar membros/papéis/permissões gerais, Stripe ou devolver segredos |

## Operações atualmente verificadas no código

Neste snapshot, `ALL_TOOLS` inclui os agregadores de Automações, Financeiro,
Definições/Portal, CRM, Vendas/Propostas, Agenda/Inbox, Mensagens e Marketing.
`verificada` nesta secção significa apenas: export presente, agregado no registry,
contrato tipado e compilação estática limpa. Não significa deploy nem QA manual.
O inventário estático do grafo de barrels contém 121 definições registadas, todas
com nome único; a ação interna consumida de ativação do lembrete não é exposta ao
modelo e, por isso, não entra nessa contagem.

| Rota | Operação/export | I/O | `module / subarea.action` | Grant Otto | Confirmação | Handler/recurso | Estado/limite |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `/leads` | `get_lead_details`, `update_lead`, `assign_lead`, `archive_lead`, `restore_lead`, `delete_lead_permanently`, `bulk_import_leads` | leitura/escrita | `leads / kanban.view|edit|assign|delete`; `leads / export.import` | `leads` nas escritas | immediate para editar/atribuir/arquivar/restaurar; confirmação para apagar/importar | `crm-lead*.ts`; `leads`, `lead_imports` | **verificada no código**; delete preserva histórico ligado; sem delete/import em massa fora do limite |
| `/clients` | `update_client`, `delete_client_permanently` | escrita | `clients / list.edit|delete` | `clients` | immediate para editar; confirmação para apagar | `crm-client.ts`; `crm_clients` | **verificada no código**; delete recusa cliente com propostas, vendas ou CPEs |
| `/prospects` | `search_prospects`, `get_prospect_details`, `distribute_prospects`, `import_prospects` | leitura/escrita | `prospects / prospects.view|assign|import` | `prospects` nas escritas | confirmação para distribuir/importar | `crm-prospect*.ts`; `prospects` e leads nativas | **verificada no código**; lote e responsáveis são limitados e validados |
| `/sales` | `update_sale`, `delete_sale` | escrita | `sales / sales.edit|delete` | `sales` | confirmação | `sales-records.ts`; `sales` | **verificada no código**; delete recusa histórico financeiro/fiscal/recorrente |
| `/sales` | `list_sale_payments`, `get_sale_payment_details`, `create_sale_payment`, `update_sale_payment`, `delete_sale_payment` | leitura/escrita | `sales / payments.view|add` | `sales`, nunca `finance` | confirmação para criar/editar/apagar | `sales-payments*.ts`; `sale_payments` | **verificada no código**; apenas pagamentos manuais, sem Stripe/fiscal/recorrência |
| `/proposals` | `get_proposal_details`, `update_proposal`, `delete_proposal`, `replace_proposal_products` | leitura/escrita | `proposals / proposals.view|edit|delete` | `proposals` nas escritas | immediate para campos; confirmação para apagar/substituir produtos | `sales-proposals*.ts`; RPC `replace_proposal_products` | **verificada no código**; RPC usa `ctx.supabaseUser`, org, 1–100 linhas e `expected_updated_at` |
| `/calendar` | `list_calendar_events`, `check_calendar_availability`, `create_calendar_event`, `update_calendar_event`, `delete_calendar_event` | leitura/escrita | `calendar / events.view|create|edit|delete` | `calendar` nas escritas | immediate para criar/editar; confirmação para apagar | `calendar-inbox-event*.ts`; `calendar_events` | **verificada no código**; datas exigem timezone e participantes/lead são validados |
| `/inbox` | `list_inbox_tasks`, `create_inbox_task`, `update_inbox_task`, `complete_inbox_task` | leitura/escrita | `inbox / tasks.view|create|edit` | `inbox` nas escritas | immediate | `calendar-inbox-task*.ts`; `inbox_tasks` | **verificada no código**; conversa, canal e responsável são revalidados |
| `/inbox` | `list_inbox_conversations`, `get_inbox_conversation`, `send_inbox_message` | leitura/escrita | `inbox / messages.view|send` | `inbox` no envio | confirmação no envio | `messaging-conversation*.ts`; `meta-send` | **verificada no código**; texto apenas, canal/destinatário exatos, sem retry automático após resultado desconhecido |
| `/inbox` | `list_inbox_email_channels`, `search_inbox_email_messages`, `get_inbox_email_message`, `create_inbox_email_draft`, `update_inbox_email_draft`, `queue_inbox_email` | leitura/escrita | `inbox / email.view|create|edit|send` | `inbox` nas escritas | immediate para draft; confirmação para fila | `messaging-email*.ts`; `email_drafts`, `email_commands` | **verificada no código**; sem anexos; fila não é reportada como entrega |
| `/marketing/templates` | `list_email_templates`, `get_email_template`, `create_email_template`, `update_email_template`, `delete_email_template`, `send_email_template` | leitura/escrita/provider | `marketing / templates.view|create|edit|delete|send` | `marketing` nas escritas | confirmação | `marketing-templates.ts`; `email_templates`, `send-template-email` | **verificada no código**; confirmação guarda IDs/digest/versão gerados no servidor e revalida email/consentimento antes do envio |
| `/marketing/lists` | `list_marketing_contacts`, `list_marketing_lists`, `get_marketing_list`, `create_marketing_list`, `update_marketing_list`, `delete_marketing_list`, `add_contacts_to_marketing_list`, `remove_contacts_from_marketing_list` | leitura/escrita | `marketing / lists.view|create|edit|delete` | `marketing` nas escritas | confirmação nas mutações | `marketing-lists.ts`; listas/contactos nativos | **verificada no código**; lista e contactos pertencem à mesma org |
| `/marketing/campaigns` | `list_email_campaigns`, `get_email_campaign`, `get_email_campaign_results`, `create_email_campaign_draft`, `update_email_campaign_draft`, `delete_email_campaign_draft`, `launch_email_campaign` | leitura/escrita/fila | `marketing / campaigns.view|create|edit|delete|send` | `marketing` nas escritas | confirmação | `marketing-campaigns-*.ts`; `email_campaigns`, `email_sends` | **verificada no código**; lançamento guarda audiência exata e versões; só agenda o worker |
| `/marketing/reports` | `get_marketing_report` | leitura | `marketing / reports.view` | — | imediata | `marketing-reports.ts`; `email_sends` | **verificada no código**; máximo 1000 eventos e sem HTML/segredos |
| `/financeiro/*` | `get_invoice_details`, `get_credit_note_details`, `search_finance_payments`, `get_finance_payment_details`, `search_expenses`, `get_expense_details` | leitura | `finance / invoices.view|payments.view|expenses.view` | — | imediata | `finance-*.ts`; documentos/pagamentos/despesas nativos | **verificada no código**; filtros de org e data_scope |
| `/financeiro/despesas` | `create_expense`, `update_expense`, `delete_expense` | escrita | `finance / expenses.add|edit|delete` | `finance` | confirmação | `finance-expense-write*.ts`; `expenses` | **verificada no código**; conta e dono são org-scoped |
| `/financeiro/faturas` | `issue_invoice`, `cancel_invoice`, `send_invoice_email` | escrita/provider | `finance / invoices.issue|cancel` | `finance` | confirmação | `finance-fiscal-write*.ts`; Edge fiscal existente | **verificada no código**; resultado provider é validado, Vendus cancel continua indisponível |
| `/settings` | `get_team_member_details` | leitura | `settings / team.view` | — | imediata | `settings-portal-team.ts`; membros/perfis/equipas | **verificada no código**; read-only e sem credenciais |
| `/portal-total-link/contratos` | `search_portal_energy_contracts`, `get_portal_energy_contract_details` | leitura | `portal_total_link / energy.portal.view` | — | imediata | `settings-portal-contract*.ts`; vendas/itens | **verificada no código**; requer módulo/acesso Portal e data_scope |
| `/automacoes*` | `get_automation_builder_schema`, `list_automation_flows`, `get_automation_flow`, `create_automation_draft`, `update_automation_draft`, `pause_automation_flow` | leitura/escrita | `automations / flows.view|create|edit|manage` | `automations` nas escritas | immediate para draft/edit/pause | `generic-automation-*.ts`; `automation_flows` | **verificada no código** |
| `/automacoes*` | `activate_automation_flow`, `delete_automation_flow`, `create_overdue_payment_followup_draft`, `prepare_automation_activation` | escrita | `automations / flows.manage|delete|create` | `automations` | confirmação | `automations.ts`, `generic-automation-confirmed-tools.ts` | **verificada no código**; prévia de destinos externos ligada ao grafo e referências, revalidação antes da ativação |

### Operações partilhadas/legadas expostas

Estas operações continuam em `ALL_TOOLS` e passam pela autorização, grant,
confirmação e auditoria centrais. Não foram reescritas nesta lane de domínios;
por isso mantêm estado `parcial` até uma revisão própria do handler antigo.

| Rota | Exports presentes | I/O | Permissão | Handler | Estado |
| --- | --- | --- | --- | --- | --- |
| `/leads` | `search_leads`, `get_pipeline_summary`, `create_lead`, `update_lead_status` | leitura/escrita | `leads / kanban.view|add|edit` | `read.ts`, `write.ts` | **parcial — legado exposto** |
| `/clients` | `search_clients`, `get_client_details`, `create_client` | leitura/escrita | `clients / list.view|add` | `read.ts`, `write.ts` | **parcial — legado exposto** |
| `/sales` | `prepare_sale_creation`, `search_sales`, `get_sale_details`, `create_sale`, `update_sale_seller` | leitura/escrita | `sales / sales.view|create|edit` | `read.ts`, `write.ts` | **parcial — legado exposto** |
| `/proposals` | `search_proposals`, `create_proposal` | leitura/escrita | `proposals / proposals.view|create` | `read.ts`, `write.ts` | **parcial — legado exposto** |
| `/financeiro`, `/calendar`, `/settings` | `search_invoices`, `search_credit_notes`, `get_finance_summary`, `get_upcoming_events`, `list_team_members` | leitura | permissões de leitura correspondentes | `read.ts` | **parcial — legado exposto** |
| painel Otto | `get_my_contact_info`, `submit_support_ticket` | leitura/escrita | identidade/suporte | `support.ts` | **parcial — legado exposto**; ticket requer confirmação |
| `/settings` e onboarding | `get_onboarding_status`, `set_company_info`, `setup_pipeline_stages`, `configure_invoicing`, `configure_brevo`, `setup_lead_autoreply`, `set_modules`, `complete_onboarding` | leitura/escrita admin | `settings`; admin-only nas escritas | `onboarding-tools.ts` | **parcial — legado exposto**; grant central continua obrigatório |
| `/settings`, `/leads` | `configure_whatsapp`, `invite_member`, `import_leads` | navegação guiada | admin-only | `onboarding-tools.ts` | **verificada como guia UI**; não liga canal, não convida e não importa por si |

## Catálogo por rota: operações deliberadamente não expostas

| Rota | Cobertura atual | Operações UI fora do Otto neste snapshot |
| --- | --- | --- |
| `/leads`, `/clients`, `/prospects` | CRUD seguro indicado acima, importação limitada e distribuição | delete em massa, scraping/geração Apify arbitrária, conversão genérica e importação de ficheiro sem contrato estruturado |
| `/sales`, `/proposals` | criação legada; detalhe/edição/delete; pagamento manual; produtos atómicos | Stripe, subscrição, recorrência, aprovação/comissões, envio/conversão de proposta e anexos |
| `/calendar`, `/inbox` | eventos, disponibilidade, tarefas, texto Meta, drafts/email sem anexos | anexos, reações/delete de mensagens, adivinhar canal/destinatário e envio fora de Edge/outbox |
| `/financeiro/*` | leitura, despesas, emitir/cancelar/enviar documento suportado | criar notas de crédito, cancelar Vendus, alterar reconciliação Stripe e configurar/devolver segredos |
| `/settings` | configuração onboarding segura; equipa read-only; grants na UI admin | mutar membro/papel/perfil/permissões gerais, billing/Stripe, MFA e revelar credenciais |
| `/portal-total-link/*` | apenas contratos derivados de vendas acessíveis | home agregada, IDs, pendentes, reclamações e RH não têm tool Otto neste snapshot |
| `/marketing/*` | templates, listas, drafts/campanhas, envio e relatórios | sync Brevo manual, reabrir campanha processada e enviar para contacto sem consentimento |
| `/automacoes*` | builder, drafts, edição/pausa e operações confirmadas indicadas acima | duplicar/testar fluxo e editar runs; destinos não resumíveis são recusados |
| `/ecommerce/*` | nenhuma | módulo desativado; não reativar por chat |

## Bloqueios intencionais

Estas recusas fazem parte do contrato e devem aparecer como `unsupported`/`Sem
permissão`, nunca como conclusão simulada:

- SQL livre, tabelas ou RPCs escolhidos pelo modelo;
- acesso entre organizações, IDs pertencentes a outra organização ou troca de
  organização durante uma confirmação;
- credenciais InvoiceXpress, KeyInvoice, Brevo, WhatsApp, Meta, Stripe ou tokens;
- convite/remoção de membro, alteração de papel, MFA, permissões gerais ou perfil
  de outro utilizador;
- Stripe/subscrição/faturação da plataforma;
- E-commerce enquanto a rota redirecionar e o módulo estiver desativado;
- envio de mensagem/email/campanha ou ativação de automação sem prévia e
  confirmação consumida;
- qualquer sucesso sem o estado real do recurso/provider.

Os tools de CRM/Vendas entregues recusam alvos destrutivos que tenham histórico
que não possa ser apagado com segurança. Importações/distribuições, deletes,
editar venda, substituir produtos e criar/editar/apagar pagamentos são
`confirmation_required`; alterações reversíveis de lead/cliente/proposta,
atribuição e arquivar/restaurar são `immediate` quando a permissão existe.

## Fontes verificadas nesta revisão

Inventário estático (não é teste nem QA):

- `src/App.tsx:129-166` — rotas autenticadas;
- `src/components/portal-total-link/portalTotalLinkConfig.ts:19-80` — subrotas do
  Portal Total Link;
- `supabase/functions/otto/lib/tools/registry.ts` — composição e execução;
- `supabase/functions/otto/lib/tools/automations.ts` — exports de automação;
- `supabase/functions/otto/lib/tools/read.ts`, `write.ts`, `support.ts` e
  `onboarding-tools.ts` — exports legados;
- `supabase/functions/otto/lib/authorization.ts`, `context.ts`,
  `confirmations.ts`, `pending-actions.ts` — autorização/confirmations;
- `supabase/migrations/20261009100000_otto_write_grants.sql`,
  `20261009102000_otto_audit_lifecycle.sql` e
  `20261009103000_otto_pending_actions.sql` — contratos de grant, auditoria e
  confirmação;
- hooks nativos indicados na tabela de contrato.

O guia de aceitação em `agent_docs/otto_full_capabilities_acceptance.md` é a
fonte para a execução manual futura. Nenhum cenário manual ou teste automatizado
foi executado nesta revisão.
