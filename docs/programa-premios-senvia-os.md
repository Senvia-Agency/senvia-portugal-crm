# Programa de Prémios Senvia OS

**Estado:** especificação para implementação.
**Âmbito:** desconto por story aprovado e incentivo à migração para pagamento anual.
**Fora de âmbito:** o programa de indicação existente.

## Objetivo

Dar aos clientes ativos três formas simples de obter benefícios na sua subscrição:

1. Indicar uma empresa e receber um mês gratuito.
2. Publicar um story com vídeo de review aprovado e receber desconto.
3. Migrar para pagamento anual e receber dois meses gratuitos.

O programa deve ser transparente para o cliente, auditável para a equipa Senvia e seguro para a faturação Stripe.

## Regra de proteção: não alterar indicações

O programa de indicação já está correto e não faz parte deste trabalho. Não se alteram tabelas, RPCs, eventos Stripe, regras de elegibilidade, cupões, interface nem automações existentes.

O comportamento que deve permanecer intacto é:

- O cliente partilha o link de indicação da sua organização.
- A empresa indicada regista-se com esse link.
- Quando a empresa indicada paga a primeira mensalidade, o cliente que indicou ganha um mês gratuito.
- O mês é aplicado automaticamente numa renovação mensal futura.

Componentes existentes protegidos:

- `src/components/settings/ReferralProgram.tsx`
- `src/lib/referral-dashboard.ts`
- `supabase/migrations/20260912090000_referral_program.sql`
- `supabase/migrations/20260913100000_referral_billing.sql`
- `supabase/functions/_shared/referrals.ts`
- `supabase/tests/referrals-and-rate-limit.mjs`

O novo programa de prémios é independente. Pode aparecer na mesma área de Definições, mas usa dados, permissões, automações e registos de faturação próprios.

## Prémios incluídos

| Prémio | Regra | Benefício | Frequência |
|---|---|---|---|
| Indicação | Já existente; primeira mensalidade da empresa indicada paga | 1 mês gratuito | Uma vez por indicação válida |
| Story com vídeo de review | Story público no Instagram, identificado e aprovado pela Senvia | 10% nas 3 mensalidades seguintes | Uma aprovação por organização |
| Migração anual | Cliente mensal ativo muda para preço anual elegível | Paga 10 meses e utiliza 12 | Uma vez por cada período anual contratado |

### Regras do story

- O vídeo deve retratar uma experiência real com o Senvia OS.
- O story deve identificar ou marcar a Senvia.
- O cliente submete prova enquanto o story está disponível: captura de ecrã, gravação ou ficheiro exportado.
- Uma rejeição não consome a promoção; o cliente pode corrigir a prova e submeter novamente.
- Uma aprovação aplicada consome definitivamente o benefício de story da organização.
- O desconto não é convertível em dinheiro e não acumula com outra promoção comercial sobre as mesmas faturas.

### Regra anual

O valor anual deve ser calculado por plano como `preço mensal × 10`. O período contratado mantém-se de 12 meses.

No plano atual de 49 €/mês, o preço promocional anual seria 490 €. O valor final não deve ser codificado no frontend: é determinado pelo preço anual Stripe configurado para cada plano.

## Experiência do cliente

### Área "Prémios" em Definições

Criar uma nova área `Definições → Conta → Prémios`, separada de `Indicações`. A página mostra três cartões:

1. **Indicar uma empresa**
   - Apenas um atalho para a área existente de indicações.
   - Mostra uma frase explicativa, sem duplicar dados nem lógicas de indicação.

2. **Partilhar um story**
   - Explica o benefício de 10% por três mensalidades.
   - Mostra estado: disponível, em validação, aprovado, aplicado ou já utilizado.
   - Permite indicar o utilizador Instagram, URL opcional do perfil/story e carregar a prova.
   - Depois de submeter, mostra a data, o estado e uma mensagem de decisão.

3. **Mudar para anual**
   - Mostra preço mensal atual, preço anual promocional, poupança e data de início.
   - Para cliente mensal elegível, disponibiliza `Mudar para anual`.
   - Para cliente anual, mostra o período anual atual e a próxima renovação.
   - Para subscrição sem Stripe ou situação de faturação não suportada, mostra contacto com a equipa em vez de permitir uma alteração insegura.

### Estado dos prémios

Usar estados legíveis para o cliente:

- `Disponível`
- `Em validação`
- `Aprovado — desconto será aplicado`
- `Desconto em curso — X de 3 mensalidades`
- `Concluído`
- `Não aprovado`, com motivo curto e possibilidade de nova submissão

## Área de gestão Senvia

Criar uma área exclusiva para `super_admin`, acessível pelo painel de administração do sistema.

### Lista de reviews

Cada submissão apresenta:

