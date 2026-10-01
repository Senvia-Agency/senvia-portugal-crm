// What goes in and out of each automation step — the "Entrada" and "Saída"
// columns of the node details view, and the variable chips under every
// message field.
//
// The engine renders `{{chave}}` against `run.context`, which is the record
// the trigger's dispatcher sent (plus the aliases buildVars adds: nome,
// primeiro_nome, email, telefone, empresa, nif, fonte). So the fields listed
// here per trigger are exactly the keys a message can use. They are written
// down by hand from each dispatcher — the engine has no schema of its own.
import type {
  AutomationGraph, AutomationGraphNode, AutomationNodeType, AutomationRun, AutomationTriggerType,
} from '@/types/automations';
import { LOOKUP_OPERATORS, getNodeDefinition } from '@/lib/automation-nodes';

export interface IoField {
  /** The variable name: `{{key}}` in a message. */
  key: string;
  label: string;
  hint?: string;
}

export interface TriggerInput {
  /** Where the record comes from, in the customer's words. */
  source: string;
  /** Whether the record carries a contact (name/email/phone) the engine can message. */
  contact: boolean;
  fields: IoField[];
  note?: string;
}

/** Always available: the contact the run is about (buildVars in the engine). */
export const CONTACT_FIELDS: IoField[] = [
  { key: 'primeiro_nome', label: 'Primeiro nome' },
  { key: 'nome', label: 'Nome completo' },
  { key: 'email', label: 'Email' },
  { key: 'telefone', label: 'Telefone' },
];

const LEAD_FIELDS: IoField[] = [
  { key: 'empresa', label: 'Empresa' },
  { key: 'nif', label: 'NIF' },
  { key: 'fonte', label: 'Fonte' },
  { key: 'status', label: 'Etapa', hint: 'chave da etapa no pipeline' },
  { key: 'temperature', label: 'Temperatura', hint: 'hot, warm ou cold' },
  { key: 'value', label: 'Valor' },
  { key: 'tipologia', label: 'Tipologia' },
  { key: 'consumo_anual', label: 'Consumo anual' },
  { key: 'notes', label: 'Notas' },
  { key: 'custom_data', label: 'Campos do formulário', hint: 'todos os campos extra, em JSON' },
];

const CLIENT_FIELDS: IoField[] = [
  { key: 'company', label: 'Empresa' },
  { key: 'nif', label: 'NIF' },
  { key: 'company_nif', label: 'NIF da empresa' },
  { key: 'code', label: 'Código do cliente' },
  { key: 'status', label: 'Estado' },
  { key: 'source', label: 'Fonte' },
  { key: 'city', label: 'Cidade' },
  { key: 'whatsapp', label: 'WhatsApp' },
];

const SALE_FIELDS: IoField[] = [
  { key: 'code', label: 'Código da venda' },
  { key: 'status', label: 'Estado' },
  { key: 'telecom_status', label: 'Estado telecom' },
  { key: 'total_value', label: 'Valor total' },
  { key: 'sale_date', label: 'Data da venda' },
  { key: 'activation_date', label: 'Data de ativação' },
  { key: 'scheduled_install_date', label: 'Instalação marcada' },
  { key: 'payment_status', label: 'Estado do pagamento' },
  { key: 'servicos_produtos', label: 'Produtos' },
  { key: 'recurring_value', label: 'Mensalidade' },
  { key: 'next_renewal_date', label: 'Próxima renovação' },
];

const PROPOSAL_FIELDS: IoField[] = [
  { key: 'code', label: 'Código da proposta' },
  { key: 'status', label: 'Estado' },
  { key: 'total_value', label: 'Valor total' },
  { key: 'proposal_date', label: 'Data da proposta' },
  { key: 'proposal_type', label: 'Tipo' },
  { key: 'servicos_produtos', label: 'Produtos' },
];

const ORG_CONTACT_FIELDS: IoField[] = [
  { key: 'empresa', label: 'Organização', hint: 'nome da organização cliente' },
  { key: 'plano', label: 'Plano' },
];

const SALE_CYCLE_FIELDS: IoField[] = [
  { key: 'empresa', label: 'Empresa do cliente' },
  { key: 'codigo_venda', label: 'Código da venda' },
  { key: 'valor', label: 'Valor da cobrança', hint: 'já formatado em euros' },
  { key: 'data_vencimento', label: 'Data de vencimento' },
  { key: 'vendedor_nome', label: 'Vendedor' },
  { key: 'vendedor_email', label: 'Email do vendedor' },
  { key: 'vendedor_telefone', label: 'Telefone do vendedor' },
];

const REFERRAL_FIELDS: IoField[] = [
  ...ORG_CONTACT_FIELDS,
  { key: 'indicada', label: 'Organização indicada' },
];

