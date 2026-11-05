import { planAutomationErrorContinuation } from '../../supabase/functions/_shared/automation-error-continuation.ts';
import type { AutomationGraph } from '../types/automations';
import type { AutomationValidationIssue } from './automation-validation';
import { InvalidAutomationJump, planBoundedJump } from '../../supabase/functions/_shared/automation-jump.ts';

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function filled(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

export function validateAdditionalActions(graph: AutomationGraph, options: {
  readonly entryNodeId?: string | null;
  readonly triggerConfig?: Readonly<Record<string, unknown>>;
}): AutomationValidationIssue[] {
  const issues: AutomationValidationIssue[] = [];
  const error = (nodeId: string | null, message: string) => issues.push({ nodeId, message, severity: 'error' });
  for (const node of graph.nodes) {
    const cfg = node.config;
    if (cfg.on_error === 'continue') {
      const continuation = planAutomationErrorContinuation(node, graph.edges);
      if (continuation.kind === 'fail') error(node.id, continuation.error);
    }
    switch (String(node.type)) {
      case 'publish_feed':
        if (!filled(cfg.message) || String(cfg.message).length > 4000) error(node.id, 'Preencha a mensagem do Feed, até 4000 caracteres.');
        if (cfg.title !== undefined && (typeof cfg.title !== 'string' || cfg.title.length > 120)) error(node.id, 'O título do Feed pode ter até 120 caracteres.');
        break;
      case 'goto':
        try {
          planBoundedJump(graph, {}, { nodeId: node.id, target: cfg.target_node_id,
            maxVisits: cfg.max_visits, entryNodeId: options.entryNodeId });
        } catch (failure) {
          if (failure instanceof InvalidAutomationJump) error(node.id, failure.message);
          else throw failure;
        }
        break;
      case 'assign_conversation':
        if (!cfg.user_id) error(node.id, 'Escolha o responsável pela conversa.');
        break;
      case 'close_conversation':
        if (cfg.status !== undefined && cfg.status !== 'closed') error(node.id, 'Esta ação só permite fechar a conversa.');
        break;
      case 'send_meta_template': {
        if (!/^[a-z0-9_]{1,512}$/.test(String(cfg.template_name ?? ''))
          || !/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(String(cfg.language ?? ''))) error(node.id, 'Escolha o modelo aprovado e o idioma.');
        const components = cfg.components ?? [];
        if (!Array.isArray(components) || components.length > 2) { error(node.id, 'Configure os componentes de texto do modelo.'); break; }
        const used = new Set<string>();
        for (const component of components) {
          if (!record(component) || (component.type !== 'header' && component.type !== 'body')
            || used.has(component.type) || !Array.isArray(component.parameters) || component.parameters.length > 30
            || component.parameters.some(value => typeof value !== 'string')) {
            error(node.id, 'Configure os parâmetros de texto do cabeçalho e do corpo sem duplicar componentes.');
          } else used.add(component.type);
        }
        break;
      }
      case 'request_issue_invoice':
      case 'request_issue_receipt':
      case 'request_sale_status':
      case 'request_billing_dispute':
      case 'request_service_suspension':
        if (!filled(cfg.reason) || String(cfg.reason).length > 2000) error(node.id, 'Explique o motivo do pedido financeiro, até 2000 caracteres.');
        if (node.type === 'request_sale_status' && !['pending', 'in_progress', 'delivered', 'cancelled'].includes(String(cfg.target_status ?? ''))) error(node.id, 'Escolha o estado da venda para revisão.');
        break;
      case 'create_lead':
        if (!filled(cfg.name) || (!filled(cfg.email) && !filled(cfg.phone))) error(node.id, 'Preencha o nome e pelo menos email ou telefone da nova lead.');
        break;
      case 'mark_lead_lost':
        if (!filled(cfg.reason)) error(node.id, 'Preencha o motivo de perda da lead.');
        break;
      case 'lead_inactive':
      case 'proposal_unanswered':
      case 'proposal_expiring':
      case 'sale_fidelization_ending':
        if (typeof cfg.days !== 'number' || !Number.isInteger(cfg.days) || cfg.days < 1 || cfg.days > 3660) error(node.id, 'Defina entre 1 e 3660 dias para o gatilho.');
        break;
      case 'send_email':
        if (cfg.recipient_mode !== undefined && !['contact', 'owner', 'user'].includes(String(cfg.recipient_mode))) error(node.id, 'Escolha um destinatário suportado para o email.');
        if (cfg.recipient_mode === 'user' && !cfg.recipient_user_id) error(node.id, 'Escolha o utilizador destinatário do email.');
        if (cfg.recipient_mode && cfg.recipient_mode !== 'contact' && cfg.wait_event) error(node.id, 'A espera por interação só está disponível para emails enviados ao contacto.');
        if (cfg.wait_event !== undefined && cfg.wait_event !== 'opened' && cfg.wait_event !== 'clicked' && cfg.wait_event !== 'replied') error(node.id, 'Escolha abertura, clique ou resposta para aguardar o email.');
        if (cfg.wait_event) {
          if (!Number.isFinite(Number(cfg.timeout_amount ?? 24)) || Number(cfg.timeout_amount ?? 24) <= 0) error(node.id, 'Defina um prazo válido para aguardar o evento do email.');
          for (const branch of ['happened', 'timeout']) if (!graph.edges.some(edge => edge.source === node.id && edge.branch === branch)) {
            issues.push({ nodeId: node.id, severity: 'warning', message: `O ramo ${branch === 'happened' ? 'Aconteceu' : 'Prazo esgotado'} do email não tem destino.` });
          }
        }
        break;
    }
  }
  const policy = options.triggerConfig?.failure_policy;
  if (policy !== undefined && policy !== null && policy !== false) {
    if (!record(policy) || typeof policy.enabled !== 'boolean') error(null, 'Defina se a proteção contra falhas está ligada.');
    else {
      const threshold = policy.threshold_percent ?? 20;
      const minimum = policy.min_runs ?? 10;
      const window = policy.window_minutes ?? 60;
      if (typeof threshold !== 'number' || !Number.isFinite(threshold) || threshold < 1 || threshold > 100
        || typeof minimum !== 'number' || !Number.isInteger(minimum) || minimum < 2 || minimum > 10000
        || typeof window !== 'number' || !Number.isInteger(window) || window < 5 || window > 1440) error(null, 'Use limiar de 1–100%, 2–10000 percursos e janela de 5–1440 minutos na proteção contra falhas.');
    }
  }
  return issues;
}
