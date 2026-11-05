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
  AutomationGraph, AutomationGraphNode, AutomationNodeConfig, AutomationNodeType, AutomationRun, AutomationTriggerType,
} from '@/types/automations';
import { LOOKUP_OPERATORS, getNodeDefinition } from '@/lib/automation-nodes';
import {
  WORKFLOW_FIELD_CATALOG,
  parseAutomationWorkflowDraft,
  type WorkflowEntity,
} from '../../supabase/functions/_shared/automation-workflow-contract.ts';

export type VariableOrigin = 'contact' | 'record' | 'owner' | 'organization' | 'previous' | 'otto';

export interface IoField {
  origin?: VariableOrigin;
  /** The variable name: `{{key}}` in a message. */
  key: string;
  label: string;
  hint?: string;
}

export interface TriggerInput {
  /** Where the record comes from, in the customer's words. */
  source: string;
  /** Whether the record carries a contact (name/email/phone) the engine can message. */
  contact: boolean | 'linked';
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
  { key: 'fidelizacao_end', label: 'Fim da fidelização' },
];

const PROPOSAL_FIELDS: IoField[] = [
  { key: 'code', label: 'Código da proposta' },
  { key: 'status', label: 'Estado' },
  { key: 'total_value', label: 'Valor total' },
  { key: 'proposal_date', label: 'Data da proposta' },
  { key: 'proposal_type', label: 'Tipo' },
  { key: 'sent_at', label: 'Enviada em', hint: 'preenchido quando a proposta passa a enviada' },
  { key: 'valid_until', label: 'Validade', hint: 'data de validade explícita da proposta' },
  { key: 'servicos_produtos', label: 'Produtos' },
];

const ORG_CONTACT_FIELDS: IoField[] = [
  { key: 'empresa', label: 'Organização', origin: 'organization', hint: 'nome da organização cliente' },
  { key: 'plano', label: 'Plano', origin: 'organization' },
];

const SALE_CYCLE_FIELDS: IoField[] = [
  { key: 'empresa', label: 'Empresa do cliente' },
  { key: 'codigo_venda', label: 'Código da venda' },
  { key: 'valor', label: 'Valor da cobrança', hint: 'já formatado em euros' },
  { key: 'data_vencimento', label: 'Data de vencimento' },
  { key: 'vendedor_nome', origin: 'owner', label: 'Vendedor' },
  { key: 'vendedor_email', origin: 'owner', label: 'Email do vendedor' },
  { key: 'vendedor_telefone', origin: 'owner', label: 'Telefone do vendedor' },
];

const REFERRAL_FIELDS: IoField[] = [
  ...ORG_CONTACT_FIELDS,
  { key: 'indicada', label: 'Organização indicada' },
];

const LINKED_CONTACT_NOTE = 'O contacto é obtido do cliente ou da lead ligados ao registo, quando existem. Sem ligação ou sem email/telefone, o envio pelo canal correspondente falha e fica registado no histórico.';
const TASK_FIELDS: IoField[] = [
  { key: 'task_id', label: 'Tarefa (id)' }, { key: 'task_title', label: 'Título da tarefa' },
  { key: 'task_due_at', label: 'Prazo da tarefa' }, { key: 'source_record_id', label: 'Registo de origem (id)' },
];
const EVENT_FIELDS: IoField[] = [
  { key: 'event_id', label: 'Evento (id)' }, { key: 'event_title', label: 'Título do evento' },
  { key: 'event_start_time', label: 'Início do evento' }, { key: 'event_status', label: 'Estado do evento' },
  { key: 'source_record_id', label: 'Registo de origem (id)' },
];
const ALIAS_FIELDS: IoField[] = [
  { key: 'empresa', label: 'Empresa', hint: 'quando informada pelo registo' },
  { key: 'nif', label: 'NIF', hint: 'quando informado pelo registo' },
  { key: 'fonte', label: 'Fonte', hint: 'origem do registo, quando informada' },
];

