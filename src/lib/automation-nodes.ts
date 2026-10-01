// Catalogue of every automation node type: label, icon, category, default
// config and the branches it emits. Single source of truth for the canvas, the
// node picker and the inspector.

import {
  UserPlus, Move, FileInput, MessageSquareText, ShoppingBag, ListChecks,
  MessageCircle, Mail, Clock, MessagesSquare, GitBranch, Columns3,
  UserCheck, ListPlus, CheckSquare, Webhook, CircleStop, Inbox,
  Users, UserCog, FileText, FileCheck, ShoppingCart, Rocket, CalendarDays,
  CalendarRange, Hourglass, AlarmClock, TimerOff, UserX, CreditCard,
  RefreshCw, AlertCircle, XCircle, BellRing, CalendarClock,
  Flame, Thermometer, Snowflake, Gift, PartyPopper,
  type LucideIcon,
} from 'lucide-react';
import type {
  AutomationNodeCategory, AutomationNodeConfig, AutomationNodeType,
  AutomationTriggerType, AutomationGraphNode,
} from '@/types/automations';
import { formatDateTime } from '@/lib/format';

/**
 * Tailwind classes per category. Everything resolves through the app's CSS
 * variables (or Tailwind's own palette) so both themes work — no raw hex.
 */
export interface NodeCategoryStyle {
  /** Ring around the circle. */
  ring: string;
  /** Circle fill. */
  bg: string;
  /** Icon colour. */
  icon: string;
  /** Soft chip background used by the picker. */
  chip: string;
  /** Edge stroke — a CSS colour string, since SVG strokes are set inline. */
  stroke: string;
}

export const NODE_CATEGORY_STYLES: Record<AutomationNodeCategory, NodeCategoryStyle> = {
  trigger: {
    ring: 'ring-primary',
    bg: 'bg-primary/10',
    icon: 'text-primary',
    chip: 'bg-primary/10 text-primary',
    stroke: 'hsl(var(--primary))',
  },
  whatsapp: {
    ring: 'ring-success',
    bg: 'bg-success/10',
    icon: 'text-success',
    chip: 'bg-success/10 text-success',
    stroke: 'hsl(var(--success))',
  },
  email: {
    ring: 'ring-sky-500',
    bg: 'bg-sky-500/10',
    icon: 'text-sky-500',
    chip: 'bg-sky-500/10 text-sky-500',
    stroke: 'hsl(199 89% 48%)',
  },
  timing: {
    ring: 'ring-warning',
    bg: 'bg-warning/10',
    icon: 'text-warning',
    chip: 'bg-warning/10 text-warning',
    stroke: 'hsl(var(--warning))',
  },
  logic: {
    ring: 'ring-kanban-conversation',
    bg: 'bg-kanban-conversation/10',
    icon: 'text-kanban-conversation',
    chip: 'bg-kanban-conversation/10 text-kanban-conversation',
    stroke: 'hsl(var(--kanban-conversation))',
  },
  crm: {
    ring: 'ring-muted-foreground/50',
    bg: 'bg-muted',
    icon: 'text-muted-foreground',
    chip: 'bg-muted text-muted-foreground',
    stroke: 'hsl(var(--muted-foreground) / 0.5)',
  },
  end: {
    ring: 'ring-destructive',
    bg: 'bg-destructive/10',
    icon: 'text-destructive',
    chip: 'bg-destructive/10 text-destructive',
    stroke: 'hsl(var(--destructive))',
  },
};

export const CATEGORY_LABELS: Record<AutomationNodeCategory, string> = {
  trigger: 'Gatilhos',
  whatsapp: 'WhatsApp',
  email: 'Email',
  timing: 'Tempo',
  logic: 'Lógica',
  crm: 'CRM',
  end: 'Fim',
};

export interface NodeDefinition {
  type: AutomationNodeType;
  label: string;
  description: string;
  icon: LucideIcon;
  category: AutomationNodeCategory;
  isTrigger: boolean;
  /**
   * Branching nodes resolve their branches from config at runtime — for some
   * (send_whatsapp) that means no branches at all until the user turns the
   * wait on. `getNodeBranches` is the authority; this flag is documentation.
   */
  branching: boolean;
  defaultConfig: AutomationNodeConfig;
}