- Organização, utilizador que submeteu e data.
- Identificador Instagram e ligação indicada pelo cliente, quando existir.
- Prova carregada em visualizador seguro.
- Estado, observações internas e histórico de decisões.
- Botões `Aprovar` e `Rejeitar`.

### Aprovação

Ao aprovar, o sistema:

1. Confirma novamente que a organização ainda é elegível e tem subscrição mensal Stripe ativa.
2. Cria um registo imutável de benefício aprovado.
3. Associa o desconto de 10% por três ciclos à subscrição correta.
4. Regista a aplicação com uma chave de idempotência.
5. Notifica o cliente no Senvia OS e por email.

Ao rejeitar, o sistema exige um motivo curto. A organização continua elegível para nova submissão.

## Modelo de dados

### `reward_claims`

Regista cada tentativa e cada benefício concedido.

| Campo | Finalidade |
|---|---|
| `id` | Identificador do pedido |
| `organization_id` | Organização beneficiária |
| `kind` | `social_story_review` ou `annual_migration` |
| `status` | `pending`, `approved`, `rejected`, `applying`, `applied`, `failed`, `reversed` |
| `submitted_by` | Utilizador autenticado que iniciou o pedido |
| `submitted_at`, `reviewed_at`, `applied_at` | Datas auditáveis |
| `reviewed_by` | Administrador Senvia responsável pela decisão |
| `review_note` | Motivo de rejeição ou nota interna |
| `evidence_path` | Caminho privado da prova do story |
| `instagram_handle` | Conta indicada pelo cliente |
| `billing_snapshot` | Subscrição, preço e condições congeladas no momento da aprovação |
| `idempotency_key` | Impede uma segunda aplicação do mesmo prémio |

Restrições necessárias:

- Um pedido pendente de story por organização de cada vez.
- Uma aprovação/aplicação de story por organização para sempre.
- Uma migração anual ativa por subscrição e período de faturação.
- Nunca apagar pedidos; usar estados e histórico.

### `reward_billing_applications`

Ledger técnico de cada alteração faturada.

| Campo | Finalidade |
|---|---|
| `id` | Identificador da aplicação |
| `reward_claim_id` | Pedido que originou a aplicação |
| `organization_id` | Organização faturada |
| `stripe_customer_id`, `stripe_subscription_id` | Ligação segura ao Stripe |
| `stripe_discount_id` ou `stripe_price_id` | Recurso Stripe aplicado |
| `invoice_id` | Fatura afetada, quando aplicável |
| `cycle_number` | 1, 2 ou 3 no desconto de story |
| `status` | `scheduled`, `applied`, `reversed`, `failed` |
| `idempotency_key` | Garante que reentregas de webhook não duplicam descontos |
| `created_at`, `updated_at` | Auditoria |

### `reward_audit_log`

Histórico imutável de eventos relevantes: submissão, aprovação, rejeição, alteração Stripe, falha, reversão e notificação. Deve guardar o ator, o tipo de evento, o pedido associado e metadados não sensíveis.

## Armazenamento de provas

Criar o bucket privado `reward-evidence`.

Estrutura de ficheiros:

```text
{organization_id}/social-story-review/{claim_id}/{filename}
```

Requisitos:

- Aceitar imagem e vídeo com limites explícitos de tamanho.
- Validar tipo MIME e assinatura real do ficheiro no servidor.
- A organização só carrega e vê as suas próprias provas.
- Apenas `super_admin` recebe URL assinada temporária para revisão.
- Não tornar a prova pública nem guardar URLs permanentes.

## Funções e serviços necessários

### Cliente web

- `useRewardsDashboard`: lê o resumo de prémios da organização autenticada.
- `useSubmitSocialStoryReview`: carrega a prova e cria o pedido pendente.
- `useAnnualRewardEligibility`: mostra apenas preços e ações permitidos.
- `RewardsProgram`: página de cliente em Definições.
- `RewardsReviewQueue`: fila administrativa de stories.
- `SocialStoryReviewDialog`: formulário de submissão e pré-visualização da prova.
- `AnnualMigrationCard`: comparação mensal/anual e confirmação da alteração.

### RPCs e Edge Functions

| Função | Responsabilidade | Autorização |
|---|---|---|
| `get_rewards_dashboard` | Devolve apenas o resumo seguro da organização | Admin da organização |
| `create_social_story_claim` | Cria pedido pendente após validar elegibilidade | Admin da organização |
| `review_social_story_claim` | Aprova/rejeita e gera auditoria | `super_admin` |
| `apply_social_story_discount` | Aplica o desconto Stripe de forma idempotente | Service role apenas |
| `get_annual_migration_quote` | Calcula preço anual elegível no servidor | Admin da organização |
| `start_annual_migration` | Agenda ou cria a mudança Stripe sem duplicar subscrição | Admin da organização + MFA |
| `reconcile_reward_billing` | Reconcilia faturas, descontos e reentregas Stripe | Webhook/service role |

