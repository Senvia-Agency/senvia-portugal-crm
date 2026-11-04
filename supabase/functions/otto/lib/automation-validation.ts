export const OVERDUE_PAYMENT_TRIGGER = "sale_payment_overdue_10d";
export const OVERDUE_PAYMENT_ENTRY_NODE_ID = "overdue-payment-trigger";
export const OVERDUE_PAYMENT_EMAIL_SUBJECT = "Lembrete de pagamento pendente";
export const OVERDUE_PAYMENT_EMAIL_BODY = [
  "<p>Olá {{primeiro_nome}},</p>",
  "<p>Esperamos que esteja bem. Verificámos que existe um pagamento pendente há pelo menos 10 dias.</p>",
  "<p>Por favor, regularize o pagamento ou contacte-nos caso já o tenha efetuado.</p>",
  "<p>Obrigado.</p>",
].join("");
export const OVERDUE_PAYMENT_ACTIVATION_ACTION =
  "activate_overdue_payment_followup_automation";

const EMAIL_NODE_ID = "overdue-payment-email";
const END_NODE_ID = "overdue-payment-end";
const SAFE_EMAIL_VARIABLES: ReadonlySet<string> = new Set(["primeiro_nome"]);

export const OVERDUE_PAYMENT_PREVIEW = {
  trigger: {
    type: OVERDUE_PAYMENT_TRIGGER,
    event: "Cobrança pendente há pelo menos 10 dias após o vencimento",
  },
  audience: {
    recipients: "Clientes com email associados a cobranças pendentes elegíveis",
    coverage: "Ciclos recorrentes e pagamentos agendados autónomos",
    enrollment: "Uma inscrição por cobrança identificada; o fluxo só permite uma entrada por cobrança",
  },
  subject: OVERDUE_PAYMENT_EMAIL_SUBJECT,
  body: OVERDUE_PAYMENT_EMAIL_BODY,
  sender: {
    name: "Nome da organização",
    email: "Email Brevo configurado da organização",
  },
  channel: "email",
  destination: "Email do cliente associado à cobrança, fornecido pelo gatilho",
} as const;

export type PreparedAutomationFlow = {
  readonly id: string;
  readonly organizationId: string;
  readonly name: string;
  readonly status: string;
  readonly triggerType: string;
  readonly graph: unknown;
  readonly entryNodeId: string | null;
  readonly version: number;
  readonly reentryPolicy: string;
  readonly updatedAt: string;
};

export type AutomationActivationPayload = {
  readonly kind: typeof OVERDUE_PAYMENT_ACTIVATION_ACTION;
  readonly organizationId: string;
  readonly flowId: string;
  readonly flowVersion: number;
  readonly flowUpdatedAt: string;
  readonly triggerType: typeof OVERDUE_PAYMENT_TRIGGER;
  readonly reentryPolicy: "once";
};

export type GraphValidationResult =
  | { readonly ok: true }
  | {
    readonly ok: false;
    readonly reason:
      | "entry_node"
      | "nodes"
      | "trigger_node"
      | "email_node"
      | "end_node"
      | "edges";
  };

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function nodeConfig(
  value: unknown,
  identity: { readonly id: string; readonly type: string },
): Readonly<Record<string, unknown>> | null {
  if (!isRecord(value) || value.id !== identity.id || value.type !== identity.type) return null;
  return isRecord(value.config) ? value.config : null;
}

function emailVariablesAreSafe(value: string): boolean {
  for (const match of value.matchAll(/\{\{\s*([\w:]+)\s*\}\}/g)) {
    const variable = match[1];
    if (typeof variable !== "string" || !SAFE_EMAIL_VARIABLES.has(variable)) return false;
  }
  return true;
}

function isExpectedEdge(
  value: unknown,
  expected: { readonly id: string; readonly source: string; readonly target: string },
): boolean {
  return isRecord(value)
    && value.id === expected.id
    && value.source === expected.source
    && value.target === expected.target
    && value.branch === null;
}

export function buildOverduePaymentGraph() {
  return {
    nodes: [
      {
        id: OVERDUE_PAYMENT_ENTRY_NODE_ID,
        type: OVERDUE_PAYMENT_TRIGGER,
        config: {},
        position: { x: 0, y: 0 },
      },
      {
        id: EMAIL_NODE_ID,
        type: "send_email",
        config: {
          subject: OVERDUE_PAYMENT_EMAIL_SUBJECT,
          html: OVERDUE_PAYMENT_EMAIL_BODY,
        },
        position: { x: 260, y: 0 },
      },
      {
        id: END_NODE_ID,
        type: "end",
        config: {},
        position: { x: 520, y: 0 },
      },
    ],
    edges: [
      {
        id: "overdue-payment-trigger-email",
        source: OVERDUE_PAYMENT_ENTRY_NODE_ID,
        target: EMAIL_NODE_ID,
        branch: null,
      },
      {
        id: "overdue-payment-email-end",
        source: EMAIL_NODE_ID,
        target: END_NODE_ID,
        branch: null,
      },
    ],
  } as const;
}