export const NODE_DEFINITIONS: Record<AutomationNodeType, NodeDefinition> = {
  // ── Triggers ──
  lead_created: {
    type: 'lead_created',
    label: 'Lead criada',
    description: 'Quando uma nova lead entra no CRM',
    icon: UserPlus,
    category: 'trigger',
    isTrigger: true,
    branching: false,
    defaultConfig: {},
  },
  // Same event as lead_created, filtered to one AI-classified temperature.
  // Only fires for organizations with "Regras de Qualificação por IA"
  // configuradas — sem isso, toda a lead classifica como "morna".
  lead_created_hot: {
    type: 'lead_created_hot',
    label: 'Lead criada · quente',
    description: 'Quando uma nova lead é classificada como quente pela IA',
    icon: Flame,
    category: 'trigger',
    isTrigger: true,
    branching: false,
    defaultConfig: {},
  },
  lead_created_warm: {
    type: 'lead_created_warm',
    label: 'Lead criada · morna',
    description: 'Quando uma nova lead é classificada como morna pela IA (ou quando não há regras de qualificação configuradas)',
    icon: Thermometer,
    category: 'trigger',
    isTrigger: true,
    branching: false,
    defaultConfig: {},
  },
  lead_created_cold: {
    type: 'lead_created_cold',
    label: 'Lead criada · fria',
    description: 'Quando uma nova lead é classificada como fria pela IA',
    icon: Snowflake,
    category: 'trigger',
    isTrigger: true,
    branching: false,
    defaultConfig: {},
  },
  lead_status_changed: {
    type: 'lead_status_changed',
    label: 'Estado da lead mudou',
    description: 'Quando uma lead muda de etapa no pipeline',
    icon: Move,
    category: 'trigger',
    isTrigger: true,
    branching: false,
    defaultConfig: {},
  },
  form_submitted: {
    type: 'form_submitted',
    label: 'Formulário submetido',
    description: 'Quando um formulário público é preenchido',
    icon: FileInput,
    category: 'trigger',
    isTrigger: true,
    branching: false,
    defaultConfig: {},
  },
  message_received: {
    type: 'message_received',
    label: 'Mensagem recebida',
    description: 'Quando chega uma mensagem a uma caixa de WhatsApp',
    icon: Inbox,
    category: 'trigger',
    isTrigger: true,
    branching: false,
    defaultConfig: {},
  },
  whatsapp_keyword: {
    type: 'whatsapp_keyword',
    label: 'Palavra-chave WhatsApp',
    description: 'Quando alguém envia uma mensagem com certas palavras',
    icon: MessageSquareText,
    category: 'trigger',
    isTrigger: true,
    branching: false,
    defaultConfig: { keywords: [] },
  },
  sale_status_changed: {
    type: 'sale_status_changed',
    label: 'Estado da venda mudou',
    description: 'Quando uma venda muda de estado',
    icon: ShoppingBag,
    category: 'trigger',
    isTrigger: true,
    branching: false,
    defaultConfig: {},
  },
  list_joined: {
    type: 'list_joined',
    label: 'Entrou numa lista',
    description: 'Quando um contacto é adicionado a uma lista',
    icon: ListChecks,
    category: 'trigger',
    isTrigger: true,
    branching: false,
    defaultConfig: {},
  },

  // ── Renewal triggers (offered for new flows) ──
  sale_renewal_due_today: {
    type: 'sale_renewal_due_today',
    label: 'Cobrança vence hoje',
    description: 'Quando um ciclo de uma venda recorrente vence hoje e ainda não está pago',
    icon: BellRing,
    category: 'trigger',
    isTrigger: true,
    branching: false,
    defaultConfig: {},
  },
  sale_renewal_due_in_2_days: {
    type: 'sale_renewal_due_in_2_days',
    label: 'Cobrança vence em 2 dias',
    description: 'Dois dias antes de um ciclo de uma venda recorrente vencer',
    icon: CalendarClock,
    category: 'trigger',
    isTrigger: true,
    branching: false,
    defaultConfig: {},
  },
  sale_renewal_overdue: {
    type: 'sale_renewal_overdue',
    label: 'Cobrança em atraso',
    description: 'Quando um ciclo de uma venda recorrente passou a data e continua por pagar',
    icon: AlertCircle,
    category: 'trigger',
    isTrigger: true,
    branching: false,
    defaultConfig: {},
  },
  referral_month_earned: {
    type: 'referral_month_earned',
    label: 'Mês grátis por indicação',
    description: 'Quando quem indicou ganha um mês grátis, no primeiro pagamento do indicado',
    icon: Gift,
    category: 'trigger',
    isTrigger: true,
    branching: false,
    defaultConfig: {},
  },
  referral_month_started: {
    type: 'referral_month_started',
    label: 'Mês grátis começou',
    description: 'Quando o mês grátis por indicação entra em vigor, na fatura com desconto paga',
    icon: PartyPopper,
    category: 'trigger',
    isTrigger: true,
    branching: false,
    defaultConfig: {},
  },
  referral_month_ending_2d: {
    type: 'referral_month_ending_2d',
    label: 'Mês grátis termina em 2 dias',
    description: 'Dois dias antes de o mês grátis por indicação acabar e a cobrança recomeçar',
    icon: AlarmClock,
    category: 'trigger',
    isTrigger: true,
    branching: false,
    defaultConfig: {},
  },
  subscription_renewal_due_2d: {
    type: 'subscription_renewal_due_2d',
    label: 'Plano renova em 2 dias',
    description: 'Dois dias antes de a subscrição do SENVIA OS renovar e ser cobrada',
    icon: CreditCard,
    category: 'trigger',
    isTrigger: true,
    branching: false,
    defaultConfig: {},
  },

  // ── Legacy triggers ──
  // Migrated from the old automation system. Not offered for new flows, but
  // existing flows still fire on them and must render properly on the canvas.
  client_created: {
    type: 'client_created',
    label: 'Cliente criado',
    description: 'Quando um novo cliente é criado no CRM',
    icon: Users,
    category: 'trigger',
    isTrigger: true,
    branching: false,
    defaultConfig: {},
  },
  client_status_changed: {
    type: 'client_status_changed',
    label: 'Estado do cliente mudou',
    description: 'Quando um cliente muda de estado',
    icon: UserCog,
    category: 'trigger',
    isTrigger: true,
    branching: false,
    defaultConfig: {},
  },
  proposal_created: {
    type: 'proposal_created',
    label: 'Proposta criada',
    description: 'Quando uma nova proposta é criada',
    icon: FileText,
    category: 'trigger',
    isTrigger: true,
    branching: false,
    defaultConfig: {},
  },
  proposal_status_changed: {
    type: 'proposal_status_changed',
    label: 'Estado da proposta mudou',
    description: 'Quando uma proposta muda de estado',
    icon: FileCheck,
    category: 'trigger',
    isTrigger: true,
    branching: false,
    defaultConfig: {},
  },
  sale_created: {
    type: 'sale_created',
    label: 'Venda criada',
    description: 'Quando uma nova venda é registada',
    icon: ShoppingCart,
    category: 'trigger',
    isTrigger: true,
    branching: false,
    defaultConfig: {},
  },
  trial_started: {
    type: 'trial_started',
    label: 'Trial começou',
    description: 'Quando um cliente inicia o período de teste',
    icon: Rocket,
    category: 'trigger',
    isTrigger: true,
    branching: false,
    defaultConfig: {},
  },
  trial_day_3: {
    type: 'trial_day_3',
    label: 'Trial — dia 3',
    description: 'No 3.º dia do período de teste',
    icon: CalendarDays,
    category: 'trigger',
    isTrigger: true,
    branching: false,
    defaultConfig: {},
  },
  trial_day_7: {
    type: 'trial_day_7',
    label: 'Trial — dia 7',
    description: 'No 7.º dia do período de teste',
    icon: CalendarRange,
    category: 'trigger',
    isTrigger: true,
    branching: false,
    defaultConfig: {},
  },
  trial_expiring_3d: {
    type: 'trial_expiring_3d',
    label: 'Trial expira em 3 dias',
    description: 'Quando faltam 3 dias para o teste terminar',
    icon: Hourglass,
    category: 'trigger',
    isTrigger: true,
    branching: false,
    defaultConfig: {},
  },
  trial_expiring_1d: {
    type: 'trial_expiring_1d',
    label: 'Trial expira amanhã',
    description: 'Quando falta 1 dia para o teste terminar',
    icon: AlarmClock,
    category: 'trigger',
    isTrigger: true,
    branching: false,
    defaultConfig: {},
  },
  trial_expired: {
    type: 'trial_expired',
    label: 'Trial expirou',
    description: 'Quando o período de teste chega ao fim',
    icon: TimerOff,
    category: 'trigger',
    isTrigger: true,
    branching: false,
    defaultConfig: {},
  },
  trial_inactive_48h: {
    type: 'trial_inactive_48h',
    label: 'Trial inativo há 48h',
    description: 'Quando um cliente em teste está 48h sem atividade',
    icon: UserX,
    category: 'trigger',
    isTrigger: true,
    branching: false,
    defaultConfig: {},
  },
  stripe_subscription_created: {
    type: 'stripe_subscription_created',
    label: 'Subscrição criada',
    description: 'Quando uma subscrição Stripe é criada',
    icon: CreditCard,
    category: 'trigger',
    isTrigger: true,
    branching: false,
    defaultConfig: {},
  },
  stripe_subscription_renewed: {
    type: 'stripe_subscription_renewed',
    label: 'Subscrição renovada',
    description: 'Quando uma subscrição Stripe renova com sucesso',
    icon: RefreshCw,
    category: 'trigger',
    isTrigger: true,
    branching: false,
    defaultConfig: {},
  },
  stripe_subscription_past_due: {
    type: 'stripe_subscription_past_due',
    label: 'Pagamento em atraso',
    description: 'Quando a cobrança da subscrição do SENVIA OS falha e o pagamento fica em atraso',
    icon: AlertCircle,
    category: 'trigger',
    isTrigger: true,
    branching: false,
    defaultConfig: {},
  },
  stripe_subscription_canceled: {
    type: 'stripe_subscription_canceled',
    label: 'Subscrição cancelada',
    description: 'Quando uma subscrição Stripe é cancelada',
    icon: XCircle,
    category: 'trigger',
    isTrigger: true,
    branching: false,
    defaultConfig: {},
  },

  // ── Actions ──
  send_whatsapp: {
    type: 'send_whatsapp',
    label: 'Enviar WhatsApp',
    description: 'Envia uma mensagem e, se quiser, espera a resposta e segue pelo caminho da opção escolhida',
    icon: MessageCircle,
    category: 'whatsapp',
    isTrigger: false,
    // Only branches once `wait_reply` is turned on and rules exist — a plain
    // message stays linear. See `getNodeBranches`.
    branching: true,
    // A plain message is the default: waiting is opt-in in the inspector.
    defaultConfig: { message: '' },
  },
  send_email: {
    type: 'send_email',
    label: 'Enviar Email',
    description: 'Envia um email a partir de um template ou conteúdo próprio',
    icon: Mail,
    category: 'email',
    isTrigger: false,
    branching: false,
    defaultConfig: {},
  },
  wait: {
    type: 'wait',
    label: 'Esperar',
    description: 'Pausa o fluxo durante um período',
    icon: Clock,
    category: 'timing',
    isTrigger: false,
    branching: false,
    defaultConfig: { duration: 1, unit: 'hours' },
  },
  // The everyday case (pergunta + espera) now lives inside `send_whatsapp`.
  // This node stays for flows that already use it and for the rarer case of
  // waiting on a question asked somewhere else.
  wait_reply: {
    type: 'wait_reply',
    label: 'Esperar resposta',
    description: 'Espera a resposta do contacto sem enviar nada (a pergunta já foi feita antes)',
    icon: MessagesSquare,
    category: 'logic',
    isTrigger: false,
    branching: true,
    defaultConfig: {
      question: '',
      timeout_amount: 24,
      timeout_unit: 'hours',
      rules: [],
    },
  },
  condition: {
    type: 'condition',
    label: 'Condição',
    description: 'Divide o fluxo consoante um campo do contacto',
    icon: GitBranch,
    category: 'logic',
    isTrigger: false,
    branching: true,
    defaultConfig: { field: 'status', operator: 'equals', value: '' },
  },
  move_stage: {
    type: 'move_stage',
    label: 'Mudar etapa',
    description: 'Move a lead para outra etapa do pipeline',
    icon: Columns3,
    category: 'crm',
    isTrigger: false,
    branching: false,
    defaultConfig: {},
  },
  assign_user: {
    type: 'assign_user',
    label: 'Atribuir a utilizador',
    description: 'Atribui o contacto a um membro da equipa',
    icon: UserCheck,
    category: 'crm',
    isTrigger: false,
    branching: false,
    defaultConfig: {},
  },
  add_to_list: {
    type: 'add_to_list',
    label: 'Adicionar a lista',
    description: 'Adiciona o contacto a uma lista de marketing',
    icon: ListPlus,
    category: 'crm',
    isTrigger: false,
    branching: false,
    defaultConfig: {},
  },
  create_task: {
    type: 'create_task',
    label: 'Criar tarefa',
    description: 'Cria uma tarefa de seguimento na agenda',
    icon: CheckSquare,
    category: 'crm',
    isTrigger: false,
    branching: false,
    defaultConfig: { title: '', due_in_days: 1 },
  },
  webhook: {
    type: 'webhook',
    label: 'Webhook',
    description: 'Chama um endpoint HTTP externo',
    icon: Webhook,
    category: 'crm',
    isTrigger: false,
    branching: false,
    defaultConfig: { method: 'POST' },
  },
  end: {
    type: 'end',
    label: 'Fim',
    description: 'Termina o fluxo para este contacto',
    icon: CircleStop,
    category: 'end',
    isTrigger: false,
    branching: false,
    defaultConfig: {},
  },
};

