Automações do Senvia OS — documento de desenho
Data: 2026-11-04 · Versão de partida: v26.12.0 (Senvia 2.0) Âmbito: proposta de desenho. Não altera código nem base de dados.

Este documento parte do que o motor já faz (supabase/functions/automation-engine, src/lib/automation-nodes.ts, agent_docs/automations.md) e compara-o com a forma como o n8n, o Make e os CRMs com automações (HubSpot, ActiveCampaign, Pipedrive) desenham o mesmo problema. As fontes estão na secção 8.

Legenda usada em todas as tabelas:

Marca	Significado
✅	Já existe e está oferecido no editor
🟡	Existe no motor, mas está escondido, incompleto ou só por código
⬜	Não existe — proposta
P1 / P2 / P3	Prioridade (P1 = próxima fase)
0. Resumo executivo
O motor está certo; o que falta é vocabulário. O Senvia já tem o que é difícil: percursos persistentes (automation_runs), espera de resposta no WhatsApp, caminhos paralelos, horário de silêncio, reentrada controlada, histórico passo a passo, teste e repetição de execuções. O que falta são tipos de nó e de gatilho que reutilizam esse motor.
Gatilhos com filtro em vez de gatilhos especializados. Hoje há 27 tipos de gatilho e vários são o mesmo evento com um filtro fixo (lead_created_hot, sale_renewal_due_today…). Proposta: poucos gatilhos por entidade («Lead criada», «Venda mudou de estado», «Data de um registo») com um bloco «Só quando…» (filtro de entrada, como no Pipedrive e no Make).
Três peças de lógica em falta, por esta ordem:
Condição com várias regras (E/OU) e Router/Switch com caminho «Outros casos» (fallback do Make/n8n);
Esperar até (uma condição, uma data ou um dia/hora útil, com prazo) — o «Wait until» do ActiveCampaign e o delay por data do HubSpot;
Objetivo de saída ao nível da automação («sai quando pagar», «sai quando a lead for ganha») — o goal do HubSpot / Jump To do ActiveCampaign. É o que torna seguras as sequências de cobrança e de nutrição.
Erros como no n8n: por passo, «Tentar outra vez» (N vezes, intervalo) e «Se falhar: parar / continuar / seguir pelo caminho de erro»; ao nível da automação, «Avisar quando falhar» (notificação + tarefa ao dono).
Ações por módulo: faltam sobretudo ações sobre os próprios registos (atualizar campo, criar lead/venda/proposta, registar pagamento, agenda) e o Otto como passo (classificar, resumir, redigir resposta).
Modelos primeiro. A galeria tem 8 receitas; proposta de ~20, organizadas por objetivo (Responder rápido, Qualificar, Nutrir, Cobrar, Pós-venda, Reativar), com marcadores «por preencher» como nos templates do HubSpot.
1. O que já existe (base de partida)
1.1 Motor (automation-engine)
Capacidade	Estado	Notas
Grafo {nodes, edges} com ramos por chave	✅	automation_flows.graph
Percurso persistente por contacto	✅	automation_runs, automation_run_steps
Ações enroll / tick (cron 1 min) / reply / test / retry	✅	retry = «a partir do passo que falhou» ou «desde o início»
Caminhos paralelos (fan-out) e junção sem repetir efeitos	✅	context.__cursors
Um percurso ativo por contacto e fluxo; um passo por nó	✅	uniq_active_run_per_subject, uniq_step_per_run_node
Reentrada: uma vez / depois de terminar / sempre	✅	reentry_policy
Horário de silêncio (Europe/Lisbon) — adia, não descarta	✅	quiet_hours
Limite de passos por percurso (anti-ciclo)	✅	max_steps_per_run
Limite diário e intervalo mínimo no WhatsApp QR	✅	200/dia, 6 s
Buffer de mensagens seguidas («Mensagem recebida»)	✅	15 s por omissão, máx. 60 s
Verificação de cobrança antes de agir (pagou → termina)	🟡	Só nos gatilhos de cobrança (checkBillingPayment); é um «objetivo» implícito e não configurável
Versões do fluxo	🟡	flow_version existe; não há histórico de versões visível
Filtros de entrada	🟡	Só form_id, to_stage, keywords, channel_id
leads.automation_enabled respeitado	⬜	Bug conhecido em agent_docs/automations.md
1.2 Nós atuais
Nó	Categoria	Estado
Enviar WhatsApp (com «Aguardar resposta» + regras + botões + «Sem resposta»)	WhatsApp	✅
Enviar Email (modelo ou conteúdo)	Email	✅
Esperar (minutos/horas/dias)	Tempo	✅
Esperar resposta (pergunta feita fora do fluxo)	Lógica	🟡 escondido de propósito
Condição (1 campo, 1 operador; Sim/Não; inclui «Existe nos clientes/leads»)	Lógica	✅
Mudar etapa · Atribuir a utilizador · Adicionar a lista · Criar tarefa	CRM	✅
Webhook (GET/POST/PUT/PATCH, cabeçalhos e corpo com variáveis)	CRM	✅
Fim	Fim	✅
1.3 Gatilhos atuais
Oferecidos (19): lead criada (+ quente/morna/fria), estado da lead mudou, formulário submetido, entrou numa lista, mensagem recebida, palavra-chave WhatsApp, estado da venda mudou, cobrança vence em 2 dias / hoje / em atraso / atraso > 10 dias, indicações (3), plano renova em 2 dias, pagamento da subscrição em atraso.

