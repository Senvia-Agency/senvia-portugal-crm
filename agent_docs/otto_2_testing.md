# Otto 2.0 — handoff técnico e limites de aceitação

Este documento descreve o contrato atual do Otto e encaminha o teste manual para
`agent_docs/otto_full_capabilities_acceptance.md`. A matriz completa de rotas,
exports e estados está em `docs/otto-operation-matrix.md`.

## Estado atual

O frontend chama `supabase/functions/v1/otto` através de
`src/hooks/useOttoChat.ts`. A função antiga `otto-chat` continua a ser o fallback
de rollback até o cutover ser aprovado. O código Otto está organizado por
contexto, autorização, registry, tools de leitura/escrita, onboarding,
confirmações, auditoria e automações.

No snapshot desta revisão, o domínio de Automações já exporta e regista:

- `list_automation_flows` e `get_automation_flow` para leitura org-scoped;
- `create_overdue_payment_followup_draft` para criar um rascunho inativo;
- `prepare_automation_activation` para prévia e confirmação de cinco minutos;
- a ação consumida `activate_overdue_payment_followup_automation`, que ainda
  depende do motor aceitar o trigger `sale_payment_overdue_10d`.

Os workers já entregaram contratos de CRM, Vendas/Propostas/Pagamentos,
Agenda/Inbox, Mensagens, Financeiro, Marketing, Automações genéricas e Portal.
No snapshot desta revisão, ainda é necessário confirmar que cada export foi
reunido pelo `ALL_TOOLS`/registry final antes de o chamar pelo chat; a matriz
marca esses casos como `pendente — wiring do registry`. Ausência de permissão em
perfis legados deve falhar fechado. Atualizar primeiro a matriz e só depois
executar a aceitação.

## Pré-requisitos para qualquer teste manual

1. Usar uma organização de teste, com contactos sintéticos e sem destinatários
   reais.
2. Ter uma conta admin com MFA e uma conta membro com um perfil que permita
   testar `own`, `team` ou `all`. Nunca usar a conta de outra organização como
   atalho.
3. Confirmar que o módulo Otto está desligado por defeito e conceder somente o
   grant que está a ser testado.
4. Para WhatsApp/email/marketing, usar um canal e endereço de teste autorizado.
   Não colar API keys, tokens, passwords ou anexos confidenciais no chat.
5. Registar cada resultado no formato abaixo; não considerar o texto do modelo
   prova de uma mutação.

### Registo mínimo de evidência

Para cada cenário guardar, sem PII:

| Campo | Valor a registar |
| --- | --- |
| cenário | ID do guia de aceitação |
| invocação | frase enviada ao Otto e ação Confirmar/Cancelar, quando existir |
| actor/scope | admin ou membro; `own`, `team` ou `all`; organização mascarada |
| observável | rota aberta, estado do cartão, mensagem de recusa e/ou linha UI atualizada |
| artefacto | captura ou export redigido em `.omo/evidence/otto-manual/<id>.*` |
| estado | `PASS`, `FAIL` ou `BLOCKED` com motivo objetivo |

Não executar testes automatizados nem QA manual durante esta fase de
implementação; o diretório acima é para o aceite posterior do Thiago.

## Contratos de segurança que não mudam

- O backend valida token, MFA, membro ativo e organização antes de carregar o
  contexto. O `organization_id` recebido não é autoridade para atravessar orgs.
- Cada leitura e escrita filtra a organização validada e, quando aplicável,
  `data_scope` (`own | team | all`).
- Toda escrita precisa do grant Otto do módulo e da permissão da subárea. Admin
  mantém leitura ampla, mas não ganha grant de escrita automaticamente.
- A prévia guarda argumentos canónicos no servidor, expira em cinco minutos e
  só pode ser consumida uma vez. Trocar de organização, alterar o registo,
  revogar o grant ou repetir a confirmação deve recusar sem segunda mutação.
- A auditoria é redigida e admin-only. Falha ao iniciar auditoria bloqueia a
  mutação; falha ao concluir deixa `unknown` e proíbe retry cego.
- Tools não recebem SQL, chaves de organização ou credenciais. Providers
  externos são chamados apenas pelos Edge Functions nativos e o resultado real
  (entregue, pending ou failed) é o único que pode ser relatado.

## Cutover, deploy e rollback

Esta documentação não publica nada. Quando houver autorização explícita para
publicar:

- aplicar migrations e Edge Functions pelo processo documentado, mantendo grants
  desligados;
- publicar o frontend apenas pelo push da branch `main` e build Git da Vercel;
- não usar `vercel deploy --prod`, `dist/` ou `vercel --prebuilt`;
- confirmar o SHA completo servido com `npm run verify:production -- <full-sha>`;
- só depois do aceite manual ativar grants por módulo na organização desejada.

Rollback funcional do frontend, se for necessário antes do novo deploy, é voltar
temporariamente a URL de `useOttoChat.ts` para `/functions/v1/otto-chat`; não
apagar migrations nem reativar privilégios de browser.

## Referências de implementação

- `docs/otto-operation-matrix.md` — catálogo por rota e estado real;
- `supabase/functions/otto/lib/tools/registry.ts` — exposição, revalidação,
  confirmação e auditoria;
- `supabase/functions/otto/lib/authorization.ts` e `context.ts` — identidade,
  grant, permissões e âmbito;
- `supabase/functions/otto/lib/confirmations.ts` e `pending-actions.ts` —
  prévia, validade e consumo único;
- `supabase/migrations/20261009100000_otto_write_grants.sql` — grants e histórico;
- `supabase/migrations/20261009102000_otto_audit_lifecycle.sql` — auditoria;
- `supabase/migrations/20261009103000_otto_pending_actions.sql` — confirmações;
- `agent_docs/otto_full_capabilities_acceptance.md` — cenários manuais por área.

## Histórico do Otto 2.0

O Otto 2.0 substitui o switch monolítico por tools registradas e mantém o
streaming SSE. O onboarding pode orientar para rotas reais, mas um tour, botão ou
texto do modelo não é uma operação de dados. `invite_member` e `import_leads`,
quando aparecem como orientação visual, continuam a ser links/tours e não
alterações automáticas de membros ou uploads.