const NO_CONTACT_NOTE = 'Este registo não traz nome, email nem telefone: os passos de email e WhatsApp falham neste gatilho.';

export const TRIGGER_INPUTS: Record<AutomationTriggerType, TriggerInput> = {
  lead_created: { source: 'A ficha da lead criada', contact: true, fields: LEAD_FIELDS },
  lead_created_hot: { source: 'A ficha da lead, já classificada como quente', contact: true, fields: LEAD_FIELDS },
  lead_created_warm: { source: 'A ficha da lead, já classificada como morna', contact: true, fields: LEAD_FIELDS },
  lead_created_cold: { source: 'A ficha da lead, já classificada como fria', contact: true, fields: LEAD_FIELDS },
  lead_status_changed: { source: 'A ficha da lead, já na etapa nova', contact: true, fields: LEAD_FIELDS },
  form_submitted: {
    source: 'A lead criada pelo formulário',
    contact: true,
    fields: [...LEAD_FIELDS, { key: 'form_id', label: 'Formulário', hint: 'id do formulário público' }],
  },
  message_received: {
    source: 'A mensagem que chegou à caixa',
    contact: true,
    fields: [
      { key: 'mensagem_inicial', label: 'Mensagem recebida', hint: 'o que a pessoa escreveu — as mensagens seguidas juntas, uma por linha' },
      { key: 'mensagens_agrupadas', label: 'Mensagens juntas', hint: 'quantas mensagens seguidas foram juntas numa' },
      { key: 'canal_id', label: 'Caixa', hint: 'id da caixa que recebeu' },
      { key: 'conversa_id', label: 'Conversa', hint: 'id da conversa na Caixa de Entrada' },
    ],
    note: 'Só há telefone e, se o WhatsApp o enviar, o nome. Não há email.',
  },
  whatsapp_keyword: {
    source: 'A mensagem recebida no WhatsApp',
    contact: true,
    fields: [{ key: 'mensagem_inicial', label: 'Mensagem recebida', hint: 'o texto completo que a pessoa escreveu' }],
    note: 'Só há telefone e, se o WhatsApp o enviar, o nome. Não há email.',
  },
  list_joined: {
    source: 'O contacto que entrou na lista',
    contact: true,
    fields: [{ key: 'list_id', label: 'Lista' }],
    note: 'Ainda não há nada no sistema a disparar este gatilho.',
  },
  client_created: { source: 'A ficha do cliente', contact: true, fields: CLIENT_FIELDS },
  client_status_changed: { source: 'A ficha do cliente, já no estado novo', contact: true, fields: CLIENT_FIELDS },
  proposal_created: { source: 'A proposta', contact: false, fields: PROPOSAL_FIELDS, note: NO_CONTACT_NOTE },
  proposal_status_changed: { source: 'A proposta, já no estado novo', contact: false, fields: PROPOSAL_FIELDS, note: NO_CONTACT_NOTE },
  sale_created: { source: 'A venda', contact: false, fields: SALE_FIELDS, note: NO_CONTACT_NOTE },
  sale_status_changed: { source: 'A venda, já no estado novo', contact: false, fields: SALE_FIELDS, note: NO_CONTACT_NOTE },
  trial_started: { source: 'O administrador da organização em teste', contact: true, fields: [] },
  trial_day_3: { source: 'O administrador da organização em teste', contact: true, fields: [] },
  trial_day_7: { source: 'O administrador da organização em teste', contact: true, fields: [] },
  trial_expiring_3d: { source: 'O administrador da organização em teste', contact: true, fields: [{ key: 'dias', label: 'Dias até acabar' }] },
  trial_expiring_1d: { source: 'O administrador da organização em teste', contact: true, fields: [{ key: 'dias', label: 'Dias até acabar' }] },
  trial_expired: { source: 'O administrador da organização em teste', contact: true, fields: [] },
  trial_inactive_48h: { source: 'O administrador da organização em teste', contact: true, fields: [] },
  stripe_subscription_created: { source: 'O administrador da organização que subscreveu', contact: true, fields: [{ key: 'plan', label: 'Plano', hint: 'chave do plano' }] },
  stripe_subscription_renewed: { source: 'O administrador da organização que renovou', contact: true, fields: [{ key: 'plan', label: 'Plano', hint: 'chave do plano' }] },
  stripe_subscription_canceled: { source: 'O administrador da organização que cancelou', contact: true, fields: [{ key: 'plan', label: 'Plano', hint: 'chave do plano' }] },
  stripe_subscription_past_due: {
    source: 'O administrador da organização com o pagamento em atraso',
    contact: true,
    fields: [
      ...ORG_CONTACT_FIELDS,
      { key: 'dias_carencia', label: 'Dias de carência' },
      { key: 'bloqueio_em', label: 'Data de bloqueio' },
    ],
  },
  subscription_renewal_due_2d: {
    source: 'O administrador da organização cuja subscrição renova em 2 dias',
    contact: true,
    fields: [...ORG_CONTACT_FIELDS, { key: 'data_renovacao', label: 'Data da renovação' }],
  },
  referral_month_earned: { source: 'O administrador da organização que indicou', contact: true, fields: REFERRAL_FIELDS },
  referral_month_started: {
    source: 'O administrador da organização que indicou',
    contact: true,
    fields: [...REFERRAL_FIELDS, { key: 'fim_periodo', label: 'Fim do mês grátis' }],
  },
  referral_month_ending_2d: {
    source: 'O administrador da organização que indicou',
    contact: true,
    fields: [...REFERRAL_FIELDS, { key: 'fim_periodo', label: 'Fim do mês grátis' }],
  },
  sale_renewal_due_in_2_days: {
    source: 'O cliente da venda recorrente',
    contact: true,
    fields: [...SALE_CYCLE_FIELDS, { key: 'dias_para_vencimento', label: 'Dias para vencer' }],
  },
  sale_renewal_due_today: {
    source: 'O cliente da venda recorrente',
    contact: true,
    fields: [...SALE_CYCLE_FIELDS, { key: 'periodo', label: 'Período cobrado' }],
  },
  sale_renewal_overdue: {
    source: 'O cliente da venda recorrente',
    contact: true,
    fields: [...SALE_CYCLE_FIELDS, { key: 'periodo', label: 'Período cobrado' }, { key: 'dias_em_atraso', label: 'Dias em atraso' }],
  },
};