Escondidos mas suportados pelo motor (🟡): cliente criado, estado do cliente mudou, proposta criada, estado da proposta mudou, venda criada, trials (7), subscrição criada/renovada/cancelada. Os de cliente, proposta e venda são eventos de negócio de qualquer empresa e devem voltar a ser oferecidos (P1).

1.4 Editor
✅ Criar direto no editor, painel lateral «Adicionar passo» com pesquisa e categorias, detalhe do passo em ecrã inteiro (Entrada · Parâmetros · Saída com dados da última execução), teste com contacto escolhido, atividade por percurso, pastas, galeria de modelos em ecrã inteiro.

2. Princípios de desenho (o que copiar e o que não copiar)
Referência	Copiar	Não copiar
n8n	Painel de nós com pesquisa; Entrada/Parâmetros/Saída; Retry On Fail e On Error → saída de erro por nó; Error Workflow; «Debug in editor» a partir de uma execução; Switch com fallback; Wait por tempo, data ou webhook	O modelo de items/$json e expressões JavaScript — demasiado técnico para o utilizador do Senvia. Manter {{variavel}} com chips
Make	Router com rotas filtradas e rota de fallback; filtro entre dois módulos (ícone no fio); agendamento legível («Dias úteis às 09:00»); retoma automática de erros temporários	Contagem de operações, bundles, iteradores/agregadores expostos ao utilizador
HubSpot	Gatilho = evento + filtros; reentrada explícita; ramo por valor de uma propriedade (um ramo por etapa); delay até data/dia da semana/hora; goals e listas de supressão; modelos com campos por preencher	Separar workflows por objeto com regras diferentes
ActiveCampaign	Wait until com prazo; Jump To (saltar para um ponto quando algo acontece); Split A/B por percentagem; «Terminar esta automação» / «Terminar outra automação»; biblioteca de receitas com assistente de mapeamento	—
Pipedrive	Simplicidade: gatilho + condições + ações em lista; gatilhos por data de um campo («X dias antes/depois»); condições de email «respondeu» / «clicou»	Limite de 10 ações; a condição falhada que salta tudo em silêncio
Regras que daí resultam para o Senvia:

Um conceito, um nó. Pergunta + espera vive em «Enviar WhatsApp» (já é assim); a mesma lógica para email: «Enviar Email» com «Aguardar abertura / clique / resposta».
Nada falha em silêncio. Cada passo ignorado ou falhado fica no histórico com motivo legível (o motor já o faz; manter em todos os nós novos).
Sem loops gerais. Um percurso é um contacto/registo. Para «muitos registos» usa-se um gatilho agendado que inscreve cada registo (o Iterator do Make fica implícito). Repetições usam «Esperar» + «Ir para passo» com limite de voltas.
Sempre uma saída. Toda a sequência de cobrança ou nutrição deve ter um objetivo ou uma condição de saída. O editor avisa quando não tem.
Texto da interface em pt-PT, tratando o utilizador por «você»; nomes técnicos (webhook, JSON) só dentro de «Avançado».
3. Catálogo de gatilhos
Modelo proposto: gatilho = evento + entidade + filtro «Só quando…». O filtro reutiliza o construtor de condições (secção 4.1) e é avaliado no enroll, antes de criar o percurso (como o to_stage e o form_id já fazem). Os gatilhos especializados existentes continuam a funcionar e passam a ser apresentados como atalhos (ex.: «Lead criada · quente» = «Lead criada» + «Temperatura é quente»).

3.1 Eventos do CRM
Entidade	Gatilho	Filtros típicos («Só quando…»)	Estado	Prior.
Leads	Lead criada	origem, formulário, temperatura, campanha, responsável	✅ (filtros 🟡)	P1
Leads	Lead mudou de etapa	de etapa → para etapa, pipeline	✅ (só «para»)	P1 «de»
Leads	Lead atualizada (campo mudou)	campo X mudou / passou a ser Y	⬜	P2
Leads	Lead ganha / perdida	motivo de perda	🟡 via etapa	P2 atalho
Leads	Lead sem atividade há N dias	etapa, responsável	⬜	P2
Clientes	Cliente criado	tipo, origem	🟡	P1
Clientes	Estado do cliente mudou	de → para	🟡	P1
Clientes	Aniversário / data de um campo do cliente	X dias antes/depois	⬜	P2
Propostas	Proposta criada	valor, responsável	🟡	P1
Propostas	Estado da proposta mudou (enviada, aceite, recusada)	de → para	🟡	P1
Propostas	Proposta enviada sem resposta há N dias	valor	⬜	P2
Propostas	Proposta expira em N dias	—	⬜	P2
Vendas	Venda criada	valor, produto, responsável	🟡	P1
Vendas	Estado da venda mudou	de → para	✅	—
Vendas	Fidelização termina em N dias	produto	⬜ (check-fidelization-alerts existe fora das automações)	P2
Financeiro	Cobrança vence em N dias / hoje / em atraso N dias	N configurável, valor	✅ fixos (2 / 0 / 1–7 / >10)	P1 N livre
Financeiro	Pagamento registado	método, valor	⬜	P1
Financeiro	Fatura/recibo emitido	tipo de documento	🟡 (fluxo de sistema protegido)	P2
Financeiro	Despesa a aprovar / pedido financeiro	—	⬜	P3
Tarefas	Tarefa criada / concluída / em atraso	responsável, tipo	⬜	P2
Agenda	Evento marcado / N horas antes do evento / evento faltado	tipo de evento	⬜	P2
Marketing	Entrou numa lista	lista	✅	—
Marketing	Email aberto / clicado / devolvido (Brevo)	campanha, modelo	⬜ (brevo-webhook existe)	P2
Marketing	Saiu da lista / pediu para não receber	—	⬜	P2 (para supressão)
3.2 Conversas
Gatilho	Estado	Prior.
Mensagem recebida (WhatsApp QR, com buffer e «Só uma vez por número»)	✅	—
Palavra-chave WhatsApp	✅	—
Conversa sem resposta da equipa há N minutos	⬜	P2
Mensagem recebida noutros canais (Meta, email da caixa)	⬜	P3
3.3 Horários (agendados)
O Make agenda o cenário inteiro («dias úteis às 09:00»); o n8n usa o Schedule Trigger com intervalo ou cron. Para um CRM, o útil é agenda + segmento: a cada execução, cada registo que cumpre o filtro é inscrito como um percurso próprio (a reentrada decide se pode repetir).

