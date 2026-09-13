import { userRateLimit } from '../_shared/user-rate-limit.ts';
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";
import { ipDoPedido, rateLimitDb, respostaLimiteExcedido } from "../_shared/security.ts";
import { paidQuota } from "../_shared/paid-quota.ts";
import { boundedJson, ottoInput } from "../_shared/paid-input.ts";
import { requestMfaResponse } from "../_shared/user-authorization.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `IDENTIDADE: És o Otto, a Inteligência Artificial de suporte interno do Senvia OS. O teu objetivo é ajudar os utilizadores a navegarem no sistema, configurarem módulos e resolverem dúvidas técnicas de forma rápida e autónoma. És profissional, direto, altamente eficiente e educado. Não usas jargão técnico desnecessário. Não fazes conversa fiada. Falas sempre em Português de Portugal (PT-PT).

CAPACIDADE DE ACESSO A DADOS:
Tens acesso à base de dados da organização do utilizador autenticado. Podes pesquisar clientes, leads, faturas, vendas, propostas, eventos da agenda e obter resumos financeiros e do pipeline.

REGRAS DE ACESSO A DADOS (OBRIGATÓRIAS — VIOLAÇÃO = ERRO CRÍTICO):
- Responde EXCLUSIVAMENTE com dados retornados pelas ferramentas. Zero exceções.
- Se uma ferramenta retornar erro ou zero resultados, diz EXATAMENTE: "Não encontrei resultados para [termo pesquisado]." e sugere termos alternativos. PONTO FINAL. Não acrescentes dados inventados.
- NUNCA inventes nomes de clientes, referências, valores, datas ou qualquer outro dado.
- NUNCA "suponhas" dados. Se não tens resultados reais, NÃO os fabricas.
- Se o utilizador perguntar algo que exige dados e não tens ferramentas disponíveis, diz que não tens acesso a essa informação.
- Quando mostras dados, eles TÊM de vir diretamente do resultado da ferramenta executada. Cada nome, cada valor, cada referência TEM de existir no JSON retornado pela ferramenta.
- Se uma ferramenta retornar um campo "_instruction", segue essa instrução à letra.
- Faz SEMPRE perguntas de clarificação antes de pesquisar (ex: "Qual o nome do cliente?", "Quer procurar por referência ou nome?").
- Quando encontras resultados, formata-os de forma clara com **negrito** e listas.
- Se não encontras resultados, sugere termos alternativos ou ortografias diferentes.
- Quando mostras registos, inclui links de navegação para a página relevante.
- Limita as pesquisas — não faças queries desnecessárias.

REFORÇO ANTI-ALUCINAÇÃO (repete-se intencionalmente):
- É PROIBIDO inventar registos. Se pesquisaste e não encontraste, a resposta é "Não encontrei".
- É PROIBIDO preencher lacunas com dados fictícios. Dados fictícios = erro grave.
- Cada dado que apresentas ao utilizador TEM de ter origem verificável numa ferramenta executada nesta conversa.

FLUXO OBRIGATÓRIO (segue SEMPRE estes 4 passos):

1. INTERPRETAÇÃO: Analisa a intenção do utilizador e mapeia-a para os módulos do Senvia OS.

2. CLARIFICAÇÃO (BOTÕES): Nunca dês a resposta completa logo de imediato. Se precisas de mais contexto, responde com uma frase curta e gera 2 a 3 opções (botões) para o utilizador escolher o cenário exato. Formato: [botao:Texto do botão]
   EXCEÇÃO: Se o utilizador já deu informação suficiente para pesquisar (ex: "mostra a fatura do cliente João Silva"), usa diretamente a ferramenta sem pedir clarificação adicional.

3. INSTRUÇÃO PASSO-A-PASSO: Quando o utilizador escolhe uma opção, fornece instruções em lista numerada, sendo extremamente preciso com os nomes dos menus (ex: "Definições > Integrações > Brevo").

4. FRONTEIRA DE CONHECIMENTO: Se a pergunta não tem a ver com o Senvia OS, responde: "Sou o Otto, o assistente técnico do Senvia OS. Apenas consigo ajudar com dúvidas sobre a utilização desta plataforma."

EXEMPLOS DE INTERAÇÃO COM DADOS:

Utilizador: "Preciso da fatura do cliente João"
Otto: (usa ferramenta search_invoices com query "João")
Se encontrar: "Encontrei as faturas do cliente João Silva:
- **FT 2024/152** — 1.500,00 € — Paga — 15/01/2024
- **FT 2024/187** — 800,00 € — Pendente — 22/02/2024"
[link:Ver Faturas|/financeiro/faturas]
[botao:Procurar outra fatura]

Utilizador: "Quantos leads tenho este mês?"
Otto: (usa ferramenta get_pipeline_summary)
Mostra resumo com contagens por etapa.
[link:Ver Pipeline|/leads]

LINKS DE NAVEGAÇÃO:
Sempre que a resposta envolver uma ação ou página específica do sistema, INCLUI um link direto usando o formato: [link:Texto do botão|/caminho]

MAPA DE ROTAS COMPLETO:
- /dashboard → Painel principal
- /leads → Pipeline de Leads (Kanban + vista de tabela)
- /prospects → Prospects / Prospecção
- /clients → Clientes
- /calendar → Agenda
- /proposals → Propostas
- /sales → Vendas
- /financeiro → Financeiro (visão geral)
- /financeiro/pagamentos → Pagamentos
- /financeiro/faturas → Faturas
- /financeiro/despesas → Despesas
- /financeiro/pedidos → Pedidos Internos
- /marketing → Marketing (visão geral)
- /marketing/templates → Templates de Email
- /marketing/lists → Listas de Contactos
- /marketing/campaigns → Campanhas
- /marketing/reports → Relatórios de Marketing
- /ecommerce → E-commerce (visão geral)
- /ecommerce/products → Produtos
- /ecommerce/orders → Encomendas
- /ecommerce/customers → Clientes E-commerce
- /ecommerce/inventory → Inventário
- /ecommerce/discounts → Descontos
- /ecommerce/reports → Relatórios E-commerce
- /settings → Definições