export function validateOverduePaymentGraph(
  graph: unknown,
  entryNodeId: unknown,
): GraphValidationResult {
  if (entryNodeId !== OVERDUE_PAYMENT_ENTRY_NODE_ID) {
    return { ok: false, reason: "entry_node" };
  }
  if (!isRecord(graph) || !Array.isArray(graph.nodes) || graph.nodes.length !== 3) {
    return { ok: false, reason: "nodes" };
  }
  const trigger = nodeConfig(graph.nodes[0], {
    id: OVERDUE_PAYMENT_ENTRY_NODE_ID,
    type: OVERDUE_PAYMENT_TRIGGER,
  });
  if (!trigger || !hasOnlyKeys(trigger, [])) return { ok: false, reason: "trigger_node" };

  const email = nodeConfig(graph.nodes[1], { id: EMAIL_NODE_ID, type: "send_email" });
  if (!email
    || !hasOnlyKeys(email, ["html", "subject"])
    || email.subject !== OVERDUE_PAYMENT_EMAIL_SUBJECT
    || email.html !== OVERDUE_PAYMENT_EMAIL_BODY
    || !emailVariablesAreSafe(OVERDUE_PAYMENT_EMAIL_SUBJECT)
    || !emailVariablesAreSafe(OVERDUE_PAYMENT_EMAIL_BODY)) {
    return { ok: false, reason: "email_node" };
  }

  const end = nodeConfig(graph.nodes[2], { id: END_NODE_ID, type: "end" });
  if (!end || !hasOnlyKeys(end, [])) return { ok: false, reason: "end_node" };
  if (!Array.isArray(graph.edges) || graph.edges.length !== 2
    || !isExpectedEdge(graph.edges[0], {
      id: "overdue-payment-trigger-email",
      source: OVERDUE_PAYMENT_ENTRY_NODE_ID,
      target: EMAIL_NODE_ID,
    })
    || !isExpectedEdge(graph.edges[1], {
      id: "overdue-payment-email-end",
      source: EMAIL_NODE_ID,
      target: END_NODE_ID,
    })) return { ok: false, reason: "edges" };
  return { ok: true };
}

export function parsePreparedAutomationFlow(value: unknown): PreparedAutomationFlow | null {
  if (!isRecord(value)
    || typeof value.id !== "string"
    || typeof value.organization_id !== "string"
    || typeof value.name !== "string"
    || typeof value.status !== "string"
    || typeof value.trigger_type !== "string"
    || (value.entry_node_id !== null && typeof value.entry_node_id !== "string")
    || typeof value.version !== "number" || !Number.isInteger(value.version)
    || typeof value.reentry_policy !== "string"
    || typeof value.updated_at !== "string") return null;
  return {
    id: value.id,
    organizationId: value.organization_id,
    name: value.name,
    status: value.status,
    triggerType: value.trigger_type,
    graph: value.graph,
    entryNodeId: value.entry_node_id,
    version: value.version,
    reentryPolicy: value.reentry_policy,
    updatedAt: value.updated_at,
  };
}

export function buildAutomationActivationPayload(
  flow: PreparedAutomationFlow,
): AutomationActivationPayload {
  return {
    kind: OVERDUE_PAYMENT_ACTIVATION_ACTION,
    organizationId: flow.organizationId,
    flowId: flow.id,
    flowVersion: flow.version,
    flowUpdatedAt: flow.updatedAt,
    triggerType: OVERDUE_PAYMENT_TRIGGER,
    reentryPolicy: "once",
  };
}

export function parseAutomationActivationPayload(
  value: unknown,
): AutomationActivationPayload | null {
  if (!isRecord(value)
    || value.kind !== OVERDUE_PAYMENT_ACTIVATION_ACTION
    || typeof value.organizationId !== "string"
    || typeof value.flowId !== "string"
    || typeof value.flowVersion !== "number" || !Number.isInteger(value.flowVersion)
    || typeof value.flowUpdatedAt !== "string"
    || value.triggerType !== OVERDUE_PAYMENT_TRIGGER
    || value.reentryPolicy !== "once") return null;
  return {
    kind: OVERDUE_PAYMENT_ACTIVATION_ACTION,
    organizationId: value.organizationId,
    flowId: value.flowId,
    flowVersion: value.flowVersion,
    flowUpdatedAt: value.flowUpdatedAt,
    triggerType: OVERDUE_PAYMENT_TRIGGER,
    reentryPolicy: "once",
  };
}