/**
 * «Mensagem recebida» waits this long for the contact to stop writing, then
 * starts once with everything they sent. Mirrors the engine's
 * MESSAGE_BUFFER_* constants (automation-engine/index.ts).
 */
export const MESSAGE_BUFFER_DEFAULT_SECONDS = 15;
export const MESSAGE_BUFFER_MAX_SECONDS = 60;

/**
 * Curated triggers offered when creating a NEW flow. Legacy trigger types
 * render fine on the canvas but are deliberately not offered here.
 */
export const TRIGGER_TYPES: AutomationTriggerType[] = [
  'lead_created',
  'lead_created_hot',
  'lead_created_warm',
  'lead_created_cold',
  'lead_status_changed',
  'form_submitted',
  'message_received',
  'whatsapp_keyword',
  'sale_status_changed',
  'list_joined',
  'sale_renewal_due_today',
  'sale_renewal_due_in_2_days',
  'sale_renewal_overdue',
  'referral_month_earned',
  'referral_month_started',
  'referral_month_ending_2d',
  'subscription_renewal_due_2d',
  'stripe_subscription_past_due',
];

/**
 * Triggers by the part of the product they belong to. The picker got long
 * enough that a flat grid stopped being scannable; these are its filter chips.
 * Every type offered in TRIGGER_TYPES must sit in exactly one group.
 */