ROTAS PÚBLICAS (não requerem autenticação):
- /f/:slug → Formulário público de captação de leads
- /c/:slug → Formulário conversacional de captação de leads
- /install → Instalação PWA

CONHECIMENTO DO SISTEMA — FUNCIONALIDADES COMPLETAS:

━━━ LEADS ━━━
- Visualização em Kanban (arrastar entre etapas) e Vista de Tabela (alternável no canto superior direito)
- Importar leads em lote: botão "Importar" na página de Leads → CSV ou Excel, mapeamento de colunas, escolha da etapa do pipeline e distribuição por comerciais
- Criar lead manualmente: botão "Novo Lead"
- Filtros: por etapa, comercial, temperatura, data
- Ações em massa: selecionar múltiplos leads → atribuir comercial, mover etapa, eliminar
- Detalhes do lead: histórico de actividades, propostas, vendas, eventos, notas, anexos

━━━ PROSPECTS / PROSPECÇÃO ━━━
- Módulo de prospecção para pesquisar e qualificar potenciais clientes
- Converter prospect em lead diretamente
- Importar prospects em lote (CSV/Excel)
- Acesso: menu lateral > Prospects
[link:Ver Prospects|/prospects]

━━━ FORMULÁRIOS DE CAPTURA DE LEADS ━━━
- Geridos em: Definições > Definições Gerais > Formulários
- NÃO estão em Marketing. Marketing é para campanhas de email e templates.
- Cada formulário tem um link público (/f/:slug) e conversacional (/c/:slug)
- Tipos: Formulário clássico ou Formulário conversacional (com IA)
- Configurações por formulário: campos personalizados, etapa do pipeline de destino, atribuição automática de comercial, integração Meta Pixel, mensagem de sucesso personalizada

━━━ PIPELINE DE LEADS ━━━
- Configurar etapas (nome, cor, ordem, etapa final ganho/perdido): Definições > Definições Gerais > Pipeline
- Gerir leads no Kanban: menu lateral > Leads
- As etapas são personalizadas por organização

━━━ CLIENTES ━━━
- Criação manual ou conversão a partir de lead
- Campos customizáveis: Definições > Definições Gerais > Campos > Clientes
- Histórico completo: vendas, faturas, propostas, eventos

━━━ PROPOSTAS ━━━
- Criar proposta a partir de lead ou cliente
- Tipos de proposta configuráveis por organização
- Envio por email diretamente do sistema
- Campos customizáveis: Definições > Definições Gerais > Campos > Propostas

━━━ VENDAS ━━━
- Criar venda a partir de proposta ou diretamente
- Estados da venda configuráveis
- Comissões calculadas automaticamente via Matriz de Comissões
- Campos customizáveis: Definições > Definições Gerais > Campos > Vendas
- Regras de vendas (ex: aprovações, limites): Definições > Definições Gerais > Vendas

━━━ FINANCEIRO ━━━
- Faturas: integração InvoiceXpress ou KeyInvoice, emissão, envio por email, registo de pagamentos
- Pagamentos: rastreamento de recebimentos
- Despesas: registo com categorias configuráveis em Definições > Financeiro > Categorias de Despesas
- Notas de Crédito: processamento e gestão
- Pedidos Internos: sistema de requisições internas (/financeiro/pedidos)
- Configuração fiscal (IVA): Definições > Financeiro > Configuração Fiscal

━━━ AGENDA / CALENDÁRIO ━━━
- Criar e gerir eventos, reuniões, chamadas
- Associar eventos a leads ou clientes
- Alertas de calendário: Definições > Notificações > Calendário

━━━ MARKETING ━━━
- Campanhas de email via Brevo
- Templates de email reutilizáveis
- Listas de contactos segmentadas
- Relatórios de performance de campanhas
- Configurar integração Brevo: Definições > Integrações > Brevo

━━━ E-COMMERCE ━━━
- Catálogo de produtos com inventário
- Gestão de encomendas
- Clientes de e-commerce
- Controlo de inventário
- Descontos e promoções
- Relatórios de vendas e-commerce

━━━ CAMPOS CUSTOMIZÁVEIS ━━━
- Cada módulo tem campos personalizáveis: Leads, Clientes, Propostas, Vendas
- Gerir em: Definições > Definições Gerais > Campos
- Tipos de campo: texto, número, data, lista de opções, checkbox

━━━ COMISSÕES ━━━
- Matriz de comissões (cálculo automático por escalão/meta): Definições > Definições Gerais > Comissões
- Ver comissões calculadas: na página de Vendas
- Importar escalões de comissão via CSV

━━━ EQUIPA E ACESSOS ━━━
- Convidar membros: Definições > Equipa e Acessos
- Perfis de permissão personalizados: Definições > Equipa e Acessos > Perfis
- Hierarquia de equipas com líderes/supervisores: Definições > Equipa e Acessos > Equipas
- Roles disponíveis: Admin, Colaborador, Visualizador

━━━ DEFINIÇÕES GERAIS ━━━
- Dados da organização (nome, logo, dados fiscais): Definições > Definições Gerais > Geral
- Módulos activos/inactivos: Definições > Definições Gerais > Módulos
- Pipeline: Definições > Definições Gerais > Pipeline
- Formulários de captação: Definições > Definições Gerais > Formulários
- Campos customizáveis: Definições > Definições Gerais > Campos
- Regras de vendas: Definições > Definições Gerais > Vendas
- Matriz de comissões: Definições > Definições Gerais > Comissões

━━━ INTEGRAÇÕES ━━━
- WhatsApp Business: Definições > Integrações > WhatsApp
- Brevo (email marketing e envio): Definições > Integrações > Brevo
- InvoiceXpress (faturação): Definições > Integrações > InvoiceXpress
- KeyInvoice (faturação alternativa): Definições > Integrações > KeyInvoice
- Webhooks personalizados (para Make, Zapier, etc.): Definições > Integrações > Webhooks
- URL do webhook de entrada de leads: visível em Definições > Integrações (usar com Make/Zapier para criar leads automaticamente)

━━━ PRODUTOS ━━━
- Catálogo de produtos/serviços da organização: Definições > Produtos
- Usado em propostas e vendas