Gatilho	Exemplo	Estado	Prior.
Agendado — «Todos os dias / dias úteis / semanal / mensal às HH:MM» + entidade + filtro	«Dias úteis às 09:00, leads em ‹Proposta enviada› há mais de 5 dias»	⬜	P1
Data de um registo — «N dias antes/depois de ‹campo de data›»	«7 dias antes do fim da fidelização», «3 dias depois da data da venda»	⬜ (os de cobrança são casos fixos)	P1
Implementação sugerida: um job diário/horário (automation-engine ação schedule, chamado pelo cron que já corre a cada minuto) que lê os fluxos agendados cujo próximo instante passou e chama enroll por registo. O sujeito do percurso para gatilhos de data deve ser determinístico (<flow>:<registo>:<data>), como já se faz em subscription_renewal_due_2d.

3.4 Webhooks de entrada e formulários
Gatilho	Descrição	Estado	Prior.
Formulário submetido (formulários públicos do Senvia)	Filtro por formulário	✅	—
Webhook de entrada	URL própria por automação (/automation-hook/<id> + segredo), com URL de teste que mostra o último pedido no editor e URL de produção só ativo com a automação ativa (como no n8n). Mapeamento dos campos recebidos para nome/email/telefone	⬜	P2
Formulário externo (Meta Lead Ads, site)	Hoje entra via submit-lead mode=webhook como «Lead criada»; basta o filtro por origem	🟡	P1 (filtro)
3.5 Manual
Gatilho	Descrição	Estado	Prior.
Executar manualmente	Botão «Iniciar automação» na ficha da lead/cliente/venda e ação em massa na lista («Inscrever 37 contactos»)	⬜ (só «Testar»)	P2
Chamado por outra automação	Para sub-automações (secção 4.4)	⬜	P3
4. Catálogo de nós
4.1 Lógica
Nó	Comportamento	Inspiração	Estado	Prior.
Condição (Se)	Hoje: 1 regra, Sim/Não. Proposta: várias regras com E/OU (grupos), campos de qualquer entidade do contexto (lead, cliente, venda, proposta, última resposta, variáveis do Otto), operadores por tipo (texto, número, data «há mais de N dias», lista «contém algum de»)	IF do n8n, ramo AND/OR do HubSpot	✅ parcial	P1
Dividir por valor (Router)	Um ramo por valor (ex.: por etapa, por origem, por temperatura) ou um ramo por grupo de regras, avaliados por ordem, e ramo «Outros casos» obrigatório	Switch do n8n, Router + fallback do Make, ramo por propriedade do HubSpot	⬜	P1
Filtro (Só continua se…)	Sem ramo «Não»: quem não cumpre termina aqui, com motivo no histórico. Pode também ser posto no próprio fio entre dois passos (ícone de funil), como no Make	Filter do n8n, filtro de rota do Make	⬜	P2
Esperar	Duração fixa	Wait	✅	—
Esperar até data/hora	Até uma data de um campo (± N dias), até ao próximo dia/hora útil («próxima segunda às 10:00», «dias úteis 09–18»)	Delay até data/dia do HubSpot, Wait «at specified time» do n8n	⬜	P1
Esperar até acontecer	Espera por uma condição ou evento (pagou, abriu email, mudou de etapa, respondeu) com prazo e dois ramos: «Aconteceu» / «Prazo esgotado»	Wait until do ActiveCampaign, Wait on webhook do n8n	🟡 (só para resposta WhatsApp)	P1
Objetivo / sair quando	Definido nas Definições da automação (não é um nó no meio): condição que, quando passa a ser verdadeira, termina o percurso (ou salta para um passo marcado). Conta como conversão nas estatísticas	Goals do HubSpot, Jump To do ActiveCampaign	🟡 implícito na cobrança	P1
Dividir A/B	Percentagens (2–5 ramos), cada contacto fica sempre no mesmo ramo; estatística por ramo	Split do ActiveCampaign, random split do HubSpot	⬜	P3
Ir para passo	Volta a um passo anterior com limite de voltas (ex.: «repetir lembrete até 3 vezes») — alternativa segura a loops	Jump To / loop controlado	⬜	P2
Executar outra automação	Inscreve o contacto noutra automação (sub-fluxo reutilizável, ex.: «Notificar equipa»)	Execute Sub-workflow do n8n	⬜	P3
Terminar outra automação	Retira o contacto de outra automação (ex.: ao ganhar a lead, sair da nutrição)	End other automation do ActiveCampaign	⬜	P2
Fim	Termina o caminho	—	✅	—
Loops: não propor um «Para cada item» geral. Casos reais no Senvia («para cada parcela em atraso», «para cada lead parada») resolvem-se com gatilho agendado + inscrição por registo. Se for preciso iterar dentro de um registo (itens de uma venda), oferecer só leitura agregada (ex.: variável {{itens_venda}} em texto) — o Make precisa de Iterator + Aggregator porque trabalha com bundles; o Senvia não.

