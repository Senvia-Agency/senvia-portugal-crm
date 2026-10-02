import type {
  AutomationGraph, AutomationTriggerType, AutomationNodeConfig,
} from '@/types/automations';

/**
 * Ready-made flows. Someone who has never built an automation picks one of
 * these, edits the message texts, and activates — which is the difference
 * between shipping an automation module and shipping a toolkit only a
 * developer can use.
 *
 * Every recipe is a complete, valid graph: the canvas lays it out
 * automatically, so no positions are stored here.
 */
export interface AutomationRecipe {
  id: string;
  name: string;
  /** One line, written from the customer's side: what this does for them. */
  summary: string;
  /** What the customer should change before activating. */
  editHint: string;
  trigger_type: AutomationTriggerType;
  trigger_config?: AutomationNodeConfig;
  entry_node_id: string;
  graph: AutomationGraph;
  /** Rough shape shown on the card, e.g. "WhatsApp → espera → email". */
  outline: string[];
  conversational?: boolean;
}

export const AUTOMATION_RECIPES: AutomationRecipe[] = [
  {
    id: 'boas-vindas-lead',
    name: 'Boas-vindas a novo lead',
    summary: 'Quem entra em contacto recebe uma mensagem em minutos, mesmo fora de horas.',
    editHint: 'Muda o texto da mensagem para as tuas palavras.',
    trigger_type: 'lead_created',
    entry_node_id: 'trigger',
    outline: ['Novo lead', 'Esperar 5 min', 'WhatsApp'],
    graph: {
      nodes: [
        { id: 'trigger', type: 'lead_created', config: {}, position: { x: 0, y: 0 } },
        { id: 'wait', type: 'wait', config: { amount: 5, unit: 'minutes' }, position: { x: 0, y: 0 } },
        {
          id: 'whats', type: 'send_whatsapp',
          config: { message: 'Olá {{nome}}, obrigado pelo seu contacto! Em que posso ajudar?' },
          position: { x: 0, y: 0 },
        },
      ],
      edges: [
        { id: 'e1', source: 'trigger', target: 'wait', branch: null },
        { id: 'e2', source: 'wait', target: 'whats', branch: null },
      ],
    },
  },

  {
    id: 'qualificar-conversa',
    name: 'Qualificar lead por conversa',
    summary: 'Pergunta ao lead o que procura — com botões de resposta — e encaminha-o conforme a escolha.',
    editHint: 'Ajusta a pergunta, os botões e as palavras que identificam cada resposta.',
    trigger_type: 'lead_created',
    entry_node_id: 'trigger',
    conversational: true,
    outline: ['Novo lead', 'WhatsApp com botões', '3 caminhos'],
    graph: {
      nodes: [
        { id: 'trigger', type: 'lead_created', config: {}, position: { x: 0, y: 0 } },
        {
          // A single node does the asking AND the waiting: the message goes out
          // with interactive buttons and the run parks until the lead answers.
          id: 'ask', type: 'send_whatsapp',
          config: {
            message: 'Olá {{nome}}! Para o ajudar melhor: procura uma solução para já ou está só a comparar?',
            wait_reply: true,
            use_buttons: true,
            rules: [
              { id: 'quente', label: 'Quero já', keywords: ['agora', 'urgente', 'já', 'ja'] },
              { id: 'frio', label: 'Só a comparar', keywords: ['comparar', 'ver', 'depois', 'talvez'] },
            ],
            timeout_amount: 24, timeout_unit: 'hours',
          },
          position: { x: 0, y: 0 },
        },
        { id: 'hot', type: 'move_stage', config: {}, position: { x: 0, y: 0 } },
        {
          id: 'warm', type: 'send_whatsapp',
          config: { message: 'Sem problema, {{nome}}. Envio-lhe a informação e fico disponível quando quiser avançar.' },
          position: { x: 0, y: 0 },
        },
        {
          id: 'silent', type: 'send_whatsapp',
          config: { message: 'Olá {{nome}}, ainda posso ajudar com alguma coisa?' },
          position: { x: 0, y: 0 },
        },
      ],
      edges: [
        { id: 'e1', source: 'trigger', target: 'ask', branch: null },
        { id: 'e2', source: 'ask', target: 'hot', branch: 'quente' },
        { id: 'e3', source: 'ask', target: 'warm', branch: 'frio' },
        { id: 'e4', source: 'ask', target: 'silent', branch: 'timeout' },
      ],
    },
  },

  {
    id: 'recuperar-lead-frio',
    name: 'Recuperar lead que não respondeu',
    summary: 'Três toques espaçados antes de dar o lead por perdido, em vez de o deixar cair.',
    editHint: 'Ajusta os textos e, se quiseres, os intervalos entre toques.',
    trigger_type: 'lead_created',
    entry_node_id: 'trigger',
    outline: ['Novo lead', 'Espera 2 dias', 'WhatsApp', 'Espera 3 dias', 'Email', 'Perdido'],
    graph: {
      nodes: [
        { id: 'trigger', type: 'lead_created', config: {}, position: { x: 0, y: 0 } },
        { id: 'w1', type: 'wait', config: { amount: 2, unit: 'days' }, position: { x: 0, y: 0 } },
        {
          id: 'touch1', type: 'send_whatsapp',
          config: { message: 'Olá {{nome}}, ainda está interessado? Fico à disposição.' },
          position: { x: 0, y: 0 },
        },
        { id: 'w2', type: 'wait', config: { amount: 3, unit: 'days' }, position: { x: 0, y: 0 } },
        {
          id: 'touch2', type: 'send_email',
          config: { subject: '{{nome}}, ainda posso ajudar?', html: '<p>Olá {{nome}},</p><p>Passei por aqui para saber se ainda faz sentido falarmos.</p>' },
          position: { x: 0, y: 0 },
        },
        { id: 'w3', type: 'wait', config: { amount: 5, unit: 'days' }, position: { x: 0, y: 0 } },
        { id: 'lost', type: 'end', config: { reason: 'Sem resposta após 3 tentativas' }, position: { x: 0, y: 0 } },
      ],
      edges: [
        { id: 'e1', source: 'trigger', target: 'w1', branch: null },
        { id: 'e2', source: 'w1', target: 'touch1', branch: null },
        { id: 'e3', source: 'touch1', target: 'w2', branch: null },
        { id: 'e4', source: 'w2', target: 'touch2', branch: null },
        { id: 'e5', source: 'touch2', target: 'w3', branch: null },
        { id: 'e6', source: 'w3', target: 'lost', branch: null },
      ],
    },
  },

  {
    id: 'palavra-chave-campanha',
    name: 'Palavra-chave da campanha',
    summary: 'Quem escrever a palavra do anúncio recebe a oferta e responde com um botão.',
    editHint: 'Define a palavra-chave no gatilho e escreve a mensagem da oferta.',
    trigger_type: 'whatsapp_keyword',
    trigger_config: { keywords: ['PROMO'] },
    entry_node_id: 'trigger',
    conversational: true,
    outline: ['Palavra-chave', 'Oferta com botão', 'Tarefa ou fim'],
    graph: {
      nodes: [
        {
          id: 'trigger', type: 'whatsapp_keyword',
          config: { keywords: ['PROMO'] }, position: { x: 0, y: 0 },
        },
        {
          // Oferta e pergunta na mesma mensagem — sai com botão e o fluxo fica
          // à espera da resposta neste mesmo passo.
          id: 'offer', type: 'send_whatsapp',
          config: {
            message: 'Boa! Aqui está a sua oferta. Quer que lhe ligue para explicar?',
            wait_reply: true,
            use_buttons: true,
            rules: [{ id: 'sim', label: 'Sim, ligue', keywords: ['sim', 'quero', 'ligue'] }],
            timeout_amount: 48, timeout_unit: 'hours',
          },
          position: { x: 0, y: 0 },
        },
        { id: 'task', type: 'create_task', config: { title: 'Ligar ao contacto da campanha' }, position: { x: 0, y: 0 } },
        { id: 'done', type: 'end', config: { reason: 'Não pediu contacto' }, position: { x: 0, y: 0 } },
      ],
      edges: [
        { id: 'e1', source: 'trigger', target: 'offer', branch: null },
        { id: 'e2', source: 'offer', target: 'task', branch: 'sim' },
        { id: 'e3', source: 'offer', target: 'done', branch: 'timeout' },
      ],
    },
  },

  {
    id: 'lembrete-renovacao',
    name: 'Cobrança vence em 2 dias',
    summary: 'Avisa o cliente dois dias antes de a mensalidade vencer, para não haver surpresas.',
    editHint: 'Ajusta o texto às tuas palavras e confirma o assunto.',
    trigger_type: 'sale_renewal_due_in_2_days',
    entry_node_id: 'trigger',
    outline: ['Cobrança em 2 dias', 'Email'],
    graph: {
      nodes: [
        { id: 'trigger', type: 'sale_renewal_due_in_2_days', config: {}, position: { x: 0, y: 0 } },
        {
          id: 'notice', type: 'send_email',
          config: {
            subject: '{{nome}}, a sua mensalidade vence em 2 dias',
            html: [
              '<p>Olá {{nome}},</p>',
              '<p>A mensalidade de {{valor}} referente à venda n.º {{codigo_venda}} vence a {{data_vencimento}}.</p>',
              '<p>Se já tratou do pagamento, ignore este email. Qualquer dúvida, responda-nos.</p>',
            ].join(''),
          },
          position: { x: 0, y: 0 },
        },
      ],
      edges: [
        { id: 'e1', source: 'trigger', target: 'notice', branch: null },
      ],
    },
  },

  {
    id: 'cobranca-vence-hoje',
    name: 'Cobrança vence hoje',
    summary: 'No dia do vencimento, lembra o cliente de que a mensalidade está por pagar.',
    editHint: 'Ajusta o texto e, se quiseres, junta os dados para pagamento.',
    trigger_type: 'sale_renewal_due_today',
    entry_node_id: 'trigger',
    outline: ['Cobrança vence hoje', 'Email'],
    graph: {
      nodes: [
        { id: 'trigger', type: 'sale_renewal_due_today', config: {}, position: { x: 0, y: 0 } },
        {
          id: 'notice', type: 'send_email',
          config: {
            subject: '{{nome}}, a sua mensalidade vence hoje',
            html: [
              '<p>Olá {{nome}},</p>',
              '<p>A mensalidade de {{valor}} referente à venda n.º {{codigo_venda}} vence hoje, {{data_vencimento}}.</p>',
              '<p>Se já pagou, obrigado e ignore este email. Se precisar de ajuda, estamos por aqui.</p>',
            ].join(''),
          },
          position: { x: 0, y: 0 },
        },
      ],
      edges: [
        { id: 'e1', source: 'trigger', target: 'notice', branch: null },
      ],
    },
  },

  {
    id: 'cobranca-em-atraso',
    name: 'Cobrança em atraso',
    summary: 'Quando uma mensalidade passa a data sem pagamento, o cliente é avisado uma vez.',
    editHint: 'Decide o tom: um lembrete cordial costuma chegar. Junta os dados para pagamento.',
    trigger_type: 'sale_renewal_overdue',
    entry_node_id: 'trigger',
    outline: ['Cobrança em atraso', 'Email'],
    graph: {
      nodes: [
        { id: 'trigger', type: 'sale_renewal_overdue', config: {}, position: { x: 0, y: 0 } },
        {
          id: 'notice', type: 'send_email',
          config: {
            subject: '{{nome}}, a sua mensalidade está em atraso',
            html: [
              '<p>Olá {{nome}},</p>',
              '<p>A mensalidade de {{valor}} referente à venda n.º {{codigo_venda}} venceu a {{data_vencimento}} e continua por pagar, há {{dias_em_atraso}} dias.</p>',
              '<p>Pedimos que regularize assim que possível. Se já o fez, ignore este email; se houver algum problema, fale connosco.</p>',
            ].join(''),
          },
          position: { x: 0, y: 0 },
        },
      ],
      edges: [
        { id: 'e1', source: 'trigger', target: 'notice', branch: null },
      ],
    },
  },

  {
    id: 'lead-ganho-onboarding',
    name: 'Lead ganho — dar as boas-vindas',
    summary: 'Assim que fechas negócio, o novo cliente recebe as boas-vindas e fica com tarefa aberta para o acompanhares.',
    editHint: 'Escolhe no gatilho a etapa que significa "ganho" no teu pipeline.',
    trigger_type: 'lead_status_changed',
    entry_node_id: 'trigger',
    outline: ['Lead muda de etapa', 'WhatsApp', 'Tarefa'],
    graph: {
      nodes: [
        { id: 'trigger', type: 'lead_status_changed', config: {}, position: { x: 0, y: 0 } },
        {
          id: 'welcome', type: 'send_whatsapp',
          config: { message: 'Bem-vindo, {{nome}}! É um prazer tê-lo connosco. Vou acompanhá-lo nos primeiros passos.' },
          position: { x: 0, y: 0 },
        },
        {
          id: 'task', type: 'create_task',
          config: { title: 'Acompanhar novo cliente {{nome}}' },
          position: { x: 0, y: 0 },
        },
      ],
      edges: [
        { id: 'e1', source: 'trigger', target: 'welcome', branch: null },
        { id: 'e2', source: 'welcome', target: 'task', branch: null },
      ],
    },
  },
];

export function getRecipe(id: string): AutomationRecipe | undefined {
  return AUTOMATION_RECIPES.find((r) => r.id === id);
}
