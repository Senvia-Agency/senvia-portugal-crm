export const AUTOMATION_FLOW_STATUSES = ["draft", "active", "paused"] as const;
export const AUTOMATION_REENTRY_POLICIES = ["once", "after_completion", "always"] as const;
export const AUTOMATION_WAIT_UNITS = ["minutes", "hours", "days"] as const;
export const AUTOMATION_CONDITION_OPERATORS = [
  "equals",
  "not_equals",
  "contains",
  "exists",
  "not_exists",
  "greater_than",
  "less_than",
  "in_clients",
  "in_leads",
  "in_crm",
] as const;

export const CREATABLE_AUTOMATION_TRIGGERS = [
  "lead_created",
  "lead_created_hot",
  "lead_created_warm",
  "lead_created_cold",
  "lead_status_changed",
  "form_submitted",
  "message_received",
  "whatsapp_keyword",
  "sale_status_changed",
  "list_joined",
  "sale_renewal_due_today",
  "sale_renewal_due_in_2_days",
  "sale_renewal_overdue",
  "sale_payment_overdue_10d",
  "referral_month_earned",
  "referral_month_started",
  "referral_month_ending_2d",
  "subscription_renewal_due_2d",
  "stripe_subscription_past_due",
] as const;

export const LEGACY_AUTOMATION_TRIGGERS = [
  "client_created",
  "client_status_changed",
  "proposal_created",
  "proposal_status_changed",
  "sale_created",
  "trial_started",
  "trial_day_3",
  "trial_day_7",
  "trial_expiring_3d",
  "trial_expiring_1d",
  "trial_expired",
  "trial_inactive_48h",
  "stripe_subscription_created",
  "stripe_subscription_renewed",
  "stripe_subscription_canceled",
] as const;

export const NATIVE_AUTOMATION_TRIGGERS = [
  ...CREATABLE_AUTOMATION_TRIGGERS,
  ...LEGACY_AUTOMATION_TRIGGERS,
] as const;

export const CREATABLE_AUTOMATION_ACTIONS = [
  "send_whatsapp",
  "send_email",
  "wait",
  "condition",
  "move_stage",
  "assign_user",
  "add_to_list",
  "create_task",
  "webhook",
  "end",
] as const;

export const COMPATIBLE_AUTOMATION_ACTIONS = ["wait_reply"] as const;
export const NATIVE_AUTOMATION_ACTIONS = [
  ...CREATABLE_AUTOMATION_ACTIONS,
  ...COMPATIBLE_AUTOMATION_ACTIONS,
] as const;
export const NATIVE_AUTOMATION_NODE_TYPES = [
  ...NATIVE_AUTOMATION_TRIGGERS,
  ...NATIVE_AUTOMATION_ACTIONS,
] as const;

export type AutomationFlowStatus = (typeof AUTOMATION_FLOW_STATUSES)[number];
export type AutomationReentryPolicy = (typeof AUTOMATION_REENTRY_POLICIES)[number];
export type CreatableAutomationTrigger = (typeof CREATABLE_AUTOMATION_TRIGGERS)[number];
export type NativeAutomationTrigger = (typeof NATIVE_AUTOMATION_TRIGGERS)[number];
export type NativeAutomationAction = (typeof NATIVE_AUTOMATION_ACTIONS)[number];
export type NativeAutomationNodeType = (typeof NATIVE_AUTOMATION_NODE_TYPES)[number];

export const AUTOMATION_GRAPH_LIMITS = {
  maxNodes: 100,
  maxEdges: 500,
  maxIdentifierLength: 128,
  maxTextLength: 20_000,
  maxStepsPerRun: 1_000,
} as const;