━━━ NOTIFICAÇÕES ━━━
- Push notifications (browser/PWA): Definições > Notificações > Push
- Alertas de eventos de agenda: Definições > Notificações > Calendário
- Alertas por email: Definições > Notificações > Email
- Alertas de fidelização (renovações CPE/CUI — apenas telecom): Definições > Notificações > Fidelização

━━━ FINANCEIRO — CONFIGURAÇÕES ━━━
- Categorias de despesas: Definições > Financeiro > Categorias de Despesas
- Configuração fiscal (IVA): Definições > Financeiro > Configuração Fiscal

━━━ PLANO E FATURAÇÃO ━━━
- Ver plano, fazer upgrade, gerir subscrição: Definições > Plano e Faturação

━━━ SEGURANÇA ━━━
- Alterar password: Definições > Segurança

━━━ PWA (APLICAÇÃO MÓVEL) ━━━
- O Senvia OS pode ser instalado como app no telemóvel (PWA — Progressive Web App)
- Para instalar: aceder ao sistema pelo browser do telemóvel > menu do browser > "Adicionar ao ecrã inicial" ou "Instalar app"
- Também pode aparecer um banner de instalação automático no sistema
- Após instalação, funciona como uma app nativa

━━━ FUNCIONALIDADES ESPECÍFICAS — TELECOM ━━━
(Apenas visíveis em organizações com nicho "telecom")
- Dashboard com painéis especializados: Compromissos, Ativações, Performance Comercial, Métricas
- Alertas de fidelização CPE/CUI: Definições > Notificações > Fidelização
- Gestão de RH (faltas, férias) dentro do portal
- Portal Total Link (integração Perfect2Gether): menu lateral > Portal Total Link
  - Secções: Home, Contratos, IDs, Pendentes, Reclamações, RH

LIMITAÇÕES (O QUE NÃO PODES FAZER):
- NÃO podes enviar emails, faturas ou documentos.
- NÃO podes descarregar PDFs ou gerar ficheiros.
- NÃO podes criar, editar ou apagar registos (leads, clientes, vendas, faturas).
- NÃO podes executar ações no sistema — apenas PESQUISAR, CONSULTAR dados e SUBMETER TICKETS DE SUPORTE.
- NÃO podes partilhar links externos ou gerar URLs de download.

TICKETS DE SUPORTE — FLUXO OBRIGATÓRIO PASSO-A-PASSO:
Quando o utilizador pedir para abrir um ticket de suporte, segue RIGOROSAMENTE estes passos, UM DE CADA VEZ:

PASSO 1 — ASSUNTO:
Pergunta: "Qual é o assunto do teu ticket? (uma frase curta que resuma o problema)"
Espera pela resposta. NÃO avances para o passo seguinte sem resposta.

PASSO 2 — DESCRIÇÃO:
Pergunta: "Descreve o problema com mais detalhe. O que aconteceu? O que esperavas que acontecesse?"
Espera pela resposta. NÃO avances para o passo seguinte sem resposta.

PASSO 3 — DADOS DE CONTACTO:
Antes de avançar, usa a ferramenta get_my_contact_info para verificar que dados de contacto já existem na base de dados.
Precisas de 3 dados: Nome, WhatsApp e Email.
- Se TODOS os 3 campos já existirem na BD, avança diretamente para o PASSO 4 sem perguntar nada.
- Se algum campo estiver em falta, pergunta UM DE CADA VEZ pela seguinte ordem:
  1. Nome (se em falta): "Qual é o teu nome completo?"
  2. WhatsApp (se em falta): "Qual é o teu número de WhatsApp? (com indicativo, ex: 351912345678)"
  3. Email (se em falta): "Qual é o teu email de contacto?"
NUNCA perguntes mais do que um campo por mensagem.
Guarda os valores recolhidos para incluir no ticket.

PASSO 4 — CONFIRMAÇÃO:
Mostra o resumo completo do ticket:
- **Assunto:** (assunto recolhido)
- **Descrição:** (descrição recolhida)
- **Nome:** (nome)
- **WhatsApp:** (whatsapp)
- **Email:** (email)
Pergunta: "Confirmas o envio deste ticket?"
[botao:Sim, enviar][botao:Editar assunto][botao:Editar descrição]

SÓ após confirmação explícita ("Sim, enviar") é que chamas a ferramenta submit_support_ticket com os campos contact_name, contact_whatsapp e contact_email.
NUNCA saltes passos. NUNCA recolhas assunto e descrição na mesma mensagem.
- Após submissão bem-sucedida, mostra o código do ticket e o botão WhatsApp que o sistema retorna para o utilizador enviar directamente.
- Após submissão, informa SEMPRE: "Podes consultar o estado dos teus tickets em **Definições > Suporte**."
[link:Ver Tickets|/settings]

QUANDO O UTILIZADOR PEDE UMA AÇÃO QUE NÃO PODES EXECUTAR:
- Diz claramente: "Não consigo executar essa ação diretamente."
- Indica EXATAMENTE onde no sistema o utilizador pode fazê-lo, com o caminho do menu.
- Inclui um [link] direto para a página relevante.
- NUNCA inventes botões de interface como "Descarregar PDF" ou "Enviar por Email" na tua resposta — esses botões NÃO EXISTEM no chat.
- NUNCA uses formatação que simule botões clicáveis para ações que não podes executar.

Exemplo correto:
Utilizador: "Envia-me a fatura FT 2026/10 por email"
Otto: "Não consigo enviar faturas diretamente. Para enviar a fatura FT 2026/10 por email:
1. Aceda a **Financeiro > Faturas**
2. Localize a fatura **FT 2026/10**
3. Clique no menu de opções (três pontos) e selecione **Enviar por Email**"
[link:Ir para Faturas|/financeiro/faturas]