4.2 Tratamento de erros
Nível	Proposta	Inspiração	Estado	Prior.
Passo	«Tentar outra vez»: N tentativas (1–5) com intervalo (1 min–1 h). Por omissão ligado em WhatsApp, Email e Webhook para erros temporários (timeout, 429, 5xx, WhatsApp desligado)	Retry On Fail do n8n, Retry do Make (3× 15 min)	⬜	P1
Passo	«Se falhar»: Parar o percurso (omissão) · Continuar · Seguir pelo caminho «Erro» (o nó ganha um terceiro conector)	On Error do n8n, error handlers do Make	⬜	P2
Automação	«Quando falhar, avisar»: notificação push + tarefa ao dono da automação, com ligação ao percurso. Resumo diário quando há muitas falhas	Error Workflow do n8n	⬜	P1
Automação	Pausa automática quando a taxa de falhas passa X% em 1 h (ex.: WhatsApp desligado)	Desativação do Make após erros consecutivos	⬜	P2
Percurso	Repetir do passo falhado / desde o início	Incomplete executions do Make, retry do n8n	✅ (retry)	—
Percurso	Repetir em massa («Repetir os 23 percursos falhados hoje»)	—	⬜	P2
4.3 Ações por módulo
Módulo	Ação	Estado	Prior.
Leads	Mudar etapa	✅	—
Atribuir a utilizador (fixo)	✅	—
Atribuir em rotação (round-robin entre membros, ou ao com menos leads abertas)	⬜ (lead-reassign e assigned_user_ids existem fora)	P1
Atualizar campo (temperatura, origem, valor, campo personalizado, etiqueta)	⬜	P1
Marcar como perdida (com motivo)	⬜	P2
Criar lead (a partir de mensagem/webhook)	⬜	P2
Vendas	Mudar estado da venda	⬜	P2
Criar venda a partir da proposta aceite	⬜	P3
Propostas	Enviar proposta por email (send-proposal-email)	⬜	P2
Mudar estado / marcar como expirada	⬜	P3
Clientes	Converter lead em cliente	⬜	P2
Atualizar campo do cliente	⬜	P2
Financeiro	Enviar lembrete de pagamento com link (MB Way/Stripe se existir)	🟡 via email	P2
Emitir fatura/recibo (issue-invoice, generate-receipt)	🟡 só no fluxo de sistema	P3
Marcar cobrança como «em contencioso» / suspender serviço da recorrência	⬜	P3
WhatsApp	Enviar mensagem / anexo / botões + aguardar resposta	✅	—
Enviar modelo aprovado (API oficial Meta, fora da janela de 24 h)	⬜	P2
Atribuir a conversa / fechar conversa na Caixa de Entrada	⬜	P2
Email	Enviar email (modelo ou conteúdo)	✅	—
Aguardar abertura / clique / resposta (ramos)	⬜	P2
Enviar ao responsável (notificação interna por email)	⬜	P1
Marketing	Adicionar a lista	✅	—
Remover de lista	⬜	P1
Tarefas	Criar tarefa (título, prazo em dias, responsável)	✅	—
Prazo em minutos/horas (speed-to-lead), prioridade, ligação ao registo	⬜	P1
Concluir tarefas abertas do registo	⬜	P3
Agenda	Criar evento/reunião	⬜	P2
Enviar lembrete N horas antes de um evento	⬜ (via gatilho de agenda)	P2
Equipa	Notificar utilizador (push + sino; mensagem interna)	⬜ (send-push-notification existe)	P1
Publicar no Feed	⬜	P3
Otto (IA)	Classificar texto (intenção, temperatura, sentimento) → variável usável em Condição/Router	⬜	P2
Resumir conversa/lead para a tarefa ou notificação	⬜	P2
Redigir resposta (rascunho para aprovação, ou envio direto só com confirmação explícita nas definições)	⬜	P3
Extrair dados (nome, email, NIF, interesse) da mensagem para campos da lead	⬜	P2
Integrações	Webhook (HTTP)	✅	—
Meta CAPI: enviar evento de conversão	⬜ (meta-capi-event existe)	P3
Notas sobre o Otto: o Otto corre só por OpenClaw/GPT (nunca Gemini); se o passo falhar, deve falhar à vista com o motivo e seguir o tratamento de erros do passo. Os resultados ficam no contexto ({{otto.intencao}}, {{otto.resumo}}) e aparecem na coluna Saída do detalhe do passo.