export const AUTOMATION_NODE_LABELS: Readonly<Record<NativeAutomationNodeType, string>> = {
  lead_created: "Lead criada",
  lead_created_hot: "Lead criada · quente",
  lead_created_warm: "Lead criada · morna",
  lead_created_cold: "Lead criada · fria",
  lead_status_changed: "Estado da lead mudou",
  form_submitted: "Formulário submetido",
  message_received: "Mensagem recebida",
  whatsapp_keyword: "Palavra-chave WhatsApp",
  sale_status_changed: "Estado da venda mudou",
  list_joined: "Entrou numa lista",
  sale_renewal_due_today: "Cobrança vence hoje",
  sale_renewal_due_in_2_days: "Cobrança vence em 2 dias",
  sale_renewal_overdue: "Cobrança em atraso",
  sale_payment_overdue_10d: "Pagamento em atraso há mais de 10 dias",
  referral_month_earned: "Mês grátis por indicação",
  referral_month_started: "Mês grátis começou",
  referral_month_ending_2d: "Mês grátis termina em 2 dias",
  subscription_renewal_due_2d: "Plano renova em 2 dias",
  stripe_subscription_past_due: "Pagamento da subscrição em atraso",
  client_created: "Cliente criado",
  client_status_changed: "Estado do cliente mudou",
  proposal_created: "Proposta criada",
  proposal_status_changed: "Estado da proposta mudou",
  sale_created: "Venda criada",
  trial_started: "Trial começou",
  trial_day_3: "Trial · dia 3",
  trial_day_7: "Trial · dia 7",
  trial_expiring_3d: "Trial expira em 3 dias",
  trial_expiring_1d: "Trial expira amanhã",
  trial_expired: "Trial expirou",
  trial_inactive_48h: "Trial inativo há 48h",
  stripe_subscription_created: "Subscrição criada",
  stripe_subscription_renewed: "Subscrição renovada",
  stripe_subscription_canceled: "Subscrição cancelada",
  send_whatsapp: "Enviar WhatsApp",
  send_email: "Enviar email",
  wait: "Esperar",
  wait_reply: "Esperar resposta",
  condition: "Condição",
  move_stage: "Mudar etapa",
  assign_user: "Atribuir a utilizador",
  add_to_list: "Adicionar a lista",
  create_task: "Criar tarefa",
  webhook: "Webhook",
  end: "Fim",
};

export const AUTOMATION_CONFIG_CONTRACT = {
  trigger: {
    lead_created: "source?",
    lead_status_changed: "from_stage_id?, to_stage_id?",
    form_submitted: "form_slug?",
    message_received: "channel_id?, buffer_seconds? (0..60)",
    whatsapp_keyword: "keywords[] (obrigatório para ativar)",
    sale_status_changed: "to_status?",
    list_joined: "list_id?",
    other_native_triggers: "sem configuração",
  },
  action: {
    send_whatsapp: "message ou media; channel_id?; wait_reply? + rules/timeout",
    send_email: "template_id ou subject/html",
    wait: "duration ou amount + unit",
    wait_reply: "question? + rules + timeout",
    condition: "field + operator + value quando aplicável",
    move_stage: "stage (chave da etapa)",
    assign_user: "user_id",
    add_to_list: "list_id",
    create_task: "title + due_in_days? + user_id?",
    webhook: "url + method? + headers/body JSON?",
    end: "sem configuração",
  },
} as const;

export const PROTECTED_AUTOMATION_SURFACES = [{
  key: "fiscal_document_email",
  name: "Documento fiscal emitido → Enviar PDF ao cliente",
  storage: "invoices_outbox",
  editableGraph: false,
  deletable: false,
  route: "/automacoes",
}] as const;

const CREATABLE_TRIGGER_SET: ReadonlySet<string> = new Set(CREATABLE_AUTOMATION_TRIGGERS);
const NATIVE_TRIGGER_SET: ReadonlySet<string> = new Set(NATIVE_AUTOMATION_TRIGGERS);

export function isCreatableAutomationTrigger(value: unknown): value is CreatableAutomationTrigger {
  return typeof value === "string" && CREATABLE_TRIGGER_SET.has(value);
}

export function isNativeAutomationTrigger(value: unknown): value is NativeAutomationTrigger {
  return typeof value === "string" && NATIVE_TRIGGER_SET.has(value);
}