REGRAS DE FORMATAÇÃO:
- Máximo 200 palavras por resposta
- 2 a 4 botões por resposta (formato: [botao:Texto])
- Inclui SEMPRE pelo menos 1 link quando a resposta se refere a uma página específica
- Usa markdown: **negrito**, listas numeradas
- Máximo 1-2 emojis por resposta
- Sê extremamente preciso nos caminhos dos menus
- NUNCA comeces a resposta com afirmações ou validações como "Claro!", "Com certeza!", "Sem problema!", "Entendido!", "Boa pergunta!", "Ótima escolha!", "Perfeito!", "Excelente!". Vai direto ao assunto sem preâmbulos.`;

// ─── Tool Definitions ───
const TOOLS = [
  {
    type: "function",
    function: {
      name: "search_clients",
      description: "Procurar clientes por nome, email, NIF ou empresa. Retorna até 10 resultados.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Termo de pesquisa (nome, email, NIF ou empresa)" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_leads",
      description: "Procurar leads por nome, email ou telefone. Retorna até 10 resultados.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Termo de pesquisa (nome, email ou telefone)" },
          status: { type: "string", description: "Filtrar por status/etapa do pipeline (opcional)" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_invoices",
      description: "Procurar faturas por referência ou nome do cliente. Retorna até 10 resultados.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Referência da fatura ou nome do cliente" },
          status: { type: "string", description: "Filtrar por status: final, sent, settled, canceled (opcional)" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_sales",
      description: "Procurar vendas por código ou nome do cliente. Retorna até 10 resultados.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Código da venda ou nome do cliente" },
          payment_status: { type: "string", description: "Filtrar por estado: pending, partial, paid (opcional)" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_proposals",
      description: "Procurar propostas por código ou nome do cliente. Retorna até 10 resultados.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Código da proposta ou nome do cliente" },
          status: { type: "string", description: "Filtrar por status: draft, sent, accepted, rejected (opcional)" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_client_details",
      description: "Obter detalhes completos de um cliente específico por ID.",
      parameters: {
        type: "object",
        properties: {
          client_id: { type: "string", description: "UUID do cliente" },
        },
        required: ["client_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_sale_details",
      description: "Obter detalhes de uma venda específica incluindo pagamentos.",
      parameters: {
        type: "object",
        properties: {
          sale_id: { type: "string", description: "UUID da venda" },
        },
        required: ["sale_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_pipeline_summary",
      description: "Obter resumo do pipeline de leads: contagem por etapa e total.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_finance_summary",
      description: "Obter resumo financeiro de um período: total faturado, recebido, pendente, despesas e balanço. Se não forem fornecidas datas, usa o mês atual.",
      parameters: {
        type: "object",
        properties: {
          start_date: { type: "string", description: "Data início no formato YYYY-MM-DD (opcional, default: início do mês atual)" },
          end_date: { type: "string", description: "Data fim no formato YYYY-MM-DD (opcional, default: fim do mês atual)" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_upcoming_events",
      description: "Obter próximos eventos da agenda nos próximos N dias.",
      parameters: {
        type: "object",
        properties: {
          days: { type: "number", description: "Número de dias a consultar (default: 7)" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_credit_notes",
      description: "Procurar notas de crédito por referência ou nome do cliente. Retorna até 10 resultados.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Referência da nota de crédito ou nome do cliente" },
          status: { type: "string", description: "Filtrar por status (opcional)" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_my_contact_info",
      description: "Obter os dados de contacto do utilizador atual (nome, email, whatsapp) guardados na base de dados. Usa antes de pedir dados de contacto para o ticket de suporte.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "submit_support_ticket",
      description: "Submeter um ticket de suporte técnico. O sistema cria o ticket e retorna um botão WhatsApp para o utilizador enviar a mensagem directamente. Usa APENAS quando o utilizador confirmar o envio.",
      parameters: {
        type: "object",
        properties: {
          subject: { type: "string", description: "Assunto curto do ticket" },
          description: { type: "string", description: "Descrição detalhada do problema" },
          priority: { type: "string", enum: ["low", "medium", "high"], description: "Prioridade: low, medium, high (default: medium)" },
          contact_name: { type: "string", description: "Nome completo do utilizador que reporta o problema" },
          contact_whatsapp: { type: "string", description: "Número de WhatsApp do utilizador (com indicativo)" },
          contact_email: { type: "string", description: "Email de contacto do utilizador" },
        },
        required: ["subject", "description", "contact_name", "contact_whatsapp", "contact_email"],
      },
    },
  },
];

// ─── Tool Executors ───
async function executeTool(
  toolName: string,
  args: Record<string, any>,
  orgId: string,
  supabaseAdmin: any,
  userId?: string | null
): Promise<string> {
  try {
    switch (toolName) {
      case "search_clients": {
        const { data, error } = await supabaseAdmin
          .rpc("search_clients_unaccent", { org_id: orgId, search_term: args.query, max_results: 10 });
        if (error) return JSON.stringify({ error: error.message, _instruction: "ERRO NA PESQUISA. Informa o utilizador que não foi possível pesquisar. NÃO INVENTES DADOS." });
        const results = (data || []).map((c: any) => ({
          id: c.id, code: c.code, name: c.name, email: c.email, phone: c.phone,
          nif: c.nif, company: c.company, status: c.status, total_sales: c.total_sales, total_value: c.total_value,
        }));
        if (results.length === 0) return JSON.stringify({ results: [], count: 0, _instruction: "ZERO RESULTADOS encontrados. Informa o utilizador que não encontraste clientes com esse termo. NÃO INVENTES DADOS." });
        return JSON.stringify({ results, count: results.length });
      }

      case "search_leads": {
        const { data, error } = await supabaseAdmin
          .rpc("search_leads_unaccent", {
            org_id: orgId, search_term: args.query,
            lead_status: args.status || null, max_results: 10,
          });
        if (error) return JSON.stringify({ error: error.message, _instruction: "ERRO NA PESQUISA. Informa o utilizador que não foi possível pesquisar. NÃO INVENTES DADOS." });
        const results = (data || []).map((l: any) => ({
          id: l.id, name: l.name, email: l.email, phone: l.phone, status: l.status,
          source: l.source, assigned_to: l.assigned_to, created_at: l.created_at, value: l.value,
        }));
        if (results.length === 0) return JSON.stringify({ results: [], count: 0, _instruction: "ZERO RESULTADOS encontrados. Informa o utilizador que não encontraste leads com esse termo. NÃO INVENTES DADOS." });
        return JSON.stringify({ results, count: results.length });
      }

      case "search_invoices": {
        const { data, error } = await supabaseAdmin
          .rpc("search_invoices_unaccent", {
            org_id: orgId, search_term: args.query,
            inv_status: args.status || null, max_results: 10,
          });
        if (error) return JSON.stringify({ error: error.message, _instruction: "ERRO NA PESQUISA. Informa o utilizador que não foi possível pesquisar faturas. NÃO INVENTES DADOS." });
        const results = (data || []).map((i: any) => ({
          id: i.id, invoicexpress_id: i.invoicexpress_id, reference: i.reference,
          client_name: i.client_name, total: i.total, status: i.status,
          date: i.date, due_date: i.due_date, document_type: i.document_type, pdf_path: i.pdf_path,
        }));
        if (results.length === 0) return JSON.stringify({ results: [], count: 0, _instruction: "ZERO RESULTADOS encontrados. Informa o utilizador que não encontraste faturas com esse termo. NÃO INVENTES DADOS." });
        return JSON.stringify({ results, count: results.length });
      }

      case "search_sales": {
        const { data, error } = await supabaseAdmin
          .rpc("search_sales_unaccent", {
            org_id: orgId, search_term: args.query,
            pay_status: args.payment_status || null, max_results: 10,
          });
        if (error) return JSON.stringify({ error: error.message, _instruction: "ERRO NA PESQUISA. Informa o utilizador que não foi possível pesquisar vendas. NÃO INVENTES DADOS." });
        if (!data || data.length === 0) return JSON.stringify({ results: [], count: 0, _instruction: "ZERO RESULTADOS encontrados. Informa o utilizador que não encontraste vendas com esse termo. NÃO INVENTES DADOS." });
        // Enrich with client names
        const clientIds = [...new Set(data.filter((s: any) => s.client_id).map((s: any) => s.client_id))];
        if (clientIds.length > 0) {
          const { data: clients } = await supabaseAdmin
            .from("crm_clients")
            .select("id, name")
            .in("id", clientIds);
          const clientMap = Object.fromEntries((clients || []).map((c: any) => [c.id, c.name]));
          data.forEach((s: any) => { s.client_name = clientMap[s.client_id] || null; });
        }
        return JSON.stringify({ results: data, count: data.length });
      }

      case "search_proposals": {
        const { data, error } = await supabaseAdmin
          .rpc("search_proposals_unaccent", {
            org_id: orgId, search_term: args.query,
            prop_status: args.status || null, max_results: 10,
          });
        if (error) return JSON.stringify({ error: error.message, _instruction: "ERRO NA PESQUISA. Informa o utilizador que não foi possível pesquisar propostas. NÃO INVENTES DADOS." });
        if (!data || data.length === 0) return JSON.stringify({ results: [], count: 0, _instruction: "ZERO RESULTADOS encontrados. Informa o utilizador que não encontraste propostas com esse termo. NÃO INVENTES DADOS." });
        // Enrich with client names
        const propClientIds = [...new Set(data.filter((p: any) => p.client_id).map((p: any) => p.client_id))];
        if (propClientIds.length > 0) {
          const { data: clients } = await supabaseAdmin
            .from("crm_clients")
            .select("id, name")
            .in("id", propClientIds);
          const clientMap = Object.fromEntries((clients || []).map((c: any) => [c.id, c.name]));
          data.forEach((p: any) => { p.client_name = clientMap[p.client_id] || null; });
        }
        return JSON.stringify({ results: data, count: data.length });
      }

      case "get_client_details": {
        const { data, error } = await supabaseAdmin
          .from("crm_clients")
          .select("id, code, name, email, phone, nif, company, company_nif, address_line1, city, postal_code, country, status, total_sales, total_value, total_proposals, notes, created_at")
          .eq("organization_id", orgId)
          .eq("id", args.client_id)
          .maybeSingle();
        if (error) return JSON.stringify({ error: error.message, _instruction: "ERRO NA PESQUISA. NÃO INVENTES DADOS." });
        if (!data) return JSON.stringify({ error: "Cliente não encontrado", _instruction: "Cliente não existe na base de dados. Informa o utilizador. NÃO INVENTES DADOS." });
        return JSON.stringify(data);
      }

      case "get_sale_details": {
        const { data: sale, error } = await supabaseAdmin
          .from("sales")
          .select("id, code, total_value, payment_status, sale_date, notes, client_id, lead_id")
          .eq("organization_id", orgId)
          .eq("id", args.sale_id)
          .maybeSingle();
        if (error) return JSON.stringify({ error: error.message, _instruction: "ERRO NA PESQUISA. NÃO INVENTES DADOS." });
        if (!sale) return JSON.stringify({ error: "Venda não encontrada", _instruction: "Venda não existe na base de dados. Informa o utilizador. NÃO INVENTES DADOS." });
        // Get payments
        const { data: payments } = await supabaseAdmin
          .from("sale_payments")
          .select("id, amount, payment_date, payment_method, status, invoice_reference")
          .eq("sale_id", args.sale_id)
          .eq("organization_id", orgId);
        // Get client name
        if (sale.client_id) {
          const { data: client } = await supabaseAdmin
            .from("crm_clients")
            .select("name")
            .eq("id", sale.client_id)
            .maybeSingle();
          sale.client_name = client?.name || null;
        }
        return JSON.stringify({ sale, payments: payments || [] });
      }

      case "get_pipeline_summary": {
        const { data: stages } = await supabaseAdmin
          .from("pipeline_stages")
          .select("key, label")
          .eq("organization_id", orgId)
          .order("position");
        const { data: leads } = await supabaseAdmin
          .from("leads")
          .select("status")
          .eq("organization_id", orgId);
        const counts: Record<string, number> = {};
        (leads || []).forEach((l: any) => {
          counts[l.status] = (counts[l.status] || 0) + 1;
        });
        const summary = (stages || []).map((s: any) => ({
          stage: s.label,
          key: s.key,
          count: counts[s.key] || 0,
        }));
        return JSON.stringify({ stages: summary, total_leads: leads?.length || 0 });
      }

      case "get_finance_summary": {
        // Calculate date range (default: current month)
        const now = new Date();
        const startDate = args.start_date || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
        const endDateDefault = new Date(now.getFullYear(), now.getMonth() + 1, 0); // last day of current month
        const endDate = args.end_date || `${endDateDefault.getFullYear()}-${String(endDateDefault.getMonth() + 1).padStart(2, '0')}-${String(endDateDefault.getDate()).padStart(2, '0')}`;

        // Sales filtered by sale_date
        const { data: sales } = await supabaseAdmin
          .from("sales")
          .select("id, total_value, sale_date, operational_units")
          .eq("organization_id", orgId)
          .gte("sale_date", startDate)
          .lte("sale_date", endDate);
        const totalBilled = (sales || []).reduce((s: number, r: any) => s + Number(r.total_value || 0), 0);

        // Real payments from sale_payments filtered by payment_date
        const { data: payments } = await supabaseAdmin
          .from("sale_payments")
          .select("amount, status")
          .eq("organization_id", orgId)
          .gte("payment_date", startDate)
          .lte("payment_date", endDate);
        const totalReceived = (payments || []).filter((p: any) => p.status === "paid").reduce((s: number, r: any) => s + Number(r.amount || 0), 0);
        const totalPending = (payments || []).filter((p: any) => p.status === "pending").reduce((s: number, r: any) => s + Number(r.amount || 0), 0);

        // Expenses filtered by expense_date
        const { data: expenses } = await supabaseAdmin
          .from("expenses")
          .select("amount")
          .eq("organization_id", orgId)
          .gte("expense_date", startDate)
          .lte("expense_date", endDate);
        const totalExpenses = (expenses || []).reduce((s: number, r: any) => s + Number(r.amount || 0), 0);

        return JSON.stringify({
          period: { start: startDate, end: endDate },
          total_billed: totalBilled,
          total_received: totalReceived,
          total_pending: totalPending,
          total_expenses: totalExpenses,
          balance: totalReceived - totalExpenses,
          total_sales_count: (sales || []).reduce((sum: number, sale: { operational_units?: number | null }) => sum + Number(sale.operational_units || 1), 0),
        });
      }

      case "get_upcoming_events": {
        const days = args.days || 7;
        const now = new Date().toISOString();
        const future = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
        const { data, error } = await supabaseAdmin
          .from("calendar_events")
          .select("id, title, event_type, start_time, end_time, description, status")
          .eq("organization_id", orgId)
          .gte("start_time", now)
          .lte("start_time", future)
          .order("start_time")
          .limit(10);
        if (error) return JSON.stringify({ error: error.message, _instruction: "ERRO NA PESQUISA. NÃO INVENTES DADOS." });
        if (!data || data.length === 0) return JSON.stringify({ events: [], count: 0, _instruction: "ZERO eventos encontrados no período. Informa o utilizador. NÃO INVENTES DADOS." });
        return JSON.stringify({ events: data, count: data.length });
      }

      case "search_credit_notes": {
        const { data, error } = await supabaseAdmin
          .rpc("search_credit_notes_unaccent", {
            org_id: orgId, search_term: args.query,
            cn_status: args.status || null, max_results: 10,
          });
        if (error) return JSON.stringify({ error: error.message, _instruction: "ERRO NA PESQUISA. Informa o utilizador que não foi possível pesquisar notas de crédito. NÃO INVENTES DADOS." });
        const results = (data || []).map((cn: any) => ({
          id: cn.id, reference: cn.reference, client_name: cn.client_name,
          total: cn.total, status: cn.status, date: cn.date, pdf_path: cn.pdf_path,
        }));
        if (results.length === 0) return JSON.stringify({ results: [], count: 0, _instruction: "ZERO RESULTADOS encontrados. Informa o utilizador que não encontraste notas de crédito com esse termo. NÃO INVENTES DADOS." });
        return JSON.stringify({ results, count: results.length });
      }

      case "get_my_contact_info": {
        // Fetch user's name from profiles
        const { data: contactProfile } = await supabaseAdmin
          .from("profiles")
          .select("full_name")
          .eq("id", userId)
          .single();
        
        // Fetch user's email from auth
        let userEmail: string | null = null;
        try {
          const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(userId!);
          userEmail = authUser?.user?.email || null;
        } catch { /* ignore */ }

        // Check if org has any phone/whatsapp for this user (from organization_members or other sources)
        // For now, we don't store phone on profiles, so it will be null
        const contactName = contactProfile?.full_name || null;
        
        const result: any = {
          name: contactName,
          email: userEmail,
          whatsapp: null, // Not stored in profiles table currently
          missing_fields: [] as string[],
        };
        if (!contactName) result.missing_fields.push("name");
        if (!userEmail) result.missing_fields.push("email");
        result.missing_fields.push("whatsapp"); // Always ask for WhatsApp as it's not stored
        
        return JSON.stringify({
          ...result,
          _instruction: result.missing_fields.length > 0
            ? `Dados encontrados: Nome=${contactName || 'NÃO ENCONTRADO'}, Email=${userEmail || 'NÃO ENCONTRADO'}, WhatsApp=NÃO ENCONTRADO. Pergunta os campos em falta UM DE CADA VEZ.`
            : `Todos os dados de contacto encontrados. Avança para o passo dos anexos.`
        });
      }

      case "submit_support_ticket": {
        const priority = args.priority || "medium";
        
        // Insert ticket (trigger auto-generates ticket_code)
        const { data: ticket, error: ticketError } = await supabaseAdmin
          .from("support_tickets")
          .insert({
            organization_id: orgId,
            user_id: userId,
            subject: args.subject,
            description: args.description,
            priority,
          })
          .select("id, ticket_code, created_at")
          .single();
        
        if (ticketError) {
          console.error("Ticket insert error:", ticketError);
          return JSON.stringify({ error: ticketError.message, _instruction: "ERRO ao criar ticket. Informa o utilizador que houve um problema técnico." });
        }

        // Get org name for WhatsApp message
        const { data: org } = await supabaseAdmin
          .from("organizations")
          .select("name")
          .eq("id", orgId)
          .single();

        const orgName = org?.name || "Desconhecida";
        const createdAt = new Date(ticket.created_at).toLocaleString("pt-PT", { timeZone: "Europe/Lisbon" });
        const contactName = args.contact_name || "Desconhecido";
        const contactWhatsapp = args.contact_whatsapp || "Não fornecido";
        const contactEmail = args.contact_email || "Não fornecido";

        // Build WhatsApp message
        const SUPPORT_WHATSAPP = "351939135114";
        const waMessage = `🎫 *TICKET ${ticket.ticket_code}*\n\n` +
          `*Org:* ${orgName}\n\n` +
          `📞 *DADOS DE CONTACTO:*\n` +
          `*Nome:* ${contactName}\n` +
          `*WhatsApp:* ${contactWhatsapp}\n` +
          `*Email:* ${contactEmail}\n\n` +
          `*Assunto:* ${args.subject}\n` +
          `*Descrição:* ${args.description}\n` +
          `*Prioridade:* ${priority}\n` +
          `*Data:* ${createdAt}`;

        const waUrl = `https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent(waMessage)}`;

        return JSON.stringify({ 
          success: true, 
          ticket_code: ticket.ticket_code,
          whatsapp_url: waUrl,
          _instruction: `Ticket criado com sucesso! Informa o utilizador: "Ticket **${ticket.ticket_code}** registado com sucesso! Clica no botão abaixo para enviar os detalhes ao suporte via WhatsApp." [whatsapp:📩 Enviar Ticket via WhatsApp|${waUrl}]`
        });
      }

      default:
        return JSON.stringify({ error: `Ferramenta desconhecida: ${toolName}` });
    }
  } catch (e) {
    console.error(`Tool ${toolName} error:`, e);
    return JSON.stringify({ error: `Erro ao executar ${toolName}`, _instruction: "ERRO INTERNO na ferramenta. Informa o utilizador que houve um erro técnico. NÃO INVENTES DADOS." });
  }
}

// ─── Main Handler ───
serve(async (req) => {
  if (req.method !== "POST" && req.method !== "OPTIONS") return new Response("Method not allowed", { status: 405 });
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Cada pedido daqui é uma chamada a um modelo de linguagem — o único sítio do
  // produto onde um ciclo deixado a correr se traduz diretamente em fatura.
  // Vinte por minuto é muito mais do que qualquer pessoa escreve a conversar.
  {
    const limitador = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const rl = await rateLimitDb(limitador, `otto-chat:${ipDoPedido(req)}`, 20, 60);
    if (!rl.allowed) {
      console.warn("[otto-chat] limite excedido", { hits: rl.hits });
      return respostaLimiteExcedido(
        rl.retryAfter,
        corsHeaders,
        "Estás a escrever mais depressa do que eu consigo pensar. Espera um pouco.",
      );
    }
  }

  try {
    const parsed = ottoInput.safeParse(await boundedJson(req));
    if (!parsed.success) return new Response(JSON.stringify({ error: "Pedido inválido ou demasiado grande" }), { status: 400, headers: corsHeaders });
    const { messages, organization_id, attachment_paths } = parsed.data;

    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not configured");

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // ── Auth: validate user ──
    const authHeader = req.headers.get("Authorization") || "";
    let orgId = organization_id || null;

    // Create user-scoped client for auth validation
    const supabaseAuth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    let userId: string | null = null;
    if (authHeader.startsWith("Bearer ") && authHeader !== `Bearer ${SUPABASE_ANON_KEY}`) {
      const token = authHeader.replace("Bearer ", "");
      try {
        const { data, error } = await supabaseAuth.auth.getUser(token);
        if (!error && data?.user) {
          userId = data.user.id;
        }
      } catch { /* unauthenticated — tools won't be available */ }
    }

    if (!userId) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    const mfaDenied = await requestMfaResponse(req, userId, corsHeaders);
    if (mfaDenied) return mfaDenied;

    // Create admin client for DB queries
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Validate org membership if we have a user
    if (userId && orgId) {
      const { data: membership } = await supabaseAdmin
        .from("organization_members")
        .select("id")
        .eq("user_id", userId)
        .eq("organization_id", orgId)
        .eq("is_active", true)
        .maybeSingle();

      // Also check super_admin
      if (!membership) {
        const { data: superRole } = await supabaseAdmin
          .from("user_roles")
          .select("id")
          .eq("user_id", userId)
          .eq("role", "super_admin")
          .maybeSingle();
        if (!superRole) {
          orgId = null; // Can't access this org — disable tools
        }
      }
    }

    const hasDataAccess = !!userId && !!orgId;
    if (!hasDataAccess) return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: corsHeaders });
    const limitResponse = await userRateLimit(supabaseAdmin, userId, 'otto', corsHeaders);
    if (limitResponse) return limitResponse;
    if (!await paidQuota(supabaseAdmin, `otto:org:${orgId}`, 300, 86400)) {
      return respostaLimiteExcedido(60, corsHeaders);
    }

    // ── Fetch user permissions for tool filtering ──
    const TOOL_PERMISSION_MAP: Record<string, { module: string; subarea: string; action: string }> = {
      search_clients:       { module: "clients",   subarea: "list",      action: "view" },
      get_client_details:   { module: "clients",   subarea: "list",      action: "view" },
      search_leads:         { module: "leads",     subarea: "kanban",    action: "view" },
      search_invoices:      { module: "finance",   subarea: "invoices",  action: "view" },
      search_sales:         { module: "sales",     subarea: "sales",     action: "view" },
      search_proposals:     { module: "proposals", subarea: "proposals", action: "view" },
      get_sale_details:     { module: "sales",     subarea: "sales",     action: "view" },
      get_pipeline_summary: { module: "leads",     subarea: "kanban",    action: "view" },
      get_finance_summary:  { module: "finance",   subarea: "summary",   action: "view" },
      get_upcoming_events:  { module: "calendar",  subarea: "events",    action: "view" },
      search_credit_notes:  { module: "finance",   subarea: "invoices",  action: "view" },
    };

    function canUseTool(toolName: string, permissions: any, isAdmin: boolean): boolean {
      if (isAdmin) return true;
      const req = TOOL_PERMISSION_MAP[toolName];
      if (!req) return true; // tools not in map are always allowed
      if (!permissions) return false;
      const mod = permissions[req.module];
      if (!mod?.subareas) return false;
      const sub = mod.subareas[req.subarea];
      if (!sub) return false;
      return sub[req.action] === true;
    }

    let userPermissions: Record<string, any> | null = null;
    let isAdminUser = false;

    if (hasDataAccess) {
      // Check admin/super_admin role
      const { data: adminRole, error: adminError } = await supabaseAdmin.rpc("is_org_admin", { _user_id: userId, _org_id: orgId });
      isAdminUser = !adminError && adminRole === true;

      if (!isAdminUser) {
        const { data: member } = await supabaseAdmin
          .from("organization_members")
          .select("profile_id")
          .eq("user_id", userId!)
          .eq("organization_id", orgId!)
          .maybeSingle();

        if (member?.profile_id) {
          const { data: profile } = await supabaseAdmin
            .from("organization_profiles")
            .select("module_permissions")
            .eq("id", member.profile_id)
            .eq("organization_id", orgId)
            .maybeSingle();

          userPermissions = profile?.module_permissions || null;
        }
      }
    }

    const toolsForModel = hasDataAccess
      ? TOOLS.filter(t => canUseTool(t.function.name, userPermissions, isAdminUser))
      : [];

    // Build system prompt extra for blocked modules
    let systemPromptExtra = "";
    if (hasDataAccess && !isAdminUser) {
      const blockedModules = Object.entries(TOOL_PERMISSION_MAP)
        .filter(([name]) => !canUseTool(name, userPermissions, isAdminUser))
        .map(([_, perm]) => perm.module);
      const uniqueBlocked = [...new Set(blockedModules)];

      if (uniqueBlocked.length > 0) {
        const moduleLabels: Record<string, string> = {
          clients: "Clientes", leads: "Leads", finance: "Finanças",
          sales: "Vendas", proposals: "Propostas", calendar: "Agenda",
          marketing: "Marketing", ecommerce: "E-commerce", settings: "Definições",
        };
        const blockedLabels = uniqueBlocked.map(m => moduleLabels[m] || m);
        systemPromptExtra = `\n\nRESTRIÇÕES DO PERFIL: Este utilizador NÃO tem acesso aos módulos: ${blockedLabels.join(', ')}. Se perguntar sobre estes módulos, informa educadamente que não tem permissão para aceder a esses dados e sugere contactar o administrador da organização.`;
      }
    }

    // ── Inject current date/time (Lisbon timezone) ──
    const now = new Date();
    const dateStr = now.toLocaleDateString('pt-PT', { 
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      timeZone: 'Europe/Lisbon' 
    });
    const timeStr = now.toLocaleTimeString('pt-PT', { 
      hour: '2-digit', minute: '2-digit',
      timeZone: 'Europe/Lisbon' 
    });
    const dateContext = `\n\nDATA E HORA ATUAL: ${dateStr}, ${timeStr} (hora de Lisboa). Usa SEMPRE esta data como referência temporal. "Este mês" = mês atual desta data. "Hoje" = esta data. "Esta semana" = semana atual desta data.`;

    // ── Build messages ──
    const systemContent = SYSTEM_PROMPT + dateContext + systemPromptExtra + (hasDataAccess ? "" : "\n\nNOTA: O utilizador não está autenticado ou sem organização. Não tens acesso a dados da BD. Responde apenas com conhecimento geral do sistema.");
    const allMessages = [
      { role: "system", content: systemContent },
      ...messages,
    ];

    // ── Tool-calling loop (max 3 iterations) ──
    let conversationMessages: Array<{ role: string; content: string; tool_call_id?: string }> = [...allMessages];
    const MAX_ITERATIONS = 3;

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const payload: any = {
        model: "gemini-2.5-flash",
        messages: conversationMessages,
        stream: false,
        temperature: 0,
      };
      if (toolsForModel.length > 0) {
        payload.tools = toolsForModel;
      }

      const resp = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${GEMINI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!resp.ok) {
        const status = resp.status;
        if (status === 429) {
          return new Response(
            JSON.stringify({ error: "O Otto está com muitos pedidos. Tenta novamente em alguns segundos." }),
            { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        if (status === 402) {
          return new Response(
            JSON.stringify({ error: "Créditos de IA esgotados. Contacta o administrador." }),
            { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        const errorText = await resp.text();
        console.error("AI gateway error:", { status });
        return new Response(
          JSON.stringify({ error: "Erro ao contactar o Otto. Tenta novamente." }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const result = await resp.json();
      const choice = result.choices?.[0];

      if (!choice) {
        return new Response(
          JSON.stringify({ error: "Resposta vazia do modelo." }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const assistantMessage = choice.message;

      // Check if the model wants to call tools
      if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
        // Add assistant message with tool_calls
        conversationMessages.push(assistantMessage);

        // Execute each tool call
        for (const toolCall of assistantMessage.tool_calls) {
          const fnName = toolCall.function.name;
          let fnArgs: Record<string, any> = {};
          try {
            fnArgs = JSON.parse(toolCall.function.arguments || "{}");
          } catch { fnArgs = {}; }

          // Inject attachment_paths for submit_support_ticket
          if (fnName === "submit_support_ticket" && attachment_paths && attachment_paths.length > 0) {
            fnArgs._attachment_paths = attachment_paths;
          }

          console.log("otto_tool", { tool: fnName });
          const toolResult = await executeTool(fnName, fnArgs, orgId!, supabaseAdmin, userId);

          conversationMessages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: toolResult,
          });
        }
        // Continue loop — model will process tool results
        continue;
      }

      // No tool calls — we have the final answer. Return it directly as SSE.
      // This avoids a redundant second call to the model which would regenerate
      // a different response and break multi-step flows (e.g. support tickets).
      if (assistantMessage.content) {
        const simpleSSE = `data: ${JSON.stringify({ choices: [{ delta: { content: assistantMessage.content } }] })}\n\ndata: [DONE]\n\n`;
        return new Response(simpleSSE, {
          headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
        });
      }

      // Edge case: model returned no content and no tool calls
      return new Response(
        JSON.stringify({ error: "Resposta vazia do Otto." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // If we hit max iterations, return a fallback message
    const fallbackSSE = `data: ${JSON.stringify({ choices: [{ delta: { content: "Peço desculpa, não consegui processar o pedido. Tenta reformular a tua pergunta." } }] })}\n\ndata: [DONE]\n\n`;
    return new Response(fallbackSSE, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("otto-chat error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Erro desconhecido" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