export const TRIGGER_GROUPS: ReadonlyArray<{ key: string; label: string; types: AutomationTriggerType[] }> = [
  { key: 'leads', label: 'Leads', types: ['lead_created', 'lead_created_hot', 'lead_created_warm', 'lead_created_cold', 'lead_status_changed', 'form_submitted', 'list_joined'] },
  { key: 'sales', label: 'Vendas', types: ['sale_status_changed', 'sale_renewal_due_in_2_days', 'sale_renewal_due_today', 'sale_renewal_overdue'] },
  { key: 'whatsapp', label: 'WhatsApp', types: ['message_received', 'whatsapp_keyword'] },
  { key: 'referrals', label: 'Indicações', types: ['referral_month_earned', 'referral_month_started', 'referral_month_ending_2d'] },
  { key: 'billing', label: 'Subscrição', types: ['subscription_renewal_due_2d', 'stripe_subscription_past_due'] },
];

/** The group a trigger belongs to, or null for legacy types the picker no longer offers. */
export function triggerGroupOf(type: AutomationTriggerType): string | null {
  return TRIGGER_GROUPS.find((group) => group.types.includes(type))?.key ?? null;
}

/** Action types offered by the picker, in the order they are shown. */
// `wait_reply` is deliberately NOT offered here: `send_whatsapp` now covers
// send+wait in one node, which is what every new flow needs. The standalone
// node stays fully supported (definition, branches, validation, engine) purely
// so an already-built flow that uses it — the question was asked by something
// outside this flow — keeps rendering and editing correctly.
export const ACTION_TYPES: AutomationNodeType[] = [
  'send_whatsapp',
  'send_email',
  'wait',
  'condition',
  'move_stage',
  'assign_user',
  'add_to_list',
  'create_task',
  'webhook',
  'end',
];