export const TRIGGER_INPUTS: Record<AutomationTriggerType, TriggerInput> = {
  configured_workflow: {
    source: 'Os registos devolvidos pela consulta configurada',
    contact: true,
    fields: [],
    note: 'A organização e o âmbito de acesso são sempre aplicados pelo servidor.',
  },
  expense_approval_requested: { source: 'O pedido de aprovação de despesa e quem o submeteu', contact: true, fields: [{ key: 'financial_request_id', label: 'Pedido (id)' }, { key: 'request_type', label: 'Tipo de pedido' }, { key: 'request_title', label: 'Título do pedido' }, { key: 'request_amount', label: 'Valor pedido' }, { key: 'request_status', label: 'Estado do pedido' }, { key: 'submitted_by', label: 'Quem submeteu (id)' }], note: 'O destinatário é o membro que submeteu o pedido, quando tem email; não é o cliente da venda.' },
  financial_request_created: { source: 'O pedido financeiro e quem o submeteu', contact: true, fields: [{ key: 'financial_request_id', label: 'Pedido (id)' }, { key: 'request_type', label: 'Tipo de pedido' }, { key: 'request_title', label: 'Título do pedido' }, { key: 'request_amount', label: 'Valor pedido' }, { key: 'request_status', label: 'Estado do pedido' }, { key: 'submitted_by', label: 'Quem submeteu (id)' }], note: 'O destinatário é o membro que submeteu o pedido, quando tem email; não é o cliente da venda.' },
  meta_message_received: { source: 'A mensagem recebida pela integração oficial da Meta', contact: true, fields: [{ key: 'mensagem_inicial', label: 'Mensagem recebida' }, { key: 'message_id', label: 'Mensagem (id)' }, { key: 'message_sent_at', label: 'Mensagem recebida em' }, { key: 'channel_id', label: 'Caixa (id)' }, { key: 'channel_type', label: 'Tipo de canal' }, { key: 'conversa_id', label: 'Conversa (id)' }], note: 'O telefone só existe no canal WhatsApp; Instagram e Messenger usam a conversa para responder. Este evento não fornece email.' },
  email_received: { source: 'O remetente e o email recebido na caixa', contact: true, fields: [{ key: 'email_message_id', label: 'Email recebido (id)' }, { key: 'channel_id', label: 'Caixa (id)' }, { key: 'email_subject', label: 'Assunto do email' }, { key: 'mensagem_inicial', label: 'Texto do email' }, { key: 'message_sent_at', label: 'Email recebido em' }], note: 'O contacto é o remetente do email; este evento não fornece telefone.' },
  conversation_unanswered: { source: 'A conversa sem resposta humana da equipa', contact: true, fields: [{ key: 'conversa_id', label: 'Conversa (id)' }, { key: 'channel_id', label: 'Caixa (id)' }, { key: 'assigned_to', label: 'Responsável (id)' }, { key: 'mensagem_inicial', label: 'Última mensagem recebida' }, { key: 'last_incoming_at', label: 'Última mensagem recebida em' }, { key: 'unanswered_minutes', label: 'Prazo sem resposta (minutos)' }], note: 'O telefone depende de a conversa ser WhatsApp; este evento não fornece email.' },
  list_left: { source: 'O contacto que saiu da lista', contact: true, fields: [{ key: 'list_id', label: 'Lista (id)' }, { key: 'list_name', label: 'Nome da lista' }, { key: 'list_event', label: 'Evento da lista' }, { key: 'marketing_contact_id', label: 'Contacto de marketing (id)' }, { key: 'list_membership_id', label: 'Inscrição na lista (id)' }] },
  email_opened: { source: 'Email aberto', contact: true, fields: [{ key: 'email_send_id', label: 'Envio de email' }, { key: 'email_template_id', label: 'Modelo do email' }, { key: 'email_campaign_id', label: 'Campanha' }, { key: 'email_subject', label: 'Assunto' }] },
  email_clicked: { source: 'Clique no email', contact: true, fields: [{ key: 'email_send_id', label: 'Envio de email' }, { key: 'email_template_id', label: 'Modelo do email' }, { key: 'email_campaign_id', label: 'Campanha' }, { key: 'email_subject', label: 'Assunto' }] },
  email_bounced: { source: 'Email devolvido', contact: true, fields: [{ key: 'email_send_id', label: 'Envio de email' }, { key: 'email_template_id', label: 'Modelo do email' }, { key: 'email_campaign_id', label: 'Campanha' }, { key: 'email_subject', label: 'Assunto' }] },
  email_unsubscribed: { source: 'Subscrição de email cancelada', contact: true, fields: [{ key: 'email_send_id', label: 'Envio de email' }, { key: 'email_template_id', label: 'Modelo do email' }, { key: 'email_campaign_id', label: 'Campanha' }, { key: 'email_subject', label: 'Assunto' }] },
  lead_inactive: { source: 'Lead sem atividade', contact: true, fields: LEAD_FIELDS },
  proposal_unanswered: { source: 'A proposta enviada e o contacto ligado', contact: 'linked', fields: PROPOSAL_FIELDS, note: LINKED_CONTACT_NOTE },
  proposal_expiring: { source: 'A proposta com validade próxima e o contacto ligado', contact: 'linked', fields: PROPOSAL_FIELDS, note: LINKED_CONTACT_NOTE },
  sale_fidelization_ending: { source: 'A venda cuja fidelização termina e o contacto ligado', contact: 'linked', fields: SALE_FIELDS, note: LINKED_CONTACT_NOTE },
  payment_recorded: { source: 'A venda e o pagamento registado', contact: 'linked', fields: [...SALE_FIELDS, { key: 'payment_id', label: 'Pagamento (id)' }, { key: 'payment_amount', label: 'Valor do pagamento' }, { key: 'payment_date', label: 'Data do pagamento' }, { key: 'payment_method', label: 'Método de pagamento' }], note: LINKED_CONTACT_NOTE },
  fiscal_document_issued: { source: 'A venda e o documento fiscal emitido', contact: 'linked', fields: [...SALE_FIELDS, { key: 'invoice_id', label: 'Documento (id)' }, { key: 'document_type', label: 'Tipo de documento' }, { key: 'document_reference', label: 'Referência do documento' }, { key: 'document_total', label: 'Total do documento' }], note: LINKED_CONTACT_NOTE },
  lead_updated: { source: 'Campo da lead mudou', contact: true, fields: LEAD_FIELDS },
  task_overdue: { source: 'A tarefa em atraso e o contacto associado', contact: 'linked', fields: [...TASK_FIELDS], note: LINKED_CONTACT_NOTE },
  meeting_upcoming: { source: 'O evento próximo e o contacto associado', contact: 'linked', fields: [...EVENT_FIELDS], note: LINKED_CONTACT_NOTE },
  task_created: { source: 'Tarefa criada', contact: 'linked', fields: [...TASK_FIELDS], note: LINKED_CONTACT_NOTE },
  task_completed: { source: 'Tarefa concluída', contact: 'linked', fields: [...TASK_FIELDS, { key: 'task_done_at', label: 'Tarefa concluída em' }], note: LINKED_CONTACT_NOTE },
  meeting_created: { source: 'Evento marcado', contact: 'linked', fields: [...EVENT_FIELDS], note: LINKED_CONTACT_NOTE },
  meeting_status_changed: { source: 'Estado do evento mudou', contact: 'linked', fields: [...EVENT_FIELDS], note: LINKED_CONTACT_NOTE },
  inbound_webhook: { source: 'Os campos recebidos pela integração externa', contact: true, fields: LEAD_FIELDS },
  scheduled: { source: 'O registo selecionado pelo agendamento', contact: false, fields: [], note: 'Os campos e os dados de contacto dependem da entidade escolhida. Vendas e propostas podem não trazer contacto.' },
  record_date: { source: 'O registo cuja data foi atingida', contact: false, fields: [], note: 'Os campos e os dados de contacto dependem da entidade escolhida. Vendas e propostas podem não trazer contacto.' },
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
  list_joined: { source: 'O contacto que entrou na lista', contact: true, fields: [{ key: 'list_id', label: 'Lista (id)' }, { key: 'list_name', label: 'Nome da lista' }, { key: 'list_event', label: 'Evento da lista' }, { key: 'marketing_contact_id', label: 'Contacto de marketing (id)' }, { key: 'list_membership_id', label: 'Inscrição na lista (id)' }] },
  client_created: { source: 'A ficha do cliente', contact: true, fields: CLIENT_FIELDS },
  client_status_changed: { source: 'A ficha do cliente, já no estado novo', contact: true, fields: CLIENT_FIELDS },
  proposal_created: { source: 'A proposta', contact: 'linked', fields: PROPOSAL_FIELDS, note: LINKED_CONTACT_NOTE },
  proposal_status_changed: { source: 'A proposta, já no estado novo', contact: 'linked', fields: PROPOSAL_FIELDS, note: LINKED_CONTACT_NOTE },
  sale_created: { source: 'A venda', contact: 'linked', fields: SALE_FIELDS, note: LINKED_CONTACT_NOTE },
  sale_status_changed: { source: 'A venda, já no estado novo', contact: 'linked', fields: SALE_FIELDS, note: LINKED_CONTACT_NOTE },
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
  sale_payment_overdue_10d: {
    source: 'O cliente da venda com pagamento vencido',
    contact: true,
    fields: [...SALE_CYCLE_FIELDS, { key: 'dias_em_atraso', label: 'Dias em atraso' }],
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
export function triggerInput(
  type: string | null | undefined,
  config?: AutomationNodeConfig,
): TriggerInput | null {
  if (!type) return null;
  if (type !== 'configured_workflow') {
    const input = TRIGGER_INPUTS[type as AutomationTriggerType] ?? null;
    if (!input || (type !== 'scheduled' && type !== 'record_date')) return input;
    switch (config?.entity ?? 'lead') {
      case 'lead': return { ...input, source: 'A lead selecionada pelo agendamento', contact: true, fields: LEAD_FIELDS, note: 'O envio depende de o contacto ter email ou telefone para o canal escolhido.' };
      case 'client': return { ...input, source: 'O cliente selecionado pelo agendamento', contact: true, fields: CLIENT_FIELDS, note: 'O envio depende de o contacto ter email ou telefone para o canal escolhido.' };
      case 'sale': return { ...input, source: 'A venda selecionada pelo agendamento e o contacto ligado', contact: 'linked', fields: SALE_FIELDS, note: LINKED_CONTACT_NOTE };
      case 'proposal': return { ...input, source: 'A proposta selecionada pelo agendamento e o contacto ligado', contact: 'linked', fields: PROPOSAL_FIELDS, note: LINKED_CONTACT_NOTE };
      default: return input;
    }
  }
  const workflow = parseAutomationWorkflowDraft(config?.workflow);
  if (!workflow.ok) return TRIGGER_INPUTS.configured_workflow;
  const entity = workflow.value.query.entity;
  const catalog = WORKFLOW_FIELD_CATALOG[entity];
  return {
    source: `Os registos de ${WORKFLOW_ENTITY_INPUT_LABELS[entity]} devolvidos pela consulta configurada`,
    contact: true,
    fields: workflow.value.query.select.flatMap((key) => {
      const field = catalog.find((item) => item.name === key);
      return field ? [{ key: field.name, label: field.label }] : [];
    }),
    note: 'A organização e o âmbito de acesso são sempre aplicados pelo servidor.',
  };
}

const WORKFLOW_ENTITY_INPUT_LABELS: Readonly<Record<WorkflowEntity, string>> = {
  receivables: 'dívidas e mensalidades',
  clients: 'clientes',
  leads: 'leads',
  proposals: 'propostas',
};

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

function hasContactLookup(config: AutomationNodeConfig): boolean {
  return LOOKUP_OPERATORS.includes(String(config.operator ?? '')) || (config.conditions?.some(hasContactLookup) ?? false);
}
function looksUpContact(node: AutomationGraphNode): boolean {
  if (node.type === 'condition') return hasContactLookup(node.config);
  return node.type === 'router' && (node.config.routes?.some(route => route.conditions?.some(hasContactLookup)) ?? false);
}

function waitsForReply(node: AutomationGraphNode): boolean {
  return node.type === 'wait_reply'
    || (node.type === 'send_whatsapp' && node.config?.wait_reply === true && (node.config?.rules?.length ?? 0) > 0);
}

/**
 * Everything a step can use in its messages: the contact, the trigger's
 * record, and what earlier steps added (the last reply, when one waited).
 */
export function inputFieldsFor(graph: AutomationGraph, node: AutomationGraphNode, triggerType: string | null, triggerConfig?: Readonly<Record<string, unknown>>): IoField[] {
  const config = triggerConfig ?? graph.nodes.find(item => item.type === triggerType)?.config;
  const trigger = triggerInput(triggerType, config);
  const fields: IoField[] = [
    ...CONTACT_FIELDS.map(field => ({ ...field, origin: 'contact' as const })),
    ...ALIAS_FIELDS.map(field => ({ ...field, origin: 'record' as const })),
    ...(trigger?.fields ?? []).map(field => ({ ...field, origin: field.origin ?? 'record' as const })),
  ];
  const upstream = upstreamNodes(graph, node.id);
  if (upstream.some(waitsForReply)) fields.push({ ...REPLY_FIELD, origin: 'previous' });
  if (upstream.some(looksUpContact)) fields.push(...CONTACT_LOOKUP_FIELDS.map(field => ({ ...field, origin: 'previous' as const })));
  for (const previous of upstream) {
    if (['ai_classify', 'ai_summarize', 'ai_extract'].includes(previous.type)) {
      fields.push(...nodeOutput(previous, triggerType).fields.map(field => ({ ...field, origin: 'otto' as const })));
    }
  }
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
    const trigger = triggerInput(node.type, node.config);
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
          ? 'Envia a mensagem pelo número escolhido, com as opções numeradas, e fica à espera da resposta. Segue pela opção escolhida, por Outra resposta quando não corresponde, ou por Sem resposta ao terminar o prazo.'
          : 'Envia a mensagem pelo número escolhido e segue para o passo seguinte.',
        fields: [
          { key: 'mensagem_id', label: 'Id da mensagem', hint: 'registado no passo, não é variável' },
          ...(waits ? [REPLY_FIELD] : []),
        ],
        branches: waits
          ? [...((cfg.rules ?? []) as Array<{ label?: string }>).map((r) => r.label ?? 'opção'), 'Outra resposta', 'Sem resposta']
          : undefined,
      };
    }
    case 'wait_reply':
      return {
        summary: 'Não envia nada. Fica à espera do que a pessoa responder e segue pelo caminho da opção que corresponder.',
        fields: [REPLY_FIELD],
        branches: [...((cfg.rules ?? []) as Array<{ label?: string }>).map((r) => r.label ?? 'opção'), 'Outra resposta', 'Sem resposta'],
      };
    case 'send_email':
      return { summary: cfg.wait_event ? 'Envia o email e aguarda o evento deste envio até ao prazo indicado.' : 'Envia o email ao contacto pela Brevo, com as variáveis preenchidas, e segue.', fields: [], branches: cfg.wait_event ? ['Aconteceu', 'Prazo esgotado'] : undefined };
    case 'wait_until':
      return { summary: 'Aguarda as condições até ao prazo configurado.', fields: [], branches: ['Aconteceu', 'Prazo esgotado'] };
    case 'wait':
      return { summary: 'Pára o percurso durante o tempo indicado (respeita o horário de silêncio) e segue.', fields: [] };
    case 'convert_to_client': return { summary: 'Converte a lead num cliente e mantém os dados associados.', fields: [] };
    case 'send_proposal_email': return { summary: 'Envia esta proposta por email ao contacto associado.', fields: [] };
    case 'create_event': return { summary: 'Cria a reunião na agenda do responsável escolhido.', fields: [] };
    case 'ai_draft': return { summary: 'Guarda o rascunho na descrição de uma tarefa para revisão humana.', fields: [{ key: 'otto_rascunho_tarefa_id', label: 'Tarefa de revisão do rascunho' }, { key: 'otto_confianca', label: 'Confiança' }, { key: 'otto_motivo_revisao', label: 'Motivo da revisão' }], branches: ['Revisão humana'] };
    case 'ai_classify':
    case 'ai_summarize':
    case 'ai_extract': return {
      summary: 'O Otto interpreta o texto e encaminha resultados incertos para revisão humana.',
      fields: [
        { key: 'otto_intencao', label: 'Intenção identificada' }, { key: 'otto_temperatura', label: 'Temperatura' },
        { key: 'otto_resumo', label: 'Resumo' }, { key: 'otto_confianca', label: 'Confiança' },
        ...(cfg.fields ?? []).map(field => ({ key: `otto_campo_${field.name}`, label: field.description || field.name })),
      ], branches: ['Concluído', 'Revisão humana'],
    };
    case 'assign_conversation': return { summary: 'Atribuir conversa', fields: [] };
    case 'close_conversation': return { summary: 'Fechar conversa', fields: [] };
    case 'send_meta_template': return { summary: 'Enviar modelo WhatsApp oficial', fields: [] };
    case 'goto': return { summary: 'Ir para passo', fields: [] };
    case 'create_sale_from_proposal': return { summary: 'Criar venda da proposta', fields: [] };
    case 'request_issue_invoice': return { summary: 'Solicitar emissão de fatura', fields: [], branches: ['Aprovação necessária'] };
    case 'request_issue_receipt': return { summary: 'Solicitar emissão de recibo', fields: [], branches: ['Aprovação necessária'] };
    case 'request_sale_status': return { summary: 'Solicitar alteração de estado', fields: [], branches: ['Aprovação necessária'] };
    case 'request_billing_dispute': return { summary: 'Solicitar revisão de contencioso', fields: [], branches: ['Aprovação necessária'] };
    case 'request_service_suspension': return { summary: 'Solicitar revisão de suspensão', fields: [], branches: ['Aprovação necessária'] };
    case 'create_lead': return { summary: 'Criar lead', fields: [] };
    case 'mark_lead_lost': return { summary: 'Marcar lead como perdida', fields: [] };
    case 'complete_record_tasks': return { summary: 'Concluir tarefas do registo', fields: [] };
    case 'filter': return { summary: 'Continua se as condições se verificarem; caso contrário, encerra este percurso.', fields: [] };
    case 'split_ab': return { summary: 'Distribui cada contacto por um caminho estável com a percentagem configurada.', fields: [], branches: (cfg.variants ?? []).map(variant => variant.label) };
    case 'execute_flow': return { summary: 'Inscreve o contacto noutra automação e continua este percurso.', fields: [] };
    case 'end_other_flow': return { summary: 'Cancela os percursos deste contacto na automação escolhida.', fields: [] };
    case 'router':
      return {
        summary: 'Avalia os caminhos pela ordem apresentada e segue apenas pelo primeiro que corresponde. Sem correspondência, segue por Outros casos.',
        fields: [],
        branches: [...(cfg.routes ?? []).map((route, index) => route.label || `Caminho ${index + 1}`), 'Outros casos'],
      };
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
    case 'mark_proposal_expired':
      return { summary: 'Marca a proposta como expirada apenas se estiver em rascunho ou enviada e a validade explícita já tiver passado.', fields: [] };
    case 'meta_conversion':
      return { summary: 'Envia o evento de conversão configurado para o Pixel da Meta e regista o resultado.', fields: [] };
    case 'move_stage':
      return { summary: 'Move a lead para a etapa escolhida no pipeline e segue.', fields: [] };
    case 'assign_user':
      return { summary: 'Atribui a lead ao colaborador escolhido e segue.', fields: [] };
    case 'update_field':
      return { summary: 'Atualiza o campo escolhido no registo e segue.', fields: [] };
    case 'notify_user':
      return { summary: 'Envia uma notificação interna ao utilizador escolhido e segue.', fields: [] };
    case 'publish_feed':
      return { summary: 'Publica texto no Feed da equipa da sua organização e segue.', fields: [{ key: 'post_id', label: 'Publicação criada', hint: 'Identificador da publicação registado no passo' }] };
    case 'remove_from_list':
      return { summary: 'Retira o contacto da lista escolhida e segue.', fields: [] };
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