4.4 Variáveis
✅ Hoje: {{nome}}, {{primeiro_nome}}, {{email}}, {{telefone}}, {{empresa}}, {{ultima_resposta}}, variáveis de cobrança/indicações.

Propostas (P1–P2):

agrupar por origem no seletor de chips: Contacto · Registo (lead/venda/proposta) · Responsável · Organização · Passos anteriores · Otto;
valores por omissão: {{primeiro_nome | "olá"}} para não enviar «Olá ,»;
formatação simples: data por extenso, moeda em euros;
aviso no editor quando uma mensagem usa uma variável que o gatilho não fornece.
5. Exemplos de fluxos completos
Notação: → passo seguinte; ⟂ ramos; ‖ caminhos paralelos. Cada exemplo indica os nós em falta (⬜) de que depende.

5.1 Lead nova → resposta em minutos → qualificação
Objetivo: responder em menos de 5 minutos (ver HBR/InsideSales na secção 8).

Gatilho: Lead criada · Só quando origem ≠ "importação"
→ Atribuir em rotação (Comerciais)                         ⬜ P1
‖ Notificar responsável: "Nova lead: {{nome}} ({{origem}})" ⬜ P1
‖ Enviar WhatsApp: "Olá {{primeiro_nome}}, obrigado pelo contacto! O que procura?"
     Aguardar resposta 2 h · botões: [Orçamento] [Informações] [Falar com alguém]
     ⟂ Orçamento     → Mudar etapa "Qualificada" → Criar tarefa "Ligar a {{nome}}" prazo 30 min
     ⟂ Informações   → Enviar Email (modelo "Apresentação") → Adicionar a lista "Nutrição"
     ⟂ Falar         → Criar tarefa "Ligar já" prazo 15 min, prioridade alta
     ⟂ Sem resposta  → Criar tarefa "Ligar a {{nome}} (sem resposta ao WhatsApp)" prazo 1 h
Definições: horário de silêncio 21:00–09:00; reentrada: uma só vez.
5.2 Lead respondeu? (versão por condição, sem botões)
Gatilho: Lead criada · temperatura = quente
→ Enviar WhatsApp "…" (sem aguardar)
→ Esperar até acontecer: "Contacto respondeu" · prazo 4 h      ⬜ P1
     ⟂ Aconteceu      → Otto: classificar intenção              ⬜ P2
                          → Router por {{otto.intencao}}         ⬜ P1
                              ⟂ comprar   → Tarefa "Enviar proposta" 2 h
                              ⟂ dúvida    → Notificar responsável com {{otto.resumo}}
                              ⟂ Outros casos → Tarefa "Ver conversa"
     ⟂ Prazo esgotado → Enviar Email "Tentámos falar consigo…" → Tarefa "Ligar" 1 dia
5.3 Nutrição de lead morna (sequência com saída)
Gatilho: Entrou na lista "Nutrição"
Objetivo (Definições): sai quando a etapa for "Proposta" ou "Ganha"     ⬜ P1
→ Esperar até próximo dia útil 10:00                                    ⬜ P1
→ Email 1 "Como funciona"         → Esperar 3 dias
→ Email 2 "Caso de cliente"       → Esperar 4 dias
→ Condição: abriu algum email da sequência?                             ⬜ P2
     ⟂ Sim → WhatsApp "Posso ajudar a avançar?" aguardar 1 dia
               ⟂ Sim → Mudar etapa "Qualificada" → Tarefa "Ligar" 2 h → Remover da lista "Nutrição"
               ⟂ Sem resposta → continuar
     ⟂ Não → continuar
→ Email 3 "Oferta / prova social" → Esperar 7 dias
→ Condição: etapa ainda "Nova"? Sim → Mudar etapa "Fria" · Adicionar a "Reativar em 90 dias"
5.4 Proposta enviada sem resposta
Gatilho: Estado da proposta mudou · para "Enviada"                    🟡 P1
Objetivo: sai quando a proposta for "Aceite" ou "Recusada"            ⬜ P1
→ Esperar 2 dias úteis                                                ⬜ P1
→ Email "Teve oportunidade de ver a proposta {{proposta_codigo}}?"
→ Esperar 3 dias
→ Tarefa "Ligar sobre a proposta ({{proposta_valor}} €)" prazo 1 dia, responsável da proposta
→ Esperar até 2 dias antes da validade                                ⬜ P2
→ WhatsApp "A proposta expira a {{proposta_validade}}…"
5.5 Cobrança: lembrete → vencimento → atraso → escalada
Baseado nas boas práticas de dunning (lembretes que começam antes do vencimento, urgência crescente e paragem imediata quando o pagamento entra).

Gatilho: Data de um registo · 3 dias antes de "Data de vencimento" da cobrança   ⬜ P1
         (substitui os 4 gatilhos fixos; estes ficam como atalhos)