export function getNodeDefinition(type: string): NodeDefinition | undefined {
  return NODE_DEFINITIONS[type as AutomationNodeType];
}

export function getNodeStyle(type: string): NodeCategoryStyle {
  const def = getNodeDefinition(type);
  return NODE_CATEGORY_STYLES[def?.category ?? 'crm'];
}

/** "trial_expired" → "Trial expired" — last-resort label for unknown types. */
export function humanizeNodeType(type: string): string {
  const clean = type.replace(/_/g, ' ').trim();
  return clean ? clean.charAt(0).toUpperCase() + clean.slice(1) : type;
}

export function getNodeLabel(type: string): string {
  return getNodeDefinition(type)?.label ?? humanizeNodeType(type);
}

/** Branch keys a node emits, derived from its config. */
export interface NodeBranch {
  key: string;
  label: string;
}

/** One branch per reply rule, plus the timeout path. */
function replyBranches(node: AutomationGraphNode): NodeBranch[] {
  const rules = node.config?.rules ?? [];
  return [
    ...rules.map((rule, index) => ({
      key: rule.id,
      label: rule.label?.trim() || `Regra ${index + 1}`,
    })),
    { key: 'timeout', label: 'Sem resposta' },
  ];
}

/** True when this WhatsApp message parks the run and branches on the answer. */
export function isWaitingWhatsapp(node: AutomationGraphNode | undefined): boolean {
  return node?.type === 'send_whatsapp'
    && node.config?.wait_reply === true
    && !!node.config?.rules?.length;
}