const REPLY_FIELD: IoField = {
  key: 'ultima_resposta',
  label: 'Última resposta',
  hint: 'o que a pessoa respondeu no último «Aguardar resposta»',
};

/** The trigger's own fields, or an empty catalogue for a type the UI does not know. */
export function triggerInput(type: string | null | undefined): TriggerInput | null {
  return type ? TRIGGER_INPUTS[type as AutomationTriggerType] ?? null : null;
}

/** Steps that can reach `nodeId` by following the edges backwards. */
function upstreamNodes(graph: AutomationGraph, nodeId: string): AutomationGraphNode[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  const queue = [nodeId];
  while (queue.length) {
    const id = queue.shift() as string;
    for (const edge of graph.edges) {
      if (edge.target === id && !seen.has(edge.source)) {
        seen.add(edge.source);
        queue.push(edge.source);
      }
    }
  }
  return [...seen].map((id) => byId.get(id)).filter((n): n is AutomationGraphNode => !!n);
}

/** What a Condição that looks the contact up adds to the run when it finds it. */
const CONTACT_LOOKUP_FIELDS: IoField[] = [
  { key: 'encontrado_em', label: 'Encontrado em', hint: '«cliente», «lead», ou vazio quando não existe' },
  { key: 'cliente_id', label: 'Cliente (id)', hint: 'quando é cliente' },
  { key: 'cliente_nome', label: 'Nome do cliente', hint: 'como está na ficha do cliente' },
  { key: 'cliente_codigo', label: 'Código do cliente' },
  { key: 'lead_id', label: 'Lead (id)', hint: 'quando é lead' },
  { key: 'lead_nome', label: 'Nome da lead', hint: 'como está na ficha da lead' },
];

function looksUpContact(node: AutomationGraphNode): boolean {
  return node.type === 'condition' && LOOKUP_OPERATORS.includes(String(node.config?.operator ?? ''));
}

function waitsForReply(node: AutomationGraphNode): boolean {
  return node.type === 'wait_reply'
    || (node.type === 'send_whatsapp' && node.config?.wait_reply === true && (node.config?.rules?.length ?? 0) > 0);
}

/**
 * Everything a step can use in its messages: the contact, the trigger's
 * record, and what earlier steps added (the last reply, when one waited).
 */
export function inputFieldsFor(graph: AutomationGraph, node: AutomationGraphNode, triggerType: string | null): IoField[] {
  const trigger = triggerInput(triggerType);
  const fields: IoField[] = [...CONTACT_FIELDS, ...(trigger?.fields ?? [])];
  const upstream = upstreamNodes(graph, node.id);
  if (upstream.some(waitsForReply)) fields.push(REPLY_FIELD);
  if (upstream.some(looksUpContact)) fields.push(...CONTACT_LOOKUP_FIELDS);
  // One entry per key, first definition wins.
  const seen = new Set<string>();
  return fields.filter((f) => (seen.has(f.key) ? false : (seen.add(f.key), true)));
}

export interface NodeOutput {
  /** One sentence: what this step does with what it receives. */
  summary: string;
  /** What it hands to the next step, beyond passing the input through. */
  fields: IoField[];
  /** Branch keys it can take, when it splits the flow. */
  branches?: string[];
}