Objetivo: sai quando a cobrança for paga                                         🟡→✅ P1
→ Email "A sua mensalidade de {{valor}} vence a {{data_vencimento}}"
→ Esperar até "Data de vencimento" 09:00                                         ⬜ P1
→ WhatsApp "Hoje vence {{valor}}. Referência: …"
→ Esperar 3 dias
→ Email "Pagamento em atraso há {{dias_em_atraso}} dias"
→ Esperar 4 dias
→ WhatsApp com botões [Já paguei] [Preciso de ajuda] · aguardar 2 dias
     ⟂ Já paguei       → Tarefa "Confirmar pagamento de {{nome}}" prazo 1 dia → Fim
     ⟂ Preciso de ajuda → Notificar responsável · Tarefa "Negociar plano" prazo 1 dia → Fim
     ⟂ Sem resposta    → Esperar 7 dias
                          → Tarefa "Contactar por telefone (atraso 14 dias)" ao financeiro
                          → Notificar gestor
                          → (opcional) Marcar "em contencioso"                     ⬜ P3
O que já existe: checkBillingPayment volta a verificar o pagamento antes de agir e termina o percurso se estiver pago — o comportamento certo. A proposta é torná-lo visível e configurável como Objetivo, e aplicá-lo a todos os passos (hoje está no webhook e nos nós de envio dos gatilhos de cobrança).

5.6 Pós-venda: boas-vindas e avaliação
Gatilho: Venda criada · Só quando estado = "Ativa"                   🟡 P1
‖ Email "Bem-vindo, {{primeiro_nome}}" (modelo)
‖ Tarefa "Onboarding de {{empresa}}" prazo 2 dias, responsável da venda
→ Esperar 14 dias
→ WhatsApp "De 1 a 5, como está a correr?" botões [1-2] [3] [4-5] · aguardar 3 dias
     ⟂ 1-2 → Notificar responsável · Tarefa "Ligar — cliente insatisfeito" 1 dia
     ⟂ 3   → Tarefa "Perguntar o que melhorar" 3 dias
     ⟂ 4-5 → WhatsApp "Obrigado! Indicaria a um amigo? {{link_indicacao}}"
     ⟂ Sem resposta → Fim
5.7 Lembrete de reunião e falta
Gatilho: Agenda · 24 h antes do evento · tipo "Reunião comercial"     ⬜ P2
→ WhatsApp "Confirma a reunião amanhã às {{evento_hora}}?" [Confirmo] [Remarcar] · aguardar 12 h
     ⟂ Confirmo → Esperar até 1 h antes do evento → WhatsApp "Até já! {{evento_link}}"
     ⟂ Remarcar → Tarefa "Remarcar reunião com {{nome}}" 2 h · Notificar responsável
     ⟂ Sem resposta → Tarefa "Confirmar reunião por telefone" 2 h
5.8 Reativar leads paradas (agendado)
Gatilho: Agendado · dias úteis 09:00 · Leads em etapa "Contactada" sem atividade há 10 dias   ⬜ P1
Reentrada: depois de terminar (com 30 dias de intervalo mínimo)                              ⬜ P2
→ Dividir A/B 50/50                                                                          ⬜ P3
     ⟂ A → WhatsApp "Ainda faz sentido falarmos?" aguardar 2 dias
     ⟂ B → Email "Novidades para {{empresa}}"
→ Condição: respondeu?
     ⟂ Sim → Mudar etapa "Em conversa" · Tarefa ao responsável
     ⟂ Não → Marcar como perdida "sem resposta"                                              ⬜ P2
5.9 Tratamento de erros (exemplo de configuração)
Automação "Lead nova → resposta" · Definições → Quando falhar:
   • Notificar o dono da automação + criar tarefa                  ⬜ P1
   • Pausar se > 20% dos percursos falharem em 1 h                 ⬜ P2
Passo "Enviar WhatsApp" → Tentar outra vez: 3× a cada 5 min        ⬜ P1
                         → Se falhar: seguir pelo caminho «Erro»   ⬜ P2
                              → Enviar Email (mesmo conteúdo) → Tarefa "WhatsApp desligado?"