/**
 * The list of reply options added at the end of a WhatsApp message that waits
 * for an answer — exactly what the engine appends (automation-engine,
 * `replyOptionsText`), so the inspector can preview it. Empty for "none".
 */
export function formatReplyOptions(
  rules: Array<{ label?: string; keywords?: string[] }>,
  style: 'emoji' | 'number' | 'none' = 'emoji',
): string {
  if (style === 'none' || !rules.length) return '';
  return rules
    .map((rule, i) => {
      const label = rule.label ?? rule.keywords?.[0] ?? '';
      // Keycap emoji exist for single digits only: 10 becomes 1️⃣0️⃣.
      const n = String(i + 1);
      const marker = style === 'number' ? `${n}.` : [...n].map((d) => `${d}️⃣`).join('');
      return `${marker} ${label}`;
    })
    .join('\n');
}

export function getNodeBranches(node: AutomationGraphNode | undefined): NodeBranch[] {
  if (!node) return [];

  if (node.type === 'condition') {
    return [
      { key: 'yes', label: 'Sim' },
      { key: 'no', label: 'Não' },
    ];
  }

  if (node.type === 'wait_reply') return replyBranches(node);

  // A WhatsApp message that waits for the reply branches exactly like the
  // standalone wait node; a plain message stays linear.
  if (isWaitingWhatsapp(node)) return replyBranches(node);

  return [];
}

/** Human label for a branch key on an edge leaving `node`. */
export function getBranchLabel(node: AutomationGraphNode | undefined, branch: string | null): string | null {
  if (!branch) return null;
  const found = getNodeBranches(node).find((b) => b.key === branch);
  return found?.label ?? branch;
}

const WAIT_UNIT_LABELS: Record<string, string> = {
  minutes: 'minuto(s)',
  hours: 'hora(s)',
  days: 'dia(s)',
};

export const WAIT_UNIT_OPTIONS = [
  { value: 'minutes', label: 'Minutos' },
  { value: 'hours', label: 'Horas' },
  { value: 'days', label: 'Dias' },
];

/**
 * Contact fields offered by the condition inspector. Values match the keys the
 * engine resolves in the run context ({{nome}}, {{email}}, …).
 */
export const CONDITION_FIELD_OPTIONS = [
  { value: 'nome', label: 'Nome' },
  { value: 'email', label: 'Email' },
  { value: 'telefone', label: 'Telefone' },
  { value: 'empresa', label: 'Empresa' },
  { value: 'status', label: 'Etapa' },
  { value: 'temperature', label: 'Temperatura' },
  { value: 'source', label: 'Origem' },
  { value: 'value', label: 'Valor' },
  { value: 'ultima_resposta', label: 'Última resposta' },
];

/** Operators the engine evaluates, in pt-PT. */
export const CONDITION_OPERATOR_OPTIONS = [
  { value: 'equals', label: 'É igual a' },
  { value: 'not_equals', label: 'É diferente de' },
  { value: 'contains', label: 'Contém' },
  { value: 'exists', label: 'Está preenchido' },
  { value: 'not_exists', label: 'Está vazio' },
  { value: 'greater_than', label: 'É maior que' },
  { value: 'less_than', label: 'É menor que' },
  { value: 'in_clients', label: 'Existe nos clientes' },
  { value: 'in_leads', label: 'Existe nas leads' },
  { value: 'in_crm', label: 'Existe nos clientes ou leads' },
];

/**
 * Operators that look the field's value up in the organization's records
 * (clients, leads, or either) instead of comparing it with a value.
 */
export const LOOKUP_OPERATORS = ['in_clients', 'in_leads', 'in_crm'];

/** Operators that take no value input. */
export const VALUELESS_OPERATORS = ['exists', 'not_exists', ...LOOKUP_OPERATORS];

/** Operators whose value is a number. */
export const NUMERIC_OPERATORS = ['greater_than', 'less_than'];

/**
 * Graphs saved by older editors may carry `is_empty` / `is_not_empty`, which
 * the engine never supported — map them to the real operators for display.
 */