/** What a step produces — in the engine's terms, what its run step records. */
export function nodeOutput(node: AutomationGraphNode, triggerType: string | null): NodeOutput {
  const definition = getNodeDefinition(node.type);
  if (definition?.isTrigger) {
    const trigger = triggerInput(node.type);
    return {
      summary: trigger
        ? `Entrega ${trigger.source.toLowerCase()} ao primeiro passo. Tudo o que está na Entrada segue para a frente.`
        : 'Entrega o registo recebido ao primeiro passo.',
      fields: [],
    };
  }
  const cfg = node.config ?? {};
  switch (node.type as AutomationNodeType) {
    case 'send_whatsapp': {
      const waits = waitsForReply(node);
      return {
        summary: waits
          ? 'Envia a mensagem pelo número escolhido, com as opções numeradas, e fica à espera da resposta. Segue pelo caminho da opção escolhida, ou por «tempo esgotado».'
          : 'Envia a mensagem pelo número escolhido e segue para o passo seguinte.',
        fields: [
          { key: 'mensagem_id', label: 'Id da mensagem', hint: 'registado no passo, não é variável' },
          ...(waits ? [REPLY_FIELD] : []),
        ],
        branches: waits
          ? [...((cfg.rules ?? []) as Array<{ label?: string }>).map((r) => r.label ?? 'opção'), 'tempo esgotado', 'sem correspondência']
          : undefined,
      };
    }
    case 'wait_reply':
      return {
        summary: 'Não envia nada. Fica à espera do que a pessoa responder e segue pelo caminho da opção que corresponder.',
        fields: [REPLY_FIELD],
        branches: [...((cfg.rules ?? []) as Array<{ label?: string }>).map((r) => r.label ?? 'opção'), 'tempo esgotado', 'sem correspondência'],
      };
    case 'send_email':
      return { summary: 'Envia o email ao contacto pela Brevo, com as variáveis preenchidas, e segue.', fields: [] };
    case 'wait':
      return { summary: 'Pára o percurso durante o tempo indicado (respeita o horário de silêncio) e segue.', fields: [] };
    case 'condition':
      if (LOOKUP_OPERATORS.includes(String(cfg.operator ?? ''))) {
        const where = cfg.operator === 'in_leads' ? 'nas leads'
          : cfg.operator === 'in_crm' ? 'nos clientes e nas leads'
          : 'nos clientes';
        return {
          summary: `Procura «${String(cfg.field ?? 'campo')}» ${where} e segue por «sim» (existe) ou «não» (não existe).`,
          fields: CONTACT_LOOKUP_FIELDS,
          branches: ['sim', 'não'],
        };
      }
      return {
        summary: `Compara «${String(cfg.field ?? 'campo')}» com o valor indicado e segue pelo caminho «sim» ou «não».`,
        fields: [],
        branches: ['sim', 'não'],
      };
    case 'move_stage':
      return { summary: 'Move a lead para a etapa escolhida no pipeline e segue.', fields: [] };
    case 'assign_user':
      return { summary: 'Atribui a lead ao colaborador escolhido e segue.', fields: [] };
    case 'add_to_list':
      return { summary: 'Junta o contacto à lista escolhida e segue.', fields: [] };
    case 'create_task':
      return { summary: 'Cria uma tarefa com o título e o prazo indicados, para o responsável escolhido, e segue.', fields: [] };
    case 'webhook':
      return { summary: 'Chama o endereço indicado com os dados do percurso e segue. A resposta fica registada no passo.', fields: [] };
    case 'end':
      return { summary: 'Termina este caminho do percurso.', fields: [] };
    default:
      return { summary: definition?.description ?? '', fields: [] };
  }
}

/** The value a variable took on a run — mirrors buildVars in the engine. */
export function sampleValueFor(run: AutomationRun | null, key: string): string {
  if (!run) return '';
  const ctx = (run.context ?? {}) as Record<string, unknown>;
  const text = (v: unknown) => {
    if (v === undefined || v === null || v === '') return '';
    return typeof v === 'object' ? JSON.stringify(v) : String(v);
  };
  const nome = (run.contact_name ?? text(ctx.nome ?? ctx.name)).trim();
  switch (key) {
    case 'primeiro_nome': return nome.split(/\s+/)[0] ?? '';
    case 'nome': return nome;
    case 'email': return run.contact_email ?? text(ctx.email);
    case 'telefone': return run.contact_phone ?? text(ctx.telefone ?? ctx.phone);
    case 'empresa': return text(ctx.company_name ?? ctx.empresa ?? ctx.company);
    case 'nif': return text(ctx.company_nif ?? ctx.nif);
    case 'fonte': return text(ctx.source ?? ctx.fonte);
    default: return text(ctx[key]);
  }
}