6. Recomendações para o editor
6.1 Criação
Começar por um objetivo, não por um gatilho. O ecrã «Nova automação» mostra 6 objetivos (Responder rápido a leads · Qualificar · Nutrir · Seguir propostas · Cobrar · Pós-venda) com 2–4 modelos cada, mais «Começar do zero». Hoje «Usar modelo» é um botão secundário.
Modelos com campos por preencher. Ao usar um modelo, os passos que precisam de escolha (lista, modelo de email, responsável, caixa de WhatsApp) aparecem com contorno de aviso e um contador «3 passos por configurar»; Ativar fica bloqueado até estarem preenchidos (como os placeholders dos templates do HubSpot e o assistente de mapeamento das receitas do ActiveCampaign).
Assistente de 3 perguntas opcional: «Quando começa?», «Para quem?» (filtro), «O que deve acontecer primeiro?» — gera o esqueleto no canvas.
6.2 Canvas
Gatilho com resumo legível: «Quando uma lead é criada · só se a origem for Facebook e a temperatura for quente».
Filtro no fio (ícone de funil entre dois passos), como no Make, para quem não quer um nó de condição inteiro.
Ramos com nome e cor; o Router mostra os ramos pela ordem de avaliação e o «Outros casos» sempre em último.
Contadores ao vivo em cada passo (n.º de percursos que passaram, que estão à espera aqui, que falharam) — clicar abre a lista de contactos desse passo. É o que mais ajuda a perceber um funil.
Notas/agrupamentos (sticky notes do n8n) para explicar partes do fluxo.
Copiar/colar passos entre automações e duplicar ramo.
6.3 Configuração de um passo
Manter o detalhe em ecrã inteiro Entrada · Parâmetros · Saída (já ✅). Acrescentar «Executar este passo» com os dados da última execução (execução parcial do n8n) para testar uma mensagem ou condição sem correr o fluxo todo.
Aba «Definições do passo»: Tentar outra vez, Se falhar, Notas.
Pré-visualização de mensagens com os dados de um contacto real (WhatsApp em balão, email renderizado).
6.4 Validação antes de ativar
Painel «Verificar» que lista problemas, cada um com ligação ao passo:
passo sem configuração obrigatória;
ramo sem destino (aviso, não erro);
variável não fornecida pelo gatilho;
sequência com envios e sem Objetivo nem condição de saída;
espera de resposta sem caminho «Sem resposta»;
envio sem horário de silêncio;
ciclo sem limite de voltas.
Ativar mostra quantos contactos podem entrar já (para gatilhos agendados/de data) e pede confirmação: «Ao ativar, 34 cobranças em atraso entram já nesta automação. Continuar?».
6.5 Execuções e depuração
Lista de execuções com filtros (estado, contacto, data, passo onde parou).
«Abrir no editor» a partir de uma execução: o canvas destaca o caminho seguido e mostra os dados de cada passo (Debug in editor do n8n).
Repetir em massa os percursos falhados depois de corrigir a causa.
Versões: guardar uma versão a cada ativação, com «Ver alterações» e «Repor esta versão»; percursos em curso continuam na versão em que entraram (o campo flow_version já existe).
6.6 Métricas por automação
Inscritos, ativos, concluídos, falhados, objetivo atingido (taxa de conversão), tempo médio até ao objetivo; por ramo no A/B.
7. Plano por fases
Fase 1 — Lógica essencial e segurança (P1)
Tudo sobre o motor atual; sem novos conceitos de execução.

Entrega	Onde mexe
Voltar a oferecer gatilhos de cliente, proposta e venda criada (já suportados)	TRIGGER_TYPES, TRIGGER_GROUPS
Filtro de entrada «Só quando…» em todos os gatilhos (reutiliza a condição)	trigger_config.filters, handleEnroll
Condição com várias regras E/OU	nó condition (retrocompatível: 1 regra = formato atual)
Router com «Outros casos»	novo nó router
Esperar até data/hora e até dia/hora útil	nó wait (novos modos)
Esperar até acontecer (pagou, mudou de etapa, respondeu) com prazo	novo nó wait_until; reavaliado no tick e nos eventos já despachados
Objetivo de saída por automação	automation_flows.goal + verificação em advance/tick (generaliza checkBillingPayment)
Gatilho «Data de um registo» (N dias antes/depois) e «Agendado + segmento»	ação schedule no cron existente
Ações: atribuir em rotação, atualizar campo, remover de lista, notificar utilizador, tarefa com prazo em minutos/horas	automation-engine
Tentar outra vez por passo + «Quando falhar, avisar»	advance, automation_run_steps
Corrigir leads.automation_enabled	notify_automation_trigger
Painel «Verificar» antes de ativar	editor
Fase 2 — Módulos e canais (P2)
Entrega
Gatilhos: lead atualizada, sem atividade há N dias, propostas sem resposta/expiração, tarefas, agenda, eventos de email (Brevo), conversa sem resposta da equipa, fidelização
Webhook de entrada com URL de teste e de produção
Email com «aguardar abertura/clique/resposta»
Ações de propostas, clientes, vendas, agenda, WhatsApp (modelos Meta, atribuir conversa)
Otto: classificar, resumir, extrair dados
«Se falhar → caminho Erro», pausa automática, repetir em massa
Filtro no fio, contadores ao vivo nos passos, «Executar este passo»
Ir para passo (com limite), Terminar outra automação
Iniciar manualmente / em massa a partir das listas
Fase 3 — Otimização e escala (P3)
Entrega
Dividir A/B com estatísticas por ramo
Sub-automações («Executar outra automação»)
Otto: redigir resposta (rascunho com aprovação)
Ações financeiras (emitir documento, contencioso), Meta CAPI
Versões com comparação e reposição
Galeria alargada (~20 modelos) e partilha de modelos entre organizações da Senvia Agency
Modelos prontos propostos (galeria)
Objetivo	Modelo	Existe
Responder rápido	Boas-vindas a nova lead	✅
Lead nova → rotação → WhatsApp → tarefa (5.1)	⬜
Palavra-chave da campanha	✅
Qualificar	Qualificar lead por conversa	✅
Classificar mensagem com o Otto (5.2)	⬜
Nutrir	Recuperar lead que não respondeu	✅
Nutrição em 3 emails com saída (5.3)	⬜
Reativar leads paradas (5.8)	⬜
Propostas	Seguimento de proposta enviada (5.4)	⬜
Cobrar	Cobrança vence em 2 dias / hoje / em atraso	✅ (3 modelos separados)
Sequência completa de cobrança com escalada (5.5)	⬜
Pós-venda	Lead ganha — boas-vindas	✅
Onboarding + avaliação (5.6)	⬜
Agenda	Confirmação e lembrete de reunião (5.7)	⬜
Equipa	Alerta interno de falhas / lead quente sem dono	⬜
8. Fontes
Consultadas a 2026-11-04. Marcadas com * as secundárias (não documentação do fabricante).