export function normalizeConditionOperator(operator: string | undefined): string {
  if (operator === 'is_empty') return 'not_exists';
  if (operator === 'is_not_empty') return 'exists';
  return operator ?? 'equals';
}

export const SALE_STATUS_OPTIONS = [
  { value: 'pending', label: 'Pendente' },
  { value: 'active', label: 'Ativa' },
  { value: 'completed', label: 'Concluída' },
  { value: 'cancelled', label: 'Cancelada' },
];

function truncate(text: string, max = 46): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/**
 * One-line summary shown under the circle. For message nodes this previews the
 * actual message body, which is what makes the canvas readable at a glance.
 */
export function getNodeSubtitle(node: AutomationGraphNode): string {
  const config = node.config ?? {};

  switch (node.type) {
    case 'send_whatsapp': {
      // The wait is part of this node now, so the canvas has to say so.
      const suffix = isWaitingWhatsapp(node) ? ' · espera resposta' : '';
      if (config.message) return `${truncate(String(config.message), 46 - suffix.length)}${suffix}`;
      const attachment = config.media?.filename ?? config.media_url;
      if (attachment) return `${truncate(`Anexo: ${attachment}`, 46 - suffix.length)}${suffix}`;
      return `Sem mensagem definida${suffix}`;
    }

    case 'send_email':
      if (config.template_id) return 'Template de email';
      return config.subject ? truncate(String(config.subject)) : 'Sem assunto definido';

    case 'wait': {
      const value = config.amount ?? config.duration ?? 0;
      return `Espera ${value} ${WAIT_UNIT_LABELS[config.unit ?? 'hours'] ?? ''}`.trim();
    }

    case 'wait_reply': {
      if (config.question) return truncate(String(config.question));
      const count = config.rules?.length ?? 0;
      const amount = config.timeout_amount ?? config.timeout?.value ?? 24;
      const unit = config.timeout_unit ?? config.timeout?.unit ?? 'hours';
      const mode = count === 1 ? 'regra' : 'regras';
      return `${count} ${mode} · ${amount} ${WAIT_UNIT_LABELS[unit] ?? ''}`.trimEnd();
    }

    case 'condition': {
      const field = CONDITION_FIELD_OPTIONS.find((o) => o.value === config.field)?.label ?? config.field;
      const operator = normalizeConditionOperator(config.operator);
      const op = CONDITION_OPERATOR_OPTIONS.find((o) => o.value === operator)?.label ?? '';
      if (!field) return 'Condição por definir';
      if (VALUELESS_OPERATORS.includes(operator)) return truncate(`${field} ${op.toLowerCase()}`);
      return truncate(`${field} ${op.toLowerCase()} ${config.value ?? ''}`);
    }

    case 'webhook':
      return config.url ? truncate(String(config.url)) : 'Sem URL definido';

    case 'create_task':
      return config.title ? truncate(String(config.title)) : 'Sem título definido';

    case 'whatsapp_keyword': {
      const keywords = config.keywords ?? [];
      return keywords.length ? truncate(keywords.join(', ')) : 'Sem palavras-chave';
    }

    case 'message_received':
      return config.channel_id ? 'Na caixa escolhida' : 'Em qualquer caixa de WhatsApp';

    case 'form_submitted':
      return config.form_slug ? truncate(String(config.form_slug)) : 'Qualquer formulário';

    default:
      return getNodeDefinition(node.type)?.description ?? 'Tipo de passo desconhecido';
  }
}

/**
 * Famílias de gatilho, para o filtro "Tipo" da lista de automações.
 *
 * São 27 tipos de gatilho no catálogo — demasiados para um dropdown. Agrupam-se
 * pelo assunto de que tratam, que é como uma pessoa procura ("as dos trials",
 * "as das vendas"). A ordem aqui é a ordem no filtro.
 */
export const TRIGGER_FAMILIES: readonly { key: string; label: string }[] = Object.freeze([
  { key: 'lead', label: 'Leads' },
  { key: 'client', label: 'Clientes' },
  { key: 'proposal', label: 'Propostas' },
  { key: 'sale', label: 'Vendas' },
  { key: 'trial', label: 'Trials' },
  { key: 'billing', label: 'Subscrições' },
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'list', label: 'Listas' },
  { key: 'other', label: 'Outros' },
]);