Todas as funções de faturação devem validar a organização pelo identificador interno já associado ao cliente Stripe. Nunca devem localizar uma organização por email.

## Integração Stripe

### Ativo obrigatório: preço anual

Hoje o plano tem preço mensal Stripe configurado, mas o preço anual ainda não tem `priceIdYearly` e a interface bloqueia checkout anual. Antes de desenvolver o fluxo anual, é necessário criar no Stripe um preço recorrente anual para cada plano elegível e guardar o respetivo identificador na configuração segura do produto.

O preço anual promocional deve corresponder a 10 mensalidades. A alteração deve ser feita pelo servidor na subscrição existente, no fim do período mensal atual, ou pelo fluxo Stripe explicitamente configurado para migração. Nunca se deve iniciar um novo Checkout para uma organização que já tem uma subscrição ativa, pois isso cria risco de subscrição duplicada.

### Ativo obrigatório: desconto de story

Criar no Stripe um cupão/promotion code de 10% com duração de três ciclos mensais, restrito aos produtos Senvia OS. A aplicação deve ser feita por API server-side e registada em `reward_billing_applications` antes de qualquer chamada externa.

O desconto é elegível apenas para:

- Organização com subscrição Stripe mensal ativa.
- Organização sem benefício de story já aplicado.
- Próximas três faturas elegíveis do produto principal e, se aprovado comercialmente, dos utilizadores extra.

Subscrições anuais, isentas, canceladas, em atraso fora do período de tolerância ou com outro desconto comercial incompatível devem ser bloqueadas com uma explicação clara.

## Notificações e ativos de comunicação

Criar estes ativos dentro do sistema:

1. Cartão de entrada no painel de faturação: `Conhece os Prémios Senvia`.
2. Página de prémios em Definições.
3. Formulário de story com lista curta de requisitos.
4. Email de confirmação de submissão.
5. Email e notificação interna de aprovação, com data de início do desconto.
6. Email e notificação interna de rejeição, com motivo e botão para nova submissão.
7. Email de confirmação de migração anual, com valor, data de início e próxima renovação.
8. FAQ curta: indicação, story, anual, elegibilidade, acumulação e faturação.

## Segurança e permissões

- Clientes nunca escolhem o valor do desconto, ciclos ou preço Stripe.
- Clientes não podem aprovar o próprio story nem consultar pedidos de outras organizações.
- Aprovação, aplicação de desconto, migração anual e reversão são operações auditadas.
- Ações de faturação exigem administrador da organização e MFA quando a política estiver ativa.
- Webhooks Stripe devem ser idempotentes; a mesma fatura/evento não pode criar dois benefícios.
- As provas de story são privadas, com acesso temporário apenas a revisores autorizados.
- Não modificar RLS, funções ou tabelas do programa de indicação existente.

## Critérios de aceitação

### Story

- Uma organização elegível submete prova e vê `Em validação` imediatamente.
- Um super administrador aprova e o cliente vê o desconto de 10% por três faturas futuras.
- Uma segunda aprovação para a mesma organização é bloqueada.
- Uma rejeição permite nova submissão.
- Reentregar o evento Stripe não duplica desconto, fatura ou notificação.

### Migração anual

- Um cliente mensal elegível vê o preço de 10 meses por 12 de serviço.
- A conversão não cria uma segunda subscrição Stripe.
- O sistema guarda preço, período e identificadores Stripe usados na operação.
- Cliente anual ou não elegível não recebe ação de conversão incorreta.

### Regressão obrigatória

- O programa existente de indicação continua a atribuir um mês após o primeiro pagamento da empresa indicada.
- Os testes de indicação atuais passam sem alterações de comportamento.
- O link, o painel e o ledger de indicações mantêm os mesmos dados e permissões.

## Ordem recomendada de implementação

1. Preparar preços Stripe anual e cupão de story em ambiente de teste.
2. Criar tabelas, RLS, auditoria e bucket privado de provas.
3. Criar submissão de story e fila administrativa, sem aplicar desconto automaticamente.
4. Ligar aprovação ao desconto Stripe e à reconciliação por webhook.
5. Criar orçamento e migração anual sobre a subscrição existente.
6. Adicionar notificações, FAQ e métricas de conversão.
7. Executar testes de permissão, idempotência Stripe, rejeição/reenvio de story e regressão completa de indicações.

## Decisões que precisam de confirmação antes de implementar

- O desconto de 10% cobre apenas o plano principal ou também utilizadores extra?
- A migração anual começa no fim do ciclo mensal atual ou cobra/ajusta imediatamente?
- O cliente pode acumular mês de indicação com a renovação anual, ou o mês fica guardado para uma futura renovação mensal como acontece hoje?
- Qual é o limite de tamanho e duração permitido para a prova em vídeo?