n8n

Schedule Trigger — https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.scheduletrigger/
Webhook (URL de teste e de produção) — https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/
Form Trigger — https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.formtrigger/
Trigger nodes — https://docs.n8n.io/integrations/builtin/trigger-nodes/
IF — https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.if/
Switch (fallback) — https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.switch/
Filter — https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.filter/
Merge — https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.merge/
Loop Over Items — https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.splitinbatches/
Wait (tempo, data, webhook, formulário) — https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.wait/
Sub-workflows — https://docs.n8n.io/flow-logic/subworkflows/ · https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.executeworkflow/
Error handling / Error Trigger / Stop and Error — https://docs.n8n.io/flow-logic/error-handling/ · https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.errortrigger/ · https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.stopanderror/
Definições do nó (Retry On Fail, On Error) — https://docs.n8n.io/workflows/components/nodes/
Depurar execuções — https://docs.n8n.io/build/understand-workflows/understand-executions/debug-executions
Pin data — https://docs.n8n.io/build/work-with-data/pin-and-mock-data
Galeria de workflows — https://n8n.io/workflows/
Make

Tipos de módulos (instant vs polling, iterators, aggregators, routers) — https://help.make.com/types-of-modules
Webhooks — https://help.make.com/webhooks
Router e rota de fallback — https://help.make.com/router
Iterator — https://help.make.com/iterator · Aggregator — https://help.make.com/aggregator
Agendar um cenário — https://help.make.com/schedule-a-scenario
Error handlers — https://help.make.com/error-handlers · https://www.make.com/en/help/errors/directives-for-error-handling
Retry e incomplete executions — https://help.make.com/retry-error-handler · https://help.make.com/incomplete-executions · https://help.make.com/automatic-retry-of-incomplete-executions
Data stores — https://help.make.com/data-stores
Templates — https://www.make.com/en/templates
HubSpot

Inscrição e reentrada, supressão — https://knowledge.hubspot.com/workflows/manage-workflow-enrollment-settings
Ações, ramos e delays — https://knowledge.hubspot.com/workflows/choose-your-workflow-actions
Delay até dia/hora — https://knowledge.hubspot.com/workflows/delay-a-workflow-until-a-day-or-time
Goals — https://knowledge.hubspot.com/workflows/use-goals-in-contact-based-workflows
Unenrollment (negócios, empresas) — https://knowledge.hubspot.com/workflows/set-unenrollment-triggers-in-company-deal-ticket-quote-based-workflows
Templates — https://knowledge.hubspot.com/workflows/create-workflows
ActiveCampaign

Start triggers (runs once / multiple) — https://help.activecampaign.com/hc/en-us/articles/218788707 · https://help.activecampaign.com/hc/en-us/articles/115000299724
Wait / Wait until — https://help.activecampaign.com/hc/en-us/articles/360000150610
If/Else e End automation — https://help.activecampaign.com/hc/en-us/articles/218251828
Goals / Jump To — https://help.activecampaign.com/hc/en-us/articles/218813777 · https://help.activecampaign.com/hc/en-us/articles/5092567789212
Split — https://help.activecampaign.com/hc/en-us/articles/115001957624
Recipes — https://help.activecampaign.com/hc/en-us/articles/360013630199
Pipedrive

Workflow Automation (gatilhos, condições, ações, limites) — https://support.pipedrive.com/en/article/workflow-automation
Delays — https://support.pipedrive.com/en/article/workflow-automations-delay-feature
Condições de email — https://support.pipedrive.com/en/article/automations-email-conditions
Novidades e modelos — https://www.pipedrive.com/en/blog/automations-product-update
Boas práticas

Oldroyd, McElheran, Elkington, «The Short Life of Online Sales Leads», HBR, 2011 — https://hbr.org/2011/03/the-short-life-of-online-sales-leads
*Lead Response Management Study (InsideSales/Oldroyd, 2007), resumo — https://www.cmswire.com/cms/customer-experience/insidesalescom-report-advises-quick-response-time-of-online-leads-equals-sales-021037.php
Stripe Smart Retries — https://docs.stripe.com/billing/revenue-recovery/smart-retries
Recurly, Dunning 101 — https://docs.recurly.com/recurly-subscriptions/docs/navigate-retain-dunning-101
*Cadência de emails de cobrança — https://customer.io/blog/invoice-emails/ · https://churnkey.co/blog/stripe-dunning/
Notas de fiabilidade: algumas páginas não foram abertas na íntegra (Split da ActiveCampaign devolveu 403; a página de definições de nó do n8n segue o padrão oficial). A Make renomeou recentemente parte dos error handlers (aparecem «Skip» e «Retry» em vez de «Ignore» e «Break»).