/** A que família pertence um gatilho. Por prefixo, para os legados entrarem sozinhos. */
export function getTriggerFamily(triggerType: string | null | undefined): string {
  const t = (triggerType ?? '').toLowerCase();
  if (!t) return 'other';
  // form_submitted vive com as leads: é por aí que uma lead entra.
  if (t.startsWith('lead_') || t === 'form_submitted') return 'lead';
  if (t.startsWith('trial_')) return 'trial';
  if (t.startsWith('stripe_')) return 'billing';
  if (t.startsWith('sale_')) return 'sale';
  if (t.startsWith('client_')) return 'client';
  if (t.startsWith('proposal_')) return 'proposal';
  if (t.startsWith('whatsapp_') || t === 'message_received') return 'whatsapp';
  if (t.startsWith('list_')) return 'list';
  return 'other';
}

/** Human label for each raw key the engine writes into a run step's `detail`. */
const STEP_DETAIL_LABELS: Record<string, string> = {
  canal: 'Canal',
  para: 'Para',
  texto: 'Mensagem',
  anexo: 'Anexo',
  botoes: 'Enviado com botões',
  opcoes: 'Opções de resposta',
  template: 'Modelo de email',
  campo: 'Campo',
  operador: 'Condição',
  resultado: 'Condição verdadeira',
  nova_etapa: 'Nova etapa',
  atribuido_a: 'Atribuído a',
  lista: 'Lista',
  tarefa: 'Tarefa criada',
  prazo: 'Prazo',
  sem_ligacao: 'Aviso',
  url: 'URL',
  status: 'Resposta do servidor',
  motivo: 'Motivo',
  ramo: 'Caminho seguido',
  resposta: 'Resposta do contacto',
  ignorado: 'Ignorado',
  espera_ate: 'Retoma às',
  espera_resposta_ate: 'Prazo para responder',
  adiado_por_horario_de_silencio_ate: 'Adiado até',
  adiado_por_silencio: 'Adiado por horário de silêncio',
};

/** Keys whose value is redundant with the step's own title, or an ISO date, or a boolean. */
const SKIP_DETAIL_KEYS = new Set(['entrada']);
const DATE_DETAIL_KEYS = new Set([
  'espera_ate', 'espera_resposta_ate', 'adiado_por_horario_de_silencio_ate', 'prazo',
]);
const BOOLEAN_DETAIL_KEYS = new Set(['resultado', 'botoes', 'adiado_por_silencio']);

const CHANNEL_LABELS: Record<string, string> = { email: 'Email', whatsapp: 'WhatsApp' };

export interface StepDetailRow {
  key: string;
  label: string;
  value: string;
}

/** Names looked up by id, so ids the engine records (template, user, list, stage) render as text. */
export interface StepDetailLookups {
  templateNameById?: Record<string, string>;
  memberNameById?: Record<string, string>;
  listNameById?: Record<string, string>;
  stageNameByKey?: Record<string, string>;
}

/**
 * A run step's `detail` is whatever JSON the engine happened to write — meant
 * for logs, not people. This turns it into short, labelled rows a non-technical
 * user can read (the Atividade tab used to just dump the raw JSON).
 */
export function describeStepDetail(
  detail: Record<string, unknown> | null | undefined,
  lookups: StepDetailLookups = {},
): StepDetailRow[] {
  if (!detail) return [];

  const rows: StepDetailRow[] = [];
  for (const [key, raw] of Object.entries(detail)) {
    if (SKIP_DETAIL_KEYS.has(key) || raw === null || raw === undefined || raw === '') continue;

    let value: string;
    if (key === 'canal') value = CHANNEL_LABELS[String(raw)] ?? String(raw);
    else if (key === 'template') value = lookups.templateNameById?.[String(raw)] ?? 'Modelo removido';
    else if (key === 'atribuido_a') value = lookups.memberNameById?.[String(raw)] ?? String(raw);
    else if (key === 'lista') value = lookups.listNameById?.[String(raw)] ?? String(raw);
    else if (key === 'nova_etapa') value = lookups.stageNameByKey?.[String(raw)] ?? String(raw);
    else if (key === 'campo') value = CONDITION_FIELD_OPTIONS.find((o) => o.value === raw)?.label ?? String(raw);
    else if (key === 'operador') value = CONDITION_OPERATOR_OPTIONS.find((o) => o.value === raw)?.label ?? String(raw);
    else if (key === 'ramo' && raw === 'timeout') value = 'Sem resposta (esgotou o prazo)';
    else if (DATE_DETAIL_KEYS.has(key)) value = formatDateTime(String(raw));
    else if (BOOLEAN_DETAIL_KEYS.has(key)) value = raw ? 'Sim' : 'Não';
    else value = String(raw);

    rows.push({ key, label: STEP_DETAIL_LABELS[key] ?? humanizeNodeType(key), value });
  }
  return rows;
}
