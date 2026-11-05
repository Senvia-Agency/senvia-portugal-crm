import { automationContactSuppressed } from '../_shared/automation-contact-optout.ts';
import { planAutomationErrorContinuation } from "../_shared/automation-error-continuation.ts";
import { automationContactSubjectId, contactRunIdentityFilter, normalizedAutomationEmail, InvalidAutomationContactIdentity } from "../_shared/automation-contact-identity.ts";
import { resolveActionTarget, InvalidActionTarget } from "./action-target.ts";
import { formatAutomationInvocationError } from "../_shared/automation-invocation-error.ts";
import { checkAutomationReentry } from "./reentry-policy.ts";
import { executeMetaConversionAction } from "./meta-conversion-actions.ts";
import { executeProposalAction } from "./proposal-actions.ts";
import { InvalidAutomationReentry } from "../_shared/automation-reentry.ts";
import { renderAutomationTemplate } from "../_shared/automation-template.ts";
import { executeAutomationHttpAction } from "../_shared/automation-http-action.ts";
import { matchesStageTransition, type PipelineStageIdentity } from "../_shared/automation-stage-filter.ts";
import { executeFinanceAction } from "./finance-actions.ts";
import { visitStepKey, stepVisit, currentVisitExecutedNodes, canonicalStepNodeId, planBoundedJump } from "../_shared/automation-jump.ts";
import { executeInboxAction } from "./inbox-actions.ts";
import { eligiblePersistedReply, replyRuleBranch } from "./reply-reconcile.ts";
import { resolveAutomationEmailRecipient } from "./email-recipient.ts";
import { applyFailurePolicy, retryFailedRuns } from "./failure-policy.ts";
import { executeBusinessAction } from "./business-actions.ts";
import { deterministicAssignment } from "../_shared/automation-split.ts";
import { alertAutomationFailure } from "./automation-failure-alert.ts";
import { decideAutomationRetry } from "../_shared/automation-retry.ts";
import { executeCrmAction, taskDueAt } from "./crm-actions.ts";
import { calculateAutomationWakeAt } from "../_shared/automation-time.ts";
import { evaluateConditionGroup, validateConditionTree } from "../_shared/automation-condition-group.ts";
import { evaluateConditionValue } from "../_shared/automation-condition-value.ts";
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { requestMfaResponse } from "../_shared/user-authorization.ts";
import { requiresSingleBillingEnrollment } from "../_shared/sale-billing-trigger-dedupe.ts";
import { deterministicUuid } from "../_shared/agency-automations.ts";
import {
  isAutomationWebhookUrlValid,
  parseAutomationWebhookBody,
  parseAutomationWebhookHeaders,
} from "../otto/lib/generic-automation-config.ts";
import {
  loadAuthorizedConfiguredFlow,
  readConfiguredWorkflowRecord,
  runConfiguredManual,
  runConfiguredNativeEvent,
  runDueConfiguredWorkflows,
  type ConfiguredFlow,
  type StartConfiguredRecord,
} from "./configured-workflow-integration.ts";
import {
  claimConfiguredWorkflowStage,
  finishConfiguredWorkflowStage,
  type ConfiguredStageClaim,
} from "./configured-workflow-stage-claims.ts";
import {
  CONFIGURED_WORKFLOW_ACTION_TYPES,
  planConfiguredWorkflowStages,
} from "./configured-workflow-runtime.ts";
import { configuredRecordSubjectId, refreshConfiguredRun } from "./configured-workflow-run-state.ts";
import { evaluateNativeCondition } from "./configured-workflow-reachability.ts";
import { consumePendingAction, preparePendingAction } from "../otto/lib/pending-actions.ts";

// Motor dos fluxos de automação.
//
// Três entradas, todas para o mesmo interpretador de grafo:
//   enroll — um gatilho disparou; inscreve o contacto e corre até parar
//   tick   — o cron acorda percursos cuja espera terminou
//   reply  — chegou uma mensagem do contacto; retoma quem estava à espera dela
//            (é isto que torna o modelo conversacional possível)
//
// Regras que o motor garante:
//   * Um percurso avança até bater numa espera, num fim, ou no limite de passos.
//   * Cada nó executa no máximo uma vez por percurso (índice único em
//     automation_run_steps), por isso uma reentrega não duplica mensagens.
//   * Cada passo deixa registo, incluindo o motivo de cada salto. Sem isto,
//     "porque é que este cliente recebeu esta mensagem?" não tem resposta.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-automation-secret",
};

const log = (s: string, d?: unknown) =>
  console.log(`[AUTOMATION-ENGINE] ${s}${d ? ` - ${JSON.stringify(d)}` : ""}`);
const logError = (s: string, d?: unknown) =>
  console.error(`[AUTOMATION-ENGINE] ERROR ${s}${d ? ` - ${JSON.stringify(d)}` : ""}`);

// ---------------------------------------------------------------------------
// Tipos do grafo
// ---------------------------------------------------------------------------
interface NodeOutcome {
  jumpTarget?: string;
  jumpRegion?: readonly string[];
    kind: "next" | "park" | "end" | "fail";
    branch?: string | null;
    status?: string;
    wakeAt?: Date | null;
    detail?: Record<string, unknown>;
    context?: Record<string, unknown>;
    error?: string;
    /**
     * Park ANTES de executar o efeito (adiamento por horário de silêncio): não
     * regista passo e marca o percurso para RE-EXECUTAR este nó ao acordar.
     * Sem isto, o tick seguia para o nó seguinte e a mensagem adiada nunca
     * chegava a ser enviada.
     */
    resumeSelf?: boolean;
}

interface FlowNode {
  id: string;
  type: string;
  config: Record<string, unknown>;
}
interface FlowEdge {
  id: string;
  source: string;
  target: string;
  branch?: string | null;
}
interface Graph {
  nodes: FlowNode[];
  edges: FlowEdge[];
}
export interface Run {
  id: string;
  organization_id: string;
  flow_id: string;
  flow_version: number;
  subject_type: string;
  subject_id: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  contact_phone_key: string | null;
  status: string;
  current_node_id: string | null;
  context: Record<string, unknown>;
  steps_taken: number;
  started_at?: string;
  wake_at?: string | null;
}
export interface Flow {
  id: string;
  organization_id: string;
  name: string;
  trigger_type: string;
  status: string;
  graph: Graph;
  entry_node_id: string | null;
  version: number;
  reentry_policy: string;
  quiet_hours: { start?: string; end?: string } | null;
  max_steps_per_run: number;
  created_by?: string | null;
  trigger_config?: Record<string, unknown> | null;
}

const SALE_PAYMENT_OVERDUE_10D = "sale_payment_overdue_10d";

type BillingPaymentCheck =
  | { readonly kind: "eligible" }
  | { readonly kind: "not_due"; readonly reason: string }
  | { readonly kind: "unavailable"; readonly reason: string };

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function relatedRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  if (isRecord(value)) return value;
  if (Array.isArray(value) && value.length === 1 && isRecord(value[0])) return value[0];
  return null;
}

function completedOverdueDays(dueDate: string): number | null {
  const due = Date.parse(`${dueDate}T00:00:00Z`);
  if (!Number.isFinite(due)) return null;
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.floor((today - due) / 86_400_000);
}

function billingDateMatchesTrigger(triggerType: string, dueDate: string): boolean {
  const daysOverdue = completedOverdueDays(dueDate);
  if (daysOverdue === null) return false;
  switch (triggerType) {
    case "sale_renewal_due_in_2_days": return daysOverdue === -2;
    case "sale_renewal_due_today": return daysOverdue === 0;
    case "sale_renewal_overdue": return daysOverdue > 0 && daysOverdue <= 7;
    case SALE_PAYMENT_OVERDUE_10D: return daysOverdue > 10;
    default: return false;
  }
}

async function checkBillingPayment(
  db: ReturnType<typeof createClient>,
  run: Run,
  triggerType: string,
): Promise<BillingPaymentCheck> {
  const paymentId = run.context.payment_id;
  const paymentSource = run.context.payment_source;
  const saleId = run.context.sale_id;
  const organizationId = run.context.organization_id;
  if (typeof paymentId !== "string"
    || typeof saleId !== "string"
    || organizationId !== run.organization_id) {
    return { kind: "unavailable", reason: "identidade da cobrança inválida" };
  }

  if (paymentSource === "sale_payments") {
    const { data, error } = await db.from("sale_payments")
      .select("id, sale_id, organization_id, status, payment_date, sale:sales!inner(status, organization_id)")
      .eq("id", paymentId)
      .eq("sale_id", saleId)
      .eq("organization_id", run.organization_id)
      .maybeSingle();
    if (error) return { kind: "unavailable", reason: "falha ao consultar a cobrança" };
    const row: unknown = data;
    if (!isRecord(row)) return { kind: "not_due", reason: "cobrança removida" };
    const sale = relatedRecord(row.sale);
    if (!sale || sale.organization_id !== run.organization_id || typeof row.payment_date !== "string") {
      return { kind: "unavailable", reason: "cobrança inconsistente" };
    }
    return row.status === "pending"
        && sale.status !== "cancelled"
        && billingDateMatchesTrigger(triggerType, row.payment_date)
      ? { kind: "eligible" }
      : { kind: "not_due", reason: "cobrança já não está pendente ou elegível para este aviso" };
  }

  if (paymentSource === "sale_recurring_cycles") {
    const { data, error } = await db.from("sale_recurring_cycles")
      .select("id, sale_id, organization_id, status, paid_at, due_date, recurrence:sale_recurrences(service_status, billing_provider), sale:sales!inner(status, organization_id)")
      .eq("id", paymentId)
      .eq("sale_id", saleId)
      .eq("organization_id", run.organization_id)
      .maybeSingle();
    if (error) return { kind: "unavailable", reason: "falha ao consultar o ciclo" };
    const row: unknown = data;
    if (!isRecord(row)) return { kind: "not_due", reason: "ciclo removido" };
    const sale = relatedRecord(row.sale);
    const recurrence = relatedRecord(row.recurrence);
    if (!sale || sale.organization_id !== run.organization_id || typeof row.due_date !== "string") {
      return { kind: "unavailable", reason: "ciclo inconsistente" };
    }
    return row.status !== "paid"
        && row.status !== "cancelled"
        && row.paid_at === null
        && sale.status !== "cancelled"
        && recurrence?.service_status === "active"
        && recurrence.billing_provider === "manual"
        && billingDateMatchesTrigger(triggerType, row.due_date)
      ? { kind: "eligible" }
      : { kind: "not_due", reason: "ciclo já não está pendente ou elegível para este aviso" };
  }

  if (paymentSource === "sale_recurrences") {
    const { data, error } = await db.from("sale_recurrences")
      .select("id, sale_id, organization_id, service_status, billing_provider, next_cycle_date, sale:sales!inner(status, organization_id)")
      .eq("id", paymentId)
      .eq("sale_id", saleId)
      .eq("organization_id", run.organization_id)
      .maybeSingle();
    if (error) return { kind: "unavailable", reason: "falha ao consultar a recorrência" };
    const row: unknown = data;
    if (!isRecord(row)) return { kind: "not_due", reason: "recorrência removida" };
    const sale = relatedRecord(row.sale);
    if (!sale || sale.organization_id !== run.organization_id || typeof row.next_cycle_date !== "string") {
      return { kind: "unavailable", reason: "recorrência inconsistente" };
    }
    return row.service_status === "active"
        && row.billing_provider === "manual"
        && sale.status !== "cancelled"
        && billingDateMatchesTrigger(triggerType, row.next_cycle_date)
      ? { kind: "eligible" }
      : { kind: "not_due", reason: "recorrência já não está ativa ou elegível para este aviso" };
  }

  return { kind: "unavailable", reason: "origem da cobrança inválida" };
}

// ---------------------------------------------------------------------------
// Utilitários
// ---------------------------------------------------------------------------

/**
 * «Mensagem recebida»: segundos de silêncio à espera de mais mensagens antes
 * de arrancar, juntando-as numa só (o buffer que um fluxo do n8n monta com o
 * Redis). Quem escreve «Olá» / «tudo bem?» / «queria saber o preço» em três
 * linhas recebe uma resposta, não três.
 */
const MESSAGE_BUFFER_DEFAULT_SECONDS = 15;
const MESSAGE_BUFFER_MAX_SECONDS = 60;

/** WhatsApp por QR code: no máximo isto de mensagens automáticas por caixa e por dia. */
const WHATSAPP_DAILY_CAP = 200;


/** Últimos 9 dígitos — tem de coincidir com public.automation_phone_key. */
function phoneKey(raw?: string | null): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, "");
  return digits.length < 9 ? null : digits.slice(-9);
}

/** Formato que a Evolution aceita (mesma regra do send-scheduled-messages). */
function normalizePhone(raw: string): string {
  const cleaned = raw.replace(/[^\d+]/g, "");
  if (cleaned.startsWith("+")) return cleaned;
  if (/^\d{9}$/.test(cleaned)) return "+351" + cleaned;
  if (/^\d{11}$/.test(cleaned)) return "+55" + cleaned;
  return cleaned;
}

/**
 * {{nome}} → valor do contexto.
 *
 * O que não conhece é REMOVIDO, não deixado à vista. Antes ficava intacto, o que
 * significa que um contacto recebia "Olá, {{primeiro_nome}}!" — é a mesma regra
 * que o renderTemplate do submit-lead já seguia, e a razão é a mesma: mais vale
 * uma frase com uma lacuna do que mostrar código a um cliente.
 */
function render(template: string, vars: Record<string, unknown>): string {
  return renderAutomationTemplate(String(template ?? ""), vars).text;
}

/**
 * Variáveis disponíveis nas mensagens de um percurso.
 *
 * O contexto do run já traz o registo todo que despoletou o fluxo (o enroll faz
 * `context: { ...record }`), mas com os nomes das COLUNAS — company_name, não
 * empresa. Estes aliases dão os mesmos nomes que o sistema antigo usa, para uma
 * mensagem copiada da configuração antiga funcionar tal e qual. Mantêm-se
 * também as chaves cruas do contexto, para não partir fluxos existentes.
 */
function buildVars(run: Run): Record<string, unknown> {
  const ctx = run.context ?? {};
  const nome = String(run.contact_name ?? ctx.nome ?? "").trim();
  const primeiro = nome.split(/\s+/)[0] || nome;
  return {
    ...ctx,
    nome,
    primeiro_nome: primeiro,
    email: run.contact_email ?? ctx.email ?? "",
    telefone: run.contact_phone ?? ctx.telefone ?? "",
    empresa: ctx.company_name ?? ctx.empresa ?? "",
    nif: ctx.company_nif ?? ctx.nif ?? "",
    fonte: ctx.source ?? ctx.fonte ?? "",
  };
}

/**
 * Dentro do horário de silêncio? Devolve a hora a que se pode voltar a enviar,
 * ou null se estiver livre. Trabalha em Europe/Lisbon: um envio às 3h da manhã
 * queima um cliente, e o servidor está em UTC.
 */
function quietUntil(quiet: { start?: string; end?: string } | null): Date | null {
  if (!quiet?.start || !quiet?.end) return null;

  const now = new Date();
  const lisbon = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Lisbon" }));
  const offsetMs = now.getTime() - lisbon.getTime();

  const [sh, sm] = quiet.start.split(":").map(Number);
  const [eh, em] = quiet.end.split(":").map(Number);
  const mins = lisbon.getHours() * 60 + lisbon.getMinutes();
  const startM = sh * 60 + (sm || 0);
  const endM = eh * 60 + (em || 0);

  // Uma janela como 21:00→09:00 atravessa a meia-noite.
  const inside = startM > endM ? mins >= startM || mins < endM : mins >= startM && mins < endM;
  if (!inside) return null;

  const resume = new Date(lisbon);
  resume.setHours(eh, em || 0, 0, 0);
  if (startM > endM && mins >= startM) resume.setDate(resume.getDate() + 1);
  return new Date(resume.getTime() + offsetMs);
}

/**
 * Todos os passos que se seguem a este. Com um ramo indicado sai exactamente
 * um caminho; sem ramo, seguem-se TODAS as arestas sem ramo de uma vez — e e
 * por isso que um percurso pode ter mais do que um cursor ao mesmo tempo.
 */
function nextNodeIds(graph: Graph, fromId: string, branch?: string | null): string[] {
  const edges = graph.edges.filter((e) => e.source === fromId);
  if (branch !== undefined && branch !== null) {
    if (branch === "default") return edges.filter(e => e.branch === "default" || !e.branch).map(e => e.target);
    const match = edges.find((e) => e.branch === branch);
    return match ? [match.target] : [];
  }
  const plain = edges.filter((e) => !e.branch);
  if (plain.length) return plain.map((e) => e.target);
  // Um passo a quem retiraram os ramos ainda tem arestas com chave de ramo.
  return edges.length ? [edges[0].target] : [];
}

/** O proximo passo, quando so faz sentido um. */
function nextNodeId(graph: Graph, fromId: string, branch?: string | null): string | null {
  return nextNodeIds(graph, fromId, branch)[0] ?? null;
}

/**
 * Um caminho onde o percurso ficou parado. Antes da bifurcacao um percurso
 * tinha uma unica posicao, em current_node_id; com varias arestas de saida
 * pode ficar parado em mais do que uma, e por isso a lista vive no contexto.
 * current_node_id continua a apontar para uma delas, para as consultas antigas
 * e para o caminho da resposta continuarem a funcionar tal e qual.
 */
interface Cursor {
  node: string;
  status: string;
  wake_at: string | null;
  /** Parou ANTES de executar (horario de silencio): tem de re-executar este no. */
  resume_self?: boolean;
}

function readCursors(run: Run): Cursor[] {
  const raw = (run.context as Record<string, unknown> | null)?.__cursors;
  if (!Array.isArray(raw)) return [];
  return raw.filter((c): c is Cursor => !!c && typeof (c as Cursor).node === "string");
}

function durationMs(config: Record<string, unknown>): number {
  const amount = Number(config.amount ?? config.duration ?? 0);
  const unit = String(config.unit ?? "minutes");
  const per: Record<string, number> = {
    minutes: 60_000, hours: 3_600_000, days: 86_400_000, weeks: 604_800_000,
  };
  return Math.max(0, amount) * (per[unit] ?? 60_000);
}

type ConfiguredClaimMap = Readonly<Record<string, ConfiguredStageClaim>>;

function configuredClaims(context: Readonly<Record<string, unknown>>): ConfiguredClaimMap {
  const value = context.__configured_stage_claims;
  if (!isRecord(value)) return {};
  const claims: Record<string, ConfiguredStageClaim> = {};
  for (const [nodeId, candidate] of Object.entries(value)) {
    if (!isRecord(candidate)
      || typeof candidate.executionId !== "string"
      || typeof candidate.claimToken !== "string") continue;
    claims[nodeId] = { executionId: candidate.executionId, claimToken: candidate.claimToken };
  }
  return claims;
}

function withConfiguredClaim(
  context: Readonly<Record<string, unknown>>,
  nodeId: string,
  claim: ConfiguredStageClaim | null,
): Record<string, unknown> {
  const claims = { ...configuredClaims(context) };
  if (claim) claims[nodeId] = claim;
  else delete claims[nodeId];
  const next = { ...context };
  if (Object.keys(claims).length) next.__configured_stage_claims = claims;
  else delete next.__configured_stage_claims;
  return next;
}

// ---------------------------------------------------------------------------
// Motor
// ---------------------------------------------------------------------------
class AutomationStepPersistenceError extends Error {}
class AutomationPersistenceError extends Error {
  override readonly name = "AutomationPersistenceError";
}

export class Engine {
  // deno-lint-ignore no-explicit-any
  constructor(private db: any) {}

  private async finishConfiguredClaim(
    run: Run,
    nodeId: string,
    context: Record<string, unknown>,
    outcome: "succeeded" | "failed" | "unknown",
    error?: string,
  ): Promise<Record<string, unknown>> {
    const claim = configuredClaims(context)[nodeId];
    if (!claim) return context;
    const finished = await finishConfiguredWorkflowStage(this.db, {
      executionId: claim.executionId,
      claimToken: claim.claimToken,
      outcome,
      runId: run.id,
      error,
    });
    if (finished.kind !== "finished") throw new Error(`configured_workflow_stage_finish_${finished.kind}`);
    const next = withConfiguredClaim(context, nodeId, null);
    await this.db.from("automation_runs").update({ context: next }).eq("id", run.id);
    return next;
  }

  private async configuredStageGate(
    run: Run,
    flow: Flow,
    node: FlowNode,
    context: Record<string, unknown>,
  ): Promise<
    | { readonly kind: "proceed"; readonly context: Record<string, unknown> }
    | { readonly kind: "skip"; readonly context: Record<string, unknown>; readonly reason: string }
    | { readonly kind: "fail"; readonly context: Record<string, unknown>; readonly error: string }
  > {
    if (flow.trigger_type !== "configured_workflow") return { kind: "proceed", context };
    const isAction = CONFIGURED_WORKFLOW_ACTION_TYPES.includes(
      node.type as (typeof CONFIGURED_WORKFLOW_ACTION_TYPES)[number],
    );
    if (!isAction) return { kind: "proceed", context };
    try {
      const loaded = await loadAuthorizedConfiguredFlow(this.db, flow.id, {
        organizationId: run.organization_id,
        version: run.flow_version,
      });
      const stage = loaded.definition.stages.find((candidate) => candidate.nodeId === node.id);
      if (!stage) {
        return { kind: "fail", context, error: `configured_workflow_action_without_stage:${node.id}` };
      }
      const recordId = typeof context.__configured_workflow_record_id === "string"
        ? context.__configured_workflow_record_id : null;
      const occurrenceKey = typeof context.__configured_workflow_occurrence_key === "string"
        ? context.__configured_workflow_occurrence_key : null;
      const localDate = typeof context.__configured_workflow_local_date === "string"
        ? context.__configured_workflow_local_date : null;
      const timeZone = typeof context.__configured_workflow_time_zone === "string"
        ? context.__configured_workflow_time_zone : null;
      if (!recordId || !occurrenceKey || !localDate || timeZone !== loaded.definition.trigger.timeZone) {
        return { kind: "fail", context, error: "configured_workflow_run_context_invalid" };
      }
      const record = await readConfiguredWorkflowRecord(this.db, loaded, recordId);
      if (!record) {
        const next = await this.finishConfiguredClaim(run, node.id, context, "succeeded");
        return { kind: "skip", context: next, reason: "record_no_longer_available" };
      }
      const plan = planConfiguredWorkflowStages({
        definition: loaded.definition,
        record,
        graphNodes: loaded.flow.graph.nodes,
        occurrenceKey,
        occurrenceLocalDate: localDate,
        timeZone,
        attempts: [],
      }).find((candidate) => candidate.stage.id === stage.id);
      if (!plan || plan.kind === "skipped") {
        const next = await this.finishConfiguredClaim(run, node.id, context, "succeeded");
        if (plan?.kind === "skipped" && plan.reason === "invalid_action_node") {
          return { kind: "fail", context: next, error: `configured_workflow_invalid_action:${node.id}` };
        }
        return {
          kind: "skip",
          context: next,
          reason: plan?.kind === "skipped" ? plan.reason : "stage_not_planned",
        };
      }
      const refreshed = refreshConfiguredRun(context, record);
      context = refreshed.context;
      run.context = context;
      run.contact_name = refreshed.contactName;
      run.contact_email = refreshed.contactEmail;
      run.contact_phone = refreshed.contactPhone;
      run.contact_phone_key = phoneKey(run.contact_phone);
      await this.db.from("automation_runs").update({
        context,
        contact_name: run.contact_name,
        contact_email: run.contact_email,
        contact_phone: run.contact_phone,
        contact_phone_key: run.contact_phone_key,
      }).eq("id", run.id);
      if (configuredClaims(context)[node.id]) return { kind: "proceed", context };
      const claimed = await claimConfiguredWorkflowStage(this.db, {
        organizationId: run.organization_id,
        flowId: flow.id,
        flowVersion: run.flow_version,
        entity: record.entity,
        recordId: record.id,
        stageId: stage.id,
        cadence: stage.cadence,
        occurrenceKey,
        localDate,
        leaseSeconds: 900,
      });
      if (claimed.kind === "blocked") return { kind: "skip", context, reason: "cadence_blocked" };
      if (claimed.kind !== "claimed") {
        return { kind: "fail", context, error: `configured_workflow_claim_${claimed.reason}` };
      }
      const next = withConfiguredClaim(context, node.id, claimed.claim);
      await this.db.from("automation_runs").update({ context: next }).eq("id", run.id);
      return { kind: "proceed", context: next };
    } catch (error) {
      return { kind: "fail", context, error: error instanceof Error ? error.message : "configured workflow gate failed" };
    }
  }

  /**
   * A caixa de WhatsApp que envia: a escolhida no passo, se estiver ligada, ou
   * a primeira caixa por QR code ligada da organização. Só as caixas desta
   * integração (`native_inbox`): as do primeiro Evolution apontam para
   * instâncias que ninguém lê.
   */
  private async whatsappChannel(orgId: string, channelId?: string | null): Promise<
    { id: string; instance: string } | { error: string }
  > {
    let query = this.db
      .from("messaging_channels")
      .select("id, evolution_instance, status, metadata")
      .eq("organization_id", orgId)
      .eq("channel_type", "whatsapp")
      .eq("provider", "evolution")
      .is("archived_at", null)
      .not("evolution_instance", "is", null);
    if (channelId) query = query.eq("id", channelId);
    const { data } = await query.order("created_at", { ascending: true });
    const rows = ((data ?? []) as Array<{ id: string; evolution_instance: string; status: string; metadata: Record<string, unknown> | null }>)
      .filter((c) => c.metadata?.native_inbox === true);
    if (channelId && !rows.length) return { error: "A caixa de WhatsApp escolhida neste passo já não existe" };
    const live = rows.find((c) => c.status === "connected");
    if (!live) {
      return { error: channelId
        ? "A caixa de WhatsApp deste passo está desligada — volte a ler o QR code"
        : "Nenhuma caixa de WhatsApp ligada nesta organização" };
    }
    return { id: live.id, instance: live.evolution_instance };
  }

  /**
   * Travão de envio. O WhatsApp por QR code é o WhatsApp Web: rajadas de
   * mensagens automáticas são o que mais leva a suspender o número. Dois
   * limites, por caixa — um intervalo mínimo entre mensagens e um teto diário.
   * São uma proteção, não uma garantia de que o número não é bloqueado.
   */
  private async throttle(run: Run, channelId: string, visitKey: string): Promise<{ wait: Date } | { error: string } | { claimToken: string } | { replayMessageId: string }> {
    const { data, error } = await this.db.rpc("reserve_automation_whatsapp_send", {
      p_org_id: run.organization_id, p_channel_id: channelId, p_run_id: run.id, p_visit_key: visitKey,
    });
    if (error) return { error: "Não foi possível reservar o envio de WhatsApp: " + error.message };
    if (typeof data?.replay_message_id === "string" && data.replay_message_id.trim()) return { replayMessageId: data.replay_message_id };
    if (data?.review_required === true) return { error: "Envio WhatsApp com resultado incerto; confirme a entrega antes de repetir manualmente" };
    if (data?.ready === true && typeof data.claim_token === "string" && data.claim_token) return { claimToken: data.claim_token };
    const wait = typeof data?.wait_until === "string" ? new Date(data.wait_until) : null;
    if (!wait || !Number.isFinite(wait.getTime())) return { error: "A reserva de WhatsApp não devolveu um horário válido" };
    return { wait };
  }

  /**
   * Envia pelo Evolution e deixa a mensagem na conversa da Caixa de Entrada,
   * como se um agente a tivesse escrito. O evolution-webhook recebe o eco do
   * envio; o índice único (conversa, external_id) faz dele uma repetição.
   */
  /**
   * Procura um telefone ou um email nos clientes e/ou nas leads da organização.
   * Telefone pelos últimos 9 dígitos (gravados com e sem indicativo, com
   * espaços: o padrão apanha os dígitos por ordem e a chave confirma); email
   * sem distinguir maiúsculas. Clientes primeiro, quando procura nos dois.
   */
  private async findInCrm(orgId: string, value: string, where: "clients" | "leads" | "any") {
    const key = phoneKey(value);
    const email = !key && value.includes("@") ? value.trim() : null;
    const by = key ? "telefone" : email ? "email" : null;

    const lookup = async (table: "crm_clients" | "leads") => {
      if (!by) return null;
      const columns = table === "crm_clients" ? "id, name, phone, email, code" : "id, name, phone, email";
      if (key) {
        const { data } = await this.db.from(table).select(columns)
          .eq("organization_id", orgId)
          .ilike("phone", `%${key.split("").join("%")}%`)
          .limit(25);
        return ((data ?? []) as Array<Record<string, unknown>>)
          .find((row) => phoneKey(String(row.phone ?? "")) === key) ?? null;
      }
      // ilike sem coringas: "_" e "%" num email são letras, não padrões.
      const { data } = await this.db.from(table).select(columns)
        .eq("organization_id", orgId)
        .ilike("email", email!.replace(/[\\%_]/g, (ch) => `\\${ch}`))
        .limit(1);
      return ((data ?? []) as Array<Record<string, unknown>>)[0] ?? null;
    };

    const client = where === "leads" ? null : await lookup("crm_clients");
    const lead = client || where === "clients" ? null : await lookup("leads");
    return { client, lead, by };
  }

  private async sendWhatsapp(
    run: Run,
    channel: { id: string; instance: string },
    text: string,
    media: { url: string; mimetype?: string; filename?: string; kind?: string; size?: number } | null,
    claim: { visitKey: string; token: string },
  ): Promise<{ error: string } | { messageId: string | null }> {
    const finalize = async (state: "sent" | "uncertain" | "retryable", messageId: string | null = null): Promise<boolean> => {
      try {
        const { data, error } = await this.db.rpc("finalize_automation_whatsapp_send", {
          p_org_id: run.organization_id, p_channel_id: channel.id, p_run_id: run.id,
          p_visit_key: claim.visitKey, p_claim_token: claim.token, p_state: state, p_message_id: messageId,
        });
        return !error && data?.saved === true;
      } catch { return false; }
    };
    const uncertain = async (): Promise<{ error: string }> => {
      await finalize("uncertain");
      return { error: "Envio WhatsApp com resultado incerto; confirme a entrega antes de repetir manualmente" };
    };
    const base = (Deno.env.get("EVOLUTION_API_URL") || "").replace(/\/$/, "");
    const apikey = Deno.env.get("EVOLUTION_API_KEY") || "";
    let validUrl = false;
    try { validUrl = ["http:", "https:"].includes(new URL(base).protocol); } catch { /* Invalid configuration never reaches the provider. */ }
    if (!validUrl || !apikey) {
      const saved = await finalize("retryable");
      return { error: saved
        ? "Integração de WhatsApp não configurada (endereço ou chave em falta)"
        : "Não foi possível guardar a tentativa não enviada; verifique a configuração de WhatsApp antes de repetir" };
    }

    const number = normalizePhone(run.contact_phone!).replace(/^\+/, "");
    const post = (path: string, body: unknown) =>
      fetch(`${base}${path}/${channel.instance}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });

    let res: Response;
    try {
      if (media?.url) {
        const kind = media.kind
          ?? (media.mimetype?.startsWith("image/") ? "image"
            : media.mimetype?.startsWith("video/") ? "video" : "document");
        res = kind === "audio"
          ? await post("/message/sendWhatsAppAudio", { number, audio: media.url })
          : await post("/message/sendMedia", {
            number,
            mediatype: kind,
            mimetype: media.mimetype || "application/octet-stream",
            media: media.url,
            fileName: media.filename || "anexo",
            ...(text.trim() ? { caption: text } : {}),
          });
      } else {
        res = await post("/message/sendText", { number, text });
      }
    } catch {
      return await uncertain();
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const retryable = res.status === 408 || res.status === 429 || res.status >= 500;
      if (!await finalize(retryable ? "retryable" : "uncertain")) return await uncertain();
      const detail = body?.response?.message;
      if (Array.isArray(detail) && detail.some((d: { exists?: boolean }) => d?.exists === false)) {
        return { error: "Este número não tem WhatsApp" };
      }
      return { error: `Evolution HTTP ${res.status}: ${JSON.stringify(body).slice(0, 200)}` };
    }

    const messageId: string | null = typeof body?.key?.id === "string" && body.key.id.trim() ? body.key.id : null;
    if (!messageId) return await uncertain();
    if (!await finalize("sent", messageId)) return { error: "Envio WhatsApp aceite mas confirmação não guardada; confirme a entrega antes de repetir manualmente" };
    const now = new Date().toISOString();
    const summary = text.trim() || `[${media?.kind ?? "anexo"}]`;
    // Mesmo identificador que o evolution-webhook usa: só dígitos.
    const contactRef = number.replace(/\D/g, "");

    const { data: existing } = await this.db
      .from("meta_conversations")
      .select("id")
      .eq("channel_id", channel.id)
      .eq("contact_ref", contactRef)
      .maybeSingle();
    let convId = existing?.id as string | undefined;
    if (!convId) {
      const { data: created } = await this.db.from("meta_conversations").insert({
        organization_id: run.organization_id,
        channel_id: channel.id,
        contact_ref: contactRef,
        contact_name: run.contact_name,
        last_message: summary,
        last_message_at: now,
        window_expires_at: null,
        status: "open",
      }).select("id").maybeSingle();
      convId = created?.id;
      if (!convId) {
        // Corrida com o webhook a criar a mesma conversa.
        const { data: again } = await this.db.from("meta_conversations").select("id")
          .eq("channel_id", channel.id).eq("contact_ref", contactRef).maybeSingle();
        convId = again?.id;
      }
    } else {
      await this.db.from("meta_conversations")
        .update({ last_message: summary, last_message_at: now, updated_at: now })
        .eq("id", convId);
    }
    if (convId) {
      const { error } = await this.db.from("meta_messages").insert({
        organization_id: run.organization_id,
        conversation_id: convId,
        external_id: messageId,
        direction: "outgoing",
        content: text.trim() || null,
        // Name, type and size too: the Caixa de Entrada draws a document the way
        // WhatsApp does (icon, name, "PDF · 1,1 MB"), not as a bare "Anexo".
        attachments: media?.url
          ? [{
            type: media.kind ?? "document",
            url: media.url,
            filename: media.filename ?? null,
            mime: media.mimetype ?? null,
            size: typeof media.size === "number" ? media.size : null,
          }]
          : [],
        sent_at: now,
        delivery_status: "sent",
      });
      if (error && (error as { code?: string }).code !== "23505") {
        logError("WhatsApp enviado mas não guardado na conversa", { run: run.id, error: error.message });
      }
    }
    return { messageId };
  }

  private async recordStep(
    run: Run, node: FlowNode, status: string, detail: Record<string, unknown>
  ): Promise<boolean> {
    const { error } = await this.db.from("automation_run_steps").insert({
      run_id: run.id,
      organization_id: run.organization_id,
      node_id: visitStepKey(run.context, node.id),
      node_type: node.type,
      status,
      detail: { ...detail, canonical_node_id: node.id, visit: stepVisit(run.context, node.id) },
    });
    if (error) {
      // 23505 = este nó já correu neste percurso. É o índice único a impedir
      // uma reentrega de enviar a mensagem outra vez.
      if ((error as { code?: string }).code === "23505") {
        log("nó já executado neste percurso — a ignorar", { run: run.id, node: node.id });
        return false;
      }
      logError("falha a registar passo", { error: error.message, run: run.id, node: node.id });
      throw new AutomationStepPersistenceError("Não foi possível guardar o histórico deste passo.");
    }
    return true;
  }

  private async recordStepOrFail(
    run: Run, node: FlowNode, status: string, detail: Record<string, unknown>,
  ): Promise<boolean | null> {
    try {
      return await this.recordStep(run, node, status, detail);
    } catch (error) {
      logError("passo sem confirmação persistida — requer revisão", { run: run.id, node: node.id,
        error: error instanceof Error ? error.message : "erro de persistência" });
      run.context = { ...run.context, __requires_review: { node_id: visitStepKey(run.context, node.id), reason: "step_history_not_saved" } };
      await this.finish(run, "failed", "Não foi possível guardar o histórico do passo. O efeito pode já ter sido realizado; reveja a execução antes de repetir.");
      return null;
    }
  }

  async complete(run: Run): Promise<boolean> {
    return await this.finish(run, "completed");
  }

  async fail(run: Run, error: string, expectedUpdatedAt?: string): Promise<boolean> {
    return await this.finish(run, "failed", error, expectedUpdatedAt);
  }

  private async finish(run: Run, status: string, error?: string, expectedUpdatedAt?: string): Promise<boolean> {
    let context = { ...(run.context ?? {}) };
    delete context.__cursors;
    for (const [nodeId, claim] of Object.entries(configuredClaims(context))) {
      const outcome = status === "cancelled" ? "failed" : "unknown";
      const finished = await finishConfiguredWorkflowStage(this.db, {
        executionId: claim.executionId,
        claimToken: claim.claimToken,
        outcome,
        runId: run.id,
        error,
      });
      if (finished.kind === "finished") context = withConfiguredClaim(context, nodeId, null);
      else logError("falha a fechar claim pendente", { run: run.id, nodeId, result: finished.kind });
    }

    let transition = this.db.from("automation_runs").update({
      status, last_error: error ?? null, completed_at: new Date().toISOString(),
      current_node_id: null, wake_at: null, context,
    }).eq("id", run.id).eq("organization_id", run.organization_id)
      .in("status", ["running", "waiting", "awaiting_reply"]);
    if (expectedUpdatedAt) transition = transition.eq("status", "running").eq("updated_at", expectedUpdatedAt);
    const { data: transitioned, error: transitionError } = await transition.select("id").maybeSingle();
    if (transitionError) {
      logError("falha a guardar estado final do percurso", { run: run.id, status, error: transitionError.message });
      return false;
    }
    if (!transitioned) return false;
    if (status !== "failed") return true;
    let flow: Flow | null;
    try { flow = await loadFlow(this.db, run.flow_id); }
    catch (error) { logError("estado final guardado, mas falhou a consulta para avisar o dono", { run: run.id, error: error instanceof Error ? error.message : "erro de persistência" }); return true; }
    if (!flow || flow.organization_id !== run.organization_id) {
      logError("percurso falhou sem automação disponível para avisar o dono", { run: run.id, flow: run.flow_id });
      return true;
    }
    const results = await Promise.allSettled([
      alertAutomationFailure(this.db, run, flow, error ?? "Falha no percurso"),
      applyFailurePolicy(this.db, flow),
    ]);
    const alert = results[0];
    if (alert.status === "fulfilled" && alert.value && typeof alert.value === "object"
      && (("notification" in alert.value && alert.value.notification?.kind === "fail")
        || ("task" in alert.value && alert.value.task?.kind === "fail"))) {
      logError("aviso de falha incompleto", { run: run.id, flow: flow.id });
    }
    for (const [index, result] of results.entries()) {
      if (result.status === "rejected") logError(index === 0 ? "falha a avisar sobre percurso falhado" : "falha a verificar proteção automática", {
        run: run.id, flow: flow.id, error: result.reason instanceof Error ? result.reason.message : "erro inesperado",
      });
    }
    return true;
  }

  /**
   * Guarda todos os caminhos que ficaram à espera. O percurso acorda à hora do
   * mais próximo, e o tick retoma só aqueles cuja hora chegou.
   */
  private async parkAll(run: Run, cursors: Cursor[], context: Record<string, unknown>) {
    const times = cursors.map((c) => c.wake_at).filter((t): t is string => !!t).sort();
    const replying = cursors.find((c) => c.status === "awaiting_reply");
    run.context = context;
    const { error } = await this.db.from("automation_runs").update({
      status: replying ? "awaiting_reply" : "waiting",
      // Continua a nomear um nó: é por ele que handleReply encontra o percurso,
      // e um fluxo de caminho único comporta-se exactamente como antes.
      current_node_id: (replying ?? cursors[0]).node,
      wake_at: times.length ? times[0] : null,
      context: { ...context, __cursors: cursors },
    }).eq("id", run.id).eq("organization_id", run.organization_id).in("status", ["running", "waiting", "awaiting_reply"]);
    if (error) throw new AutomationPersistenceError("Não foi possível guardar a espera do percurso; requer revisão manual.");
  }

  /** Passos que este percurso já executou. */
  private async executedNodes(run: Run, graph: Graph): Promise<Set<string>> {
    const { data, error } = await this.db
      .from("automation_run_steps")
      .select("node_id")
      .eq("run_id", run.id)
      .neq("status", "failed");
    if (error) throw new AutomationPersistenceError("Não foi possível consultar o histórico do percurso; requer revisão manual.");
    return currentVisitExecutedNodes(run.context, graph.nodes, data ?? []);
  }

  /**
   * Percorre o grafo por todos os caminhos abertos até nenhum poder avançar.
   * Um passo com duas arestas de saída põe as duas na fila, por isso os
   * caminhos correm lado a lado na mesma passagem; um que pare numa espera
   * deixa o seu cursor para trás enquanto os outros seguem.
   */
  async advance(run: Run, flow: Flow, start: string | string[] | null, parked: Cursor[] = [], budgetMs = 40_000) {
    try { return await this.advancePersisted(run, flow, start, parked, budgetMs); }
    catch (error) {
      if (!(error instanceof AutomationPersistenceError)) throw error;
      run.context = { ...run.context, __requires_review: { reason: error.message, at: new Date().toISOString() } };
      try { await this.fail(run, error.message); }
      catch (failure) { logError("falha de persistência sem confirmação de estado final", { run: run.id, error: failure instanceof Error ? failure.message : "erro inesperado" }); }
    }
  }

  private async advancePersisted(run: Run, flow: Flow, start: string | string[] | null, parked: Cursor[], budgetMs: number) {
    const invocationStarted = performance.now();
    const graph = flow.graph ?? { nodes: [], edges: [] };
    const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
    const queue: string[] = (Array.isArray(start) ? start : start ? [start] : []).filter(Boolean);
    const stillParked: Cursor[] = [...parked];
    let steps = run.steps_taken;
    let context = (run.context ?? {}) as Record<string, unknown>;

    // Lido uma vez. Dois caminhos que se encontrem no mesmo passo não podem
    // enviar a mesma mensagem duas vezes, e o índice único só apanha isso
    // DEPOIS de o efeito já ter acontecido.
    const done = await this.executedNodes(run, graph);
    for (const cursor of stillParked) done.add(cursor.node);

    const goal = flow.trigger_config?.goal;
    if (!goal && graph.nodes.some(node => node.type === "wait_until")) {
      const tables: Record<string, string> = { lead: "leads", client: "crm_clients", sale: "sales", proposal: "proposals", financial_request: "internal_requests" };
      const table = tables[run.subject_type];
      if (table && run.subject_id) {
        const { data: current, error } = await this.db.from(table).select("*")
          .eq("id", run.subject_id).eq("organization_id", run.organization_id).maybeSingle();
        if (error) {
          await this.finish(run, "failed", "Não foi possível atualizar o registo do percurso: " + error.message);
          return;
        }
        if (current) context = { ...context, ...current };
        run.context = context;
      }
    }

    const checkGoal = async (): Promise<boolean> => {
      if (!goal || typeof goal !== "object" || Array.isArray(goal)) return false;
      run.context = context;
      run.steps_taken = steps;
      try {
        const stopped = await this.stopAtGoal(run, flow);
        context = run.context;
        return stopped;
      } catch (error) {
        await this.finish(run, "failed", error instanceof Error ? error.message : "Não foi possível verificar o objetivo.");
        return true;
      }
    };

    while (queue.length) {
      if (await automationContactSuppressed(this.db, run.organization_id, run.contact_phone, run.contact_email)) {
        await this.finish(run, "cancelled", "Contacto pediu para parar mensagens automáticas");
        return;
      }
      if (await checkGoal()) return;
      if (steps >= flow.max_steps_per_run) {
        logError("limite de passos atingido — possível ciclo no fluxo", { run: run.id, flow: flow.id });
        await this.finish(run, "failed", `Limite de ${flow.max_steps_per_run} passos atingido`);
        return;
      }

      if (performance.now() - invocationStarted >= budgetMs) {
        const wakeAt = new Date().toISOString();
        const pending = [...new Set(queue)].filter(id => !done.has(id));
        if (pending.length) {
          run.context = context;
          run.steps_taken = steps;
          const { error: saveError } = await this.db.from("automation_runs").update({ steps_taken: steps })
            .eq("id", run.id).in("status", ["running", "waiting", "awaiting_reply"]);
          if (saveError) { await this.fail(run, "Não foi possível guardar a continuação do percurso."); return; }
          await this.parkAll(run, [...stillParked, ...pending.map(node => ({ node, status: "waiting" as const, wake_at: wakeAt, resume_self: true }))], context);
          return;
        }
      }

      const cursor = queue.shift() as string;
      if (done.has(cursor)) continue;

      const { data: active, error: activeError } = await this.db.from("automation_runs").select("status")
        .eq("id", run.id).eq("organization_id", run.organization_id).maybeSingle();
      if (activeError) { await this.finish(run, "failed", "Não foi possível confirmar o estado do percurso."); return; }
      if (!active || !["running", "waiting", "awaiting_reply"].includes(active.status)) return;
      if (run.subject_type === "lead" && run.subject_id) {
        const { data: lead, error: leadError } = await this.db.from("leads").select("automation_enabled")
          .eq("id", run.subject_id).eq("organization_id", run.organization_id).maybeSingle();
        if (leadError) { await this.finish(run, "failed", "Não foi possível confirmar a autorização de automações da lead."); return; }
        if (lead?.automation_enabled === false) { await this.finish(run, "cancelled"); return; }
      }
      const node = nodeById.get(cursor);
      if (!node) {
        logError("nó inexistente no grafo", { run: run.id, node: cursor });
        await this.finish(run, "failed", `Nó ${cursor} não existe neste fluxo`);
        return;
      }

      const gate = await this.configuredStageGate(run, flow, node, context);
      context = gate.context;
      run.context = context;
      if (gate.kind === "fail") {
        await this.recordStep(run, node, "failed", { configuracao: gate.error });
        await this.finish(run, "failed", gate.error);
        return;
      }
      if (gate.kind === "skip") {
        await this.recordStep(run, node, "skipped", { motivo: gate.reason });
        done.add(node.id);
        for (const nextId of nextNodeIds(graph, node.id)) {
          if (!done.has(nextId)) queue.push(nextId);
        }
        continue;
      }

      let outcome: Awaited<ReturnType<Engine["execute"]>>;
      try {
        outcome = await this.execute({ ...run, context }, flow, node);
      } catch (error) {
        const message = error instanceof Error ? error.message : "configured workflow action failed";
        try { context = await this.finishConfiguredClaim(run, node.id, context, "unknown", message); }
        catch (claimError) {
          logError("falha a marcar outcome desconhecido", { run: run.id, node: node.id, error: String(claimError) });
        }
        run.context = context;
        await this.finish(run, "failed", message);
        return;
      }

      if (outcome.kind === "park") {
        if (outcome.context) context = outcome.context;
        const wakeAt = outcome.wakeAt ? outcome.wakeAt.toISOString() : null;
        if (outcome.resumeSelf) {
          // Ainda não executou nada: sem linha de passo, e o cursor aponta para
          // ESTE nó para o tick o re-executar fora da janela de silêncio.
          stillParked.push({ node: node.id, status: outcome.status!, wake_at: wakeAt, resume_self: true });
        } else {
          try { context = await this.finishConfiguredClaim(run, node.id, context, "succeeded"); }
          catch (error) {
            run.context = context;
            await this.finish(run, "failed", (error as Error).message);
            return;
          }
          const persisted = await this.recordStepOrFail({ ...run, context }, node, "waiting", outcome.detail ?? {});
          if (persisted === null) return;
          if (!persisted) continue;
          done.add(node.id);
          stillParked.push({ node: node.id, status: outcome.status!, wake_at: wakeAt });
        }
        continue;
      }

      try {
        context = await this.finishConfiguredClaim(
          run,
          node.id,
          context,
          outcome.kind === "fail" ? "unknown" : "succeeded",
          outcome.error,
        );
      } catch (error) {
        run.context = context;
        await this.finish(run, "failed", (error as Error).message);
        return;
      }

      if (outcome.jumpRegion?.some(id => queue.includes(id) || stillParked.some(cursor => cursor.node === id))) {
        outcome = { kind: "fail", error: "Não é possível repetir um segmento com caminhos ainda em execução." };
      }
      steps++;
      const retryKey = "__retry_" + node.id;
      if (outcome.kind === "fail") {
        const retry = decideAutomationRetry(node.config.retry, context[retryKey], { message: outcome.error }, new Date());
        if (retry.kind === "retry") {
          context[retryKey] = retry.state;
          stillParked.push({ node: node.id, status: "waiting", wake_at: retry.wakeAt.toISOString(), resume_self: true });
          continue;
        }
      } else {
        delete context[retryKey];
      }
      if (outcome.kind === "fail" && (node.config.on_error === "continue" || node.config.on_error === "error_branch")) {
        const continuation = planAutomationErrorContinuation(node, graph.edges);
        outcome = continuation.kind === "fail" ? { kind: "fail", error: continuation.error } : {
          kind: "next", branch: continuation.branch,
          detail: { falhou: true, erro: outcome.error, politica: node.config.on_error },
        };
      }
      const fresh = await this.recordStepOrFail({ ...run, context }, node, outcome.kind === "fail" ? "failed" : "ok", outcome.detail ?? {});
      if (fresh === null) return;
      if (outcome.kind === "fail") {
        run.context = context;
        await this.finish(run, "failed", outcome.error);
        return;
      }

      done.add(node.id);
      // Outra passagem chegou aqui primeiro e já seguiu deste passo.
      if (!fresh) continue;

      if (outcome.context) {
        context = outcome.context;
        run.context = context;
        await this.db.from("automation_runs").update({ context }).eq("id", run.id);
      }

      if (outcome.jumpTarget && outcome.jumpRegion) {
        for (const id of outcome.jumpRegion) done.delete(id);
        queue.unshift(outcome.jumpTarget);
        continue;
      }
      // Um "end" fecha o seu caminho. Os outros continuam.
      if (outcome.kind === "end") continue;

      const branch = outcome.branch ?? (node.config.on_error === "error_branch" ? "default" : null);
      for (const nextId of nextNodeIds(graph, node.id, branch)) {
        if (!done.has(nextId)) queue.push(nextId);
      }
    }

    await this.db.from("automation_runs").update({ steps_taken: steps }).eq("id", run.id);
    run.context = context;

    if (await checkGoal()) return;

    if (stillParked.length) {
      await this.parkAll(run, stillParked, context);
      return;
    }
    await this.finish(run, "completed");
  }

  async stopAtGoal(run: Run, flow: Flow): Promise<boolean> {
    const goal = flow.trigger_config?.goal;
    if (!goal || typeof goal !== "object" || Array.isArray(goal)) return false;
    let context = { ...run.context };
    const tables: Record<string, string> = { lead: "leads", client: "crm_clients", sale: "sales", proposal: "proposals", financial_request: "internal_requests" };
    const table = tables[run.subject_type];
    if (table && run.subject_id) {
      const { data, error } = await this.db.from(table).select("*")
        .eq("id", run.subject_id).eq("organization_id", run.organization_id).maybeSingle();
      if (error) throw new Error("Não foi possível verificar o objetivo.");
      if (data) context = { ...context, ...data };
    }
    run.context = context;
    if (!await this.matches({ ...run, context }, flow, { ...goal })) return false;
    context.__goal_reached_at = new Date().toISOString();
    const { data: updated, error: updateError } = await this.db.from("automation_runs")
      .update({ context, steps_taken: run.steps_taken }).eq("id", run.id).eq("organization_id", run.organization_id)
      .in("status", ["running", "waiting", "awaiting_reply"]).select("id").maybeSingle();
    if (updateError) throw new Error("Não foi possível registar o objetivo atingido.");
    if (!updated) return true;
    run.context = context;
    await this.finish(run, "completed");
    return true;
  }

  async matches(run: Run, flow: Flow, config: Record<string, unknown>): Promise<boolean> {
    const outcome = await this.execute(run, flow, { id: "__filter", type: "condition", config });
    if (outcome.kind !== "next") throw new Error(outcome.error ?? "Filtro inválido.");
    return outcome.branch === "yes";
  }

  /** Executa um nó. Não decide o próximo — só diz o que aconteceu. */
  private async execute(originalRun: Run, flow: Flow, node: FlowNode): Promise<NodeOutcome> {
    let run = originalRun;
    const pureControl = ["trigger", "end", "goto", "split_ab"].includes(node.type) || node.type === flow.trigger_type;
    if (!pureControl && originalRun.id) {
      try { run = await resolveActionTarget(this.db, originalRun, node.id === "__filter"); run = { ...run, contact_phone_key: phoneKey(run.contact_phone) }; }
      catch (error) {
        if (error instanceof InvalidActionTarget) return { kind: "fail", error: error.message };
        throw error;
      }
    }
    if (node.id !== "__filter" && run.subject_type === "lead" && run.context.automation_enabled === false) {
      return { kind: "end", detail: { motivo: "Automações desativadas para a lead deste passo.", registo_id: run.subject_id } };
    }
    const cfg = node.config ?? {};
    const vars = buildVars(run);
    const metaOutcome = await executeMetaConversionAction(this.db, { type: node.type, config: { ...cfg, __node_id: visitStepKey(run.context, node.id) }, run, vars });
    if (metaOutcome) return metaOutcome;
    const financeOutcome = await executeFinanceAction(this.db, { type: node.type, config: { ...cfg, __node_id: visitStepKey(run.context, node.id) }, run, vars });
    if (financeOutcome) return financeOutcome;
    const inboxOutcome = await executeInboxAction(this.db, { type: node.type, node_id: visitStepKey(run.context, node.id), config: cfg, run, vars });
    if (inboxOutcome) return inboxOutcome;
    const proposalOutcome = await executeProposalAction(this.db, { type: node.type, node_id: visitStepKey(run.context, node.id), config: cfg, run, vars });
    if (proposalOutcome) return proposalOutcome;
    const businessOutcome = await executeBusinessAction(this.db, { type: node.type, node_id: visitStepKey(run.context, node.id), config: cfg, run, vars });
    if (businessOutcome) return businessOutcome;
    const crmOutcome = await executeCrmAction(this.db, { type: node.type, config: cfg, run, vars });
    if (crmOutcome) return crmOutcome;

    switch (node.type) {
      // O gatilho é apenas o ponto de entrada.
      case "trigger":
      case "configured_workflow":
      case "lead_inactive":
      case "proposal_unanswered":
      case "proposal_expiring":
      case "sale_fidelization_ending":
      case "payment_recorded":
      case "fiscal_document_issued":
      case "email_opened":
      case "email_clicked":
      case "email_bounced":
      case "email_unsubscribed":
      case "lead_updated":
      case "task_created":
      case "task_completed":
      case "task_overdue":
      case "meeting_created":
      case "meeting_status_changed":
      case "meeting_upcoming":
      case "inbound_webhook":
      case "scheduled":
      case "record_date":
      case "lead_created":
      case "lead_status_changed":
      case "form_submitted":
      case "whatsapp_keyword":
      case "sale_status_changed":
      case "list_joined":
      case "list_left":
      case "referral_month_earned":
      case "referral_month_started":
      case "referral_month_ending_2d":
      case "subscription_renewal_due_2d":
      case "stripe_subscription_past_due":
      case "stripe_subscription_created":
      case "stripe_subscription_renewed":
      case "stripe_subscription_canceled":
      case "lead_created_hot":
      case "lead_created_warm":
      case "lead_created_cold":
      case "client_created":
      case "client_status_changed":
      case "proposal_created":
      case "proposal_status_changed":
      case "sale_created":
      case "sale_renewal_due_today":
      case "sale_renewal_due_in_2_days":
      case "sale_renewal_overdue":
      case "sale_payment_overdue_10d":
      case "trial_started":
      case "trial_day_3":
      case "trial_day_7":
      case "trial_expiring_3d":
      case "trial_expiring_1d":
      case "trial_expired":
      case "trial_inactive_48h":
        return { kind: "next", detail: { entrada: node.type } };

      // «Mensagem recebida» com o buffer ligado: o percurso esperou uns
      // segundos de silêncio antes de chegar aqui. Junta tudo o que a pessoa
      // escreveu entretanto numa mensagem só — o que um fluxo do n8n faz com
      // o Redis — e é com isso que o resto do fluxo trabalha.
      case "message_received": {
        const ctx = (run.context ?? {}) as Record<string, unknown>;
        const from = typeof ctx.__collect_from === "string" ? ctx.__collect_from : null;
        const conversationId = typeof ctx.conversa_id === "string" ? ctx.conversa_id : null;
        if (!from || !conversationId) return { kind: "next", detail: { entrada: node.type } };

        const { data: incoming } = await this.db
          .from("meta_messages")
          .select("content, attachments, sent_at")
          .eq("conversation_id", conversationId)
          .eq("direction", "incoming")
          .gte("sent_at", from)
          .order("sent_at", { ascending: true })
          .limit(50);
        const lines = ((incoming ?? []) as Array<{ content: string | null; attachments: Array<{ type?: string }> | null }>)
          .map((m) => (m.content?.trim() || (m.attachments?.[0]?.type ? `[${m.attachments[0].type}]` : "")))
          .filter(Boolean);
        const context = { ...ctx };
        delete context.__collect_from;
        if (lines.length) {
          context.mensagem_inicial = lines.join("\n");
          context.mensagens_agrupadas = lines.length;
        }
        return {
          kind: "next",
          context,
          detail: { entrada: node.type, mensagens_agrupadas: lines.length },
        };
      }

      case "wait_until": {
        const context = { ...run.context };
        const key = "__wait_deadline_" + node.id;
        const stored = context[key];
        const deadline = typeof stored === "string" ? new Date(stored) : new Date(Date.now() + durationMs({
          amount: cfg.timeout_amount ?? 24, unit: cfg.timeout_unit ?? "hours",
        }));
        const condition = await this.execute(run, flow, { ...node, type: "condition" });
        if (condition.kind !== "next") return condition;
        if (condition.context) Object.assign(context, condition.context);
        if (condition.branch === "yes" || Date.now() >= deadline.getTime()) {
          delete context[key];
          const branch = condition.branch === "yes" ? "happened" : "timeout";
          return { kind: "next", branch, context, detail: { ramo: branch, prazo: deadline.toISOString() } };
        }
        context[key] = deadline.toISOString();
        await this.db.from("automation_runs").update({ context }).eq("id", run.id);
        run.context = context;
        return {
          kind: "park", status: "waiting", resumeSelf: true, context,
          wakeAt: new Date(Math.min(deadline.getTime(), Date.now() + 60_000)),
          detail: { prazo: deadline.toISOString() },
        };
      }

      case "wait": {
        const quiet = quietUntil(flow.quiet_hours);
        const base = calculateAutomationWakeAt(cfg, vars, new Date()).getTime();
        const wake = quiet && quiet.getTime() > base ? quiet : new Date(base);
        return {
          kind: "park", status: "waiting", wakeAt: wake,
          detail: { espera_ate: wake.toISOString(), adiado_por_silencio: !!(quiet && quiet.getTime() > base) },
        };
      }

      // WhatsApp por QR code (Evolution), de volta a 2026-10-01 — ver
      // _shared/evolution-inbox.ts. Não há botões: o WhatsApp Web deixou de os
      // entregar (a Evolution responde 2xx e a mensagem não chega a ninguém).
      // As opções vão numeradas no texto e responder "1"/"2" escolhe o ramo
      // no handleReply, tal como as palavras-chave.
      case "wait_reply":
      case "send_whatsapp": {
        const asksOnly = node.type === "wait_reply";
        if (!run.contact_phone) return { kind: "fail", error: "Contacto sem telefone" };

        const rules = (cfg.rules ?? []) as Array<{ id: string; keywords?: string[]; label?: string }>;
        const waitsForReply = asksOnly || (!!cfg.wait_reply && rules.length > 0);
        if (waitsForReply && !run.contact_phone_key) {
          return { kind: "fail", error: "Contacto sem telefone válido — não é possível esperar resposta" };
        }

        const text = render(String((asksOnly ? cfg.question : cfg.message) ?? ""), vars);
        const media = asksOnly ? null : (cfg.media ?? null) as
          | { url?: string; mimetype?: string; filename?: string; kind?: string; size?: number }
          | null;
        const mediaUrl = media?.url ?? (!asksOnly && cfg.media_url ? String(cfg.media_url) : null);
        // O «Esperar resposta» sozinho pode não perguntar nada: a pergunta já
        // foi feita antes, e o nó só espera.
        const sends = !!text.trim() || !!mediaUrl;
        if (!asksOnly && !sends) return { kind: "fail", error: "Mensagem vazia" };

        let sentDetail: Record<string, unknown> = {};
        if (sends) {
          const quiet = quietUntil(flow.quiet_hours);
          if (quiet) {
            return {
              kind: "park", status: "waiting", wakeAt: quiet, resumeSelf: true,
              detail: { adiado_por_horario_de_silencio_ate: quiet.toISOString() },
            };
          }

          const channel = await this.whatsappChannel(run.organization_id, cfg.channel_id ? String(cfg.channel_id) : null);
          if ("error" in channel) return { kind: "fail", error: channel.error };

          const held = await this.throttle(run, channel.id, visitStepKey(run.context, node.id));
          if ("error" in held) return { kind: "fail", error: held.error };
          if ("wait" in held) {
            return {
              kind: "park", status: "waiting", wakeAt: held.wait, resumeSelf: true,
              detail: { adiado_por_reserva_de_envio_ate: held.wait.toISOString(), limite_diario: WHATSAPP_DAILY_CAP },
            };
          }

          // The reply options at the end of the message, in the style the step
          // asks for — "1️⃣ Sim" (default, what older flows send), "1. Sim", or
          // nothing when the text already explains them. Same output as
          // formatReplyOptions in src/lib/automation-nodes.ts (the preview).
          const optionsStyle = cfg.options_style === "number" || cfg.options_style === "none"
            ? cfg.options_style
            : "emoji";
          const listed = waitsForReply && rules.length && optionsStyle !== "none"
            ? rules.map((r, i) => {
              const n = String(i + 1);
              const marker = optionsStyle === "number" ? `${n}.` : [...n].map((d) => `${d}️⃣`).join("");
              return `${marker} ${r.label ?? r.keywords?.[0] ?? ""}`;
            }).join("\n")
            : "";
          const options = listed ? `\n\n${listed}` : "";
          if (requiresSingleBillingEnrollment(flow.trigger_type)) {
            const check = await checkBillingPayment(this.db, run, flow.trigger_type);
            if (check.kind === "unavailable") return { kind: "fail", error: check.reason };
            if (check.kind === "not_due") return { kind: "end", detail: { ignorado: check.reason } };
          }
          if (waitsForReply && !("replayMessageId" in held)) await markReplyBoundary(this.db, run, node.id);
          const sent = "replayMessageId" in held ? { messageId: held.replayMessageId } : await this.sendWhatsapp(run, channel, `${text}${options}`, mediaUrl ? {
            url: mediaUrl,
            mimetype: media?.mimetype,
            filename: media?.filename,
            kind: media?.kind,
            size: media?.size,
          } : null, { visitKey: visitStepKey(run.context, node.id), token: held.claimToken });
          if ("error" in sent) return { kind: "fail", error: sent.error };

          sentDetail = {
            canal: "whatsapp",
            canal_id: channel.id,
            para: run.contact_phone,
            texto: text.slice(0, 300),
            mensagem_id: sent.messageId,
            ...(mediaUrl ? { anexo: media?.filename ?? mediaUrl } : {}),
            ...(waitsForReply ? { opcoes: rules.length } : {}),
          };
        }

        if (!waitsForReply) return { kind: "next", detail: sentDetail };

        if (!sends) await markReplyBoundary(this.db, run, node.id);
        const replyWake = new Date(
          Date.now() + durationMs({
            amount: cfg.timeout_amount ?? (cfg.timeout as { value?: number } | undefined)?.value ?? 24,
            unit: cfg.timeout_unit ?? (cfg.timeout as { unit?: string } | undefined)?.unit ?? "hours",
          }),
        );
        return {
          kind: "park", status: "awaiting_reply", wakeAt: replyWake, context: run.context,
          detail: { ...sentDetail, espera_resposta_ate: replyWake.toISOString(), regras: rules.length },
        };
      }

      case "send_email": {
        if (requiresSingleBillingEnrollment(flow.trigger_type)) {
          const check = await checkBillingPayment(this.db, run, flow.trigger_type);
          if (check.kind === "unavailable") return { kind: "fail", error: check.reason };
          if (check.kind === "not_due") return { kind: "end", detail: { ignorado: check.reason } };
        }
        const recipient = await resolveAutomationEmailRecipient(this.db, run, cfg);
        if (recipient.kind === "fail") return recipient;
        const waitKey = "__email_wait_" + node.id;
        const waiting = run.context[waitKey];
        if (waiting && typeof waiting === "object" && "deadline" in waiting && typeof waiting.deadline === "string") {
          const { data: sent, error: lookupError } = await this.db.from("email_sends")
            .select("opened_at,clicked_at,replied_at,status").eq("organization_id", run.organization_id)
            .eq("automation_run_id", run.id).eq("automation_node_id", visitStepKey(run.context, node.id))
            .not(cfg.wait_event === "replied" ? "replied_at" : cfg.wait_event === "clicked" ? "clicked_at" : "opened_at", "is", null)
            .order("created_at", { ascending: false }).limit(1).maybeSingle();
          if (lookupError) return { kind: "fail", error: "Não foi possível consultar a interação do email." };
          const happened = cfg.wait_event === "replied" ? !!sent?.replied_at : cfg.wait_event === "clicked" ? !!sent?.clicked_at : !!sent?.opened_at;
          const deadline = Date.parse(waiting.deadline);
          if (!Number.isFinite(deadline)) return { kind: "fail", error: "Prazo de interação do email inválido." };
          if (happened || Date.now() >= deadline) {
            const context = { ...run.context }; delete context[waitKey];
            const branch = happened ? "happened" : "timeout";
            return { kind: "next", branch, context, detail: { canal: "email", ramo: branch, evento: cfg.wait_event } };
          }
          return { kind: "park", status: "waiting", resumeSelf: true, context: run.context,
            wakeAt: new Date(Math.min(deadline, Date.now() + 60_000)) };
        }
        const { data, error } = await this.db.functions.invoke("send-template-email", {
          body: {
            organizationId: run.organization_id,
            templateId: cfg.template_id ?? undefined,
            automationRunId: run.id, automationNodeId: visitStepKey(run.context, node.id),
            subject: cfg.subject ? render(String(cfg.subject), vars) : undefined,
            htmlContent: cfg.html ? String(cfg.html) : undefined,
            recipients: [{
              email: recipient.email,
              name: recipient.name,
              clientId: recipient.clientId,
              variables: vars,
            }],
          },
        });
        if (error) return { kind: "fail", error: formatAutomationInvocationError(error, "Email falhou") };
        // send-template-email always answers HTTP 200 (per-recipient outcome
        // lives in the body, not the status code) — a real Brevo rejection
        // never sets `error` above and was silently reported as success. Read
        // the actual per-recipient result instead of trusting the envelope.
        const outcome = (data as { results?: Array<{ status: string; error?: string; email_send_id?: string }> } | null)
          ?.results?.[0];
        if (!outcome || outcome.status !== "sent") {
          return { kind: "fail", error: `Email rejeitado: ${outcome?.error ?? "resposta inesperada de send-template-email"}` };
        }
        if (cfg.wait_event === "opened" || cfg.wait_event === "clicked" || cfg.wait_event === "replied") {
          if (!outcome.email_send_id) return { kind: "fail", error: "Email enviado sem registo de acompanhamento. Confirme o envio antes de repetir." };
          const deadline = new Date(Date.now() + durationMs({ amount: cfg.timeout_amount ?? 24, unit: cfg.timeout_unit ?? "hours" }));
          const context = { ...run.context, [waitKey]: { deadline: deadline.toISOString() } };
          const { error: saveError } = await this.db.from("automation_runs").update({ context }).eq("id", run.id);
          if (saveError) return { kind: "fail", error: "Email enviado, mas não foi possível guardar a espera. Verifique o envio antes de repetir." };
          return { kind: "park", status: "waiting", resumeSelf: true, context,
            wakeAt: new Date(Math.min(deadline.getTime(), Date.now() + 60_000)) };
        }
        return { kind: "next", detail: { canal: "email", para: recipient.email, interno: recipient.internal, template: cfg.template_id ?? null } };
      }

      case "ai_draft":
      case "ai_classify":
      case "ai_summarize":
      case "ai_extract": {
        const { data, error } = await this.db.functions.invoke("automation-ai", { body: {
          run_id: run.id, node_id: node.id, mode: node.type.slice(3),
          text: render(String(cfg.text ?? ""), vars), fields: cfg.fields,
        } });
        if (error) return { kind: "fail", error: formatAutomationInvocationError(error, "Otto falhou") };
        if (!data || !["ready", "review"].includes(data.branch) || !data.variables || typeof data.variables !== "object") {
          return { kind: "fail", error: "Otto não devolveu uma análise válida." };
        }
        if (node.type === "ai_draft") {
          const draft = data.draft;
          if (!draft || typeof draft.suggested_reply !== "string" || !draft.suggested_reply.trim()
            || draft.suggested_reply.length > 2000 || typeof draft.confidence !== "number"
            || draft.confidence < 0 || draft.confidence > 1 || typeof draft.motivo !== "string") {
            return { kind: "fail", error: "Otto não devolveu um rascunho válido para revisão." };
          }
          const { data: taskId, error: taskError } = await this.db.rpc("create_automation_reply_draft", {
            p_run_id: run.id, p_node_id: visitStepKey(run.context, node.id), p_organization_id: run.organization_id,
            p_reply: draft.suggested_reply, p_confidence: draft.confidence, p_reason: draft.motivo,
          });
          if (taskError || typeof taskId !== "string") return { kind: "fail", error: "Não foi possível guardar o rascunho para revisão humana." };
          return { kind: "next", branch: "review", context: { ...run.context,
            otto_rascunho_tarefa_id: taskId, otto_confianca: draft.confidence, otto_motivo_revisao: draft.motivo },
            detail: { ramo: "review", modelo: data.model, confianca: draft.confidence,
              tarefa_revisao: taskId, rascunho: draft.suggested_reply, revisao_humana: true } };
        }
        return { kind: "next", branch: data.branch, context: { ...run.context, ...data.variables },
          detail: { ramo: data.branch, modelo: data.model, confianca: data.variables.otto_confianca } };
      }

      case "goto": {
        const decision = planBoundedJump(flow.graph, run.context, {
          nodeId: node.id, target: cfg.target_node_id, maxVisits: cfg.max_visits, entryNodeId: flow.entry_node_id,
        });
        return { kind: "next", context: decision.context,
          ...(decision.kind === "jump" ? { jumpTarget: decision.target, jumpRegion: decision.region } : {}),
          detail: { repeticao: decision.kind === "jump", destino: cfg.target_node_id } };
      }
      case "split_ab": {
        const subject = run.subject_id ?? run.contact_phone_key ?? run.contact_email ?? run.id;
        const branch = deterministicAssignment(flow.id, subject, cfg.variants);
        return { kind: "next", branch, detail: { ramo: branch } };
      }

      case "filter": {
        const outcome = await this.execute(run, flow, { ...node, type: "condition" });
        if (outcome.kind !== "next") return outcome;
        return { ...outcome, kind: outcome.branch === "yes" ? "next" : "end", branch: null,
          detail: { ...outcome.detail, motivo: outcome.branch === "yes" ? "filtro cumprido" : "não cumpre o filtro" } };
      }

      case "router": {
        if (!Array.isArray(cfg.routes) || cfg.routes.length === 0) {
          return { kind: "fail", error: "Configure pelo menos um caminho no roteador." };
        }
        let context = { ...run.context };
        const tested: string[] = [];
        for (const route of cfg.routes) {
          if (!route || typeof route !== "object" || typeof route.id !== "string" || route.id === "fallback") {
            return { kind: "fail", error: "Caminho inválido no roteador." };
          }
          const outcome = await this.execute({ ...run, context }, flow, {
            ...node, type: "condition", config: { conditions: route.conditions, match: route.match },
          });
          if (outcome.kind !== "next") return outcome;
          if (outcome.context) context = outcome.context;
          tested.push(route.id);
          if (outcome.branch === "yes") return {
            kind: "next", branch: route.id, context,
            detail: { ramo: route.id, caminhos_avaliados: tested },
          };
        }
        return { kind: "next", branch: "fallback", context, detail: { ramo: "fallback", caminhos_avaliados: tested } };
      }

      case "condition": {
        try { validateConditionTree(cfg); } catch (error) {
          return { kind: "fail", error: error instanceof Error ? error.message : "Condição inválida." };
        }
        if (cfg.conditions !== undefined) {
          let context = { ...(run.context ?? {}) };
          try {
            const result = await evaluateConditionGroup(cfg, async (rule) => {
              const outcome = await this.execute({ ...run, context }, flow, {
                ...node, config: rule,
              });
              if (outcome.kind !== "next") {
                throw new Error(outcome.error ?? "Não foi possível avaliar a condição.");
              }
              if (outcome.context) context = outcome.context;
              return outcome.branch === "yes";
            });
            return {
              kind: "next", branch: result.matched ? "yes" : "no", context,
              detail: { combinacao: cfg.match, regras: result.results, resultado: result.matched },
            };
          } catch (error) {
            return { kind: "fail", error: error instanceof Error ? error.message : "Falha ao avaliar grupo de condições." };
          }
        }
        const field = String(cfg.field ?? "");
        const op = String(cfg.operator ?? "equals");
        const expected = typeof cfg.value === "string" ? render(cfg.value, vars) : cfg.value;
        const actual = (vars as Record<string, unknown>)[field];

        // «Existe nos clientes / nas leads / em qualquer um»: o valor do campo
        // (um telefone ou um email) procura-se na base de dados da organização.
        // Sim = existe, Não = não existe; o que encontrou fica no percurso.
        if (op === "in_clients" || op === "in_leads" || op === "in_crm") {
          const where = op === "in_clients" ? "clients" : op === "in_leads" ? "leads" : "any";
          const { client, lead, by } = await this.findInCrm(run.organization_id, String(actual ?? ""), where);
          const found = !!(client || lead);
          const context = { ...(run.context ?? {}), encontrado_em: client ? "cliente" : lead ? "lead" : "" } as Record<string, unknown>;
          if (client) Object.assign(context, { cliente_id: client.id, cliente_nome: client.name ?? "", cliente_codigo: client.code ?? "" });
          if (lead) Object.assign(context, { lead_id: lead.id, lead_nome: lead.name ?? "" });
          return {
            kind: "next",
            branch: found ? "yes" : "no",
            context,
            detail: {
              campo: field,
              operador: op,
              procurou_por: by ?? "nada (o campo não tem telefone nem email)",
              resultado: found,
              ...(client ? { cliente: client.name ?? client.id } : {}),
              ...(lead ? { lead: lead.name ?? lead.id } : {}),
            },
          };
        }

        try {
          const native = flow.trigger_type === "configured_workflow" ? evaluateNativeCondition(field, op, actual, expected) : null;
          if (native && !native.known) return { kind: "fail", error: "Condição não suportada pelo workflow configurado." };
          const yes = native?.known ? native.value : evaluateConditionValue({ field, operator: op, actual, expected });
          return { kind: "next", branch: yes ? "yes" : "no", detail: { campo: field, operador: op, resultado: yes } };
        } catch (error) {
          return { kind: "fail", error: error instanceof Error ? error.message : "Não foi possível comparar a condição." };
        }
      }

      case "move_stage": {
        if (run.subject_type !== "lead" || !run.subject_id) {
          return { kind: "next", detail: { ignorado: "só se aplica a leads" } };
        }
        const { error } = await this.db.from("leads")
          .update({ status: cfg.stage })
          .eq("id", run.subject_id)
          .eq("organization_id", run.organization_id);
        if (error) return { kind: "fail", error: `Mover etapa falhou: ${error.message}` };
        return { kind: "next", detail: { nova_etapa: cfg.stage } };
      }

      case "assign_user": {
        if (!run.subject_id) return { kind: "next", detail: { ignorado: "sem sujeito" } };
        // Só leads e clientes têm responsável. Antes, qualquer outro sujeito
        // (uma venda, uma conversa) ia procurar o seu id à tabela de leads e
        // «atribuía» a nada sem dar erro.
        if (run.subject_type !== "lead" && run.subject_type !== "client") {
          return { kind: "next", detail: { ignorado: "só se aplica a leads e clientes" } };
        }
        const table = run.subject_type === "client" ? "crm_clients" : "leads";
        const { error } = await this.db.from(table)
          .update({ assigned_to: cfg.user_id })
          .eq("id", run.subject_id)
          .eq("organization_id", run.organization_id);
        if (error) return { kind: "fail", error: `Atribuição falhou: ${error.message}` };
        return { kind: "next", detail: { atribuido_a: cfg.user_id } };
      }

      case "add_to_list": {
        if (!cfg.list_id) return { kind: "fail", error: "Escolha a lista de destino." };
        const { data: list, error: listError } = await this.db.from("client_lists").select("id")
          .eq("id", cfg.list_id).eq("organization_id", run.organization_id).maybeSingle();
        if (listError || !list) return { kind: "fail", error: "Lista não encontrada nesta organização." };
        if (!run.contact_email) return { kind: "next", detail: { ignorado: "contacto sem email" } };
        const { data: inserted, error: contactError } = await this.db.from("marketing_contacts").upsert({
          organization_id: run.organization_id, email: run.contact_email,
          name: run.contact_name ?? run.contact_email, source: "automation", subscribed: true,
        }, { onConflict: "organization_id,email", ignoreDuplicates: true }).select("id").maybeSingle();
        if (contactError) return { kind: "fail", error: "Não foi possível preparar o contacto da lista." };
        let contact = inserted;
        if (!contact) {
          const { data: existing, error: lookupError } = await this.db.from("marketing_contacts").select("id")
            .eq("organization_id", run.organization_id).eq("email", run.contact_email).maybeSingle();
          if (lookupError || !existing) return { kind: "fail", error: "Não foi possível consultar o contacto da lista." };
          contact = existing;
        }
        const { error: membershipError } = await this.db.from("marketing_list_members").upsert(
          { list_id: list.id, contact_id: contact.id }, { onConflict: "list_id,contact_id", ignoreDuplicates: true },
        );
        if (membershipError) return { kind: "fail", error: "Não foi possível adicionar o contacto à lista." };
        return { kind: "next", detail: { lista: list.id, contacto: contact.id } };
      }

      case "create_task": {
        const title = render(String(cfg.title ?? ""), vars).trim();
        if (!title) return { kind: "fail", error: "Tarefa sem título" };

        const dueAt = taskDueAt(cfg, new Date());

        const base = {
          organization_id: run.organization_id,
          title,
          description: cfg.description ? render(String(cfg.description), vars) : null,
          due_at: dueAt,
          contact_name: run.contact_name,
          // phone_key é coluna gerada a partir de contact_phone — escrever nela
          // é rejeitado pelo Postgres.
          contact_phone: run.contact_phone,
          assigned_to: (cfg.user_id as string) ?? null,
        };

        const { error } = await this.db.from("inbox_tasks").insert({
          ...base,
          lead_id: run.subject_type === "lead" ? run.subject_id : null,
          client_id: run.subject_type === "client" ? run.subject_id : null,
        });

        if (error) {
          // 23503 = a lead/cliente de origem foi apagada entretanto. A tarefa
          // continua a ser útil (tem nome e telefone) — vale mais criá-la sem a
          // ligação do que deitar o percurso inteiro fora.
          if ((error as { code?: string }).code === "23503") {
            const { error: retryErr } = await this.db.from("inbox_tasks").insert(base);
            if (retryErr) return { kind: "fail", error: `Criar tarefa falhou: ${retryErr.message}` };
            return { kind: "next", detail: { tarefa: title, prazo: dueAt, sem_ligacao: "origem apagada" } };
          }
          return { kind: "fail", error: `Criar tarefa falhou: ${error.message}` };
        }
        return { kind: "next", detail: { tarefa: title, prazo: dueAt } };
      }

      case "webhook": {
        if (requiresSingleBillingEnrollment(flow.trigger_type)) {
          const check = await checkBillingPayment(this.db, run, flow.trigger_type);
          if (check.kind === "unavailable") return { kind: "fail", error: check.reason };
          if (check.kind === "not_due") return { kind: "end", detail: { ignorado: check.reason } };
        }
        return await executeAutomationHttpAction(cfg, vars,
          { run_id: run.id, flow_id: flow.id, contact: vars }, { fetch });
      }

      case "end":
        return { kind: "end", detail: { motivo: cfg.reason ?? "fim do fluxo" } };

      default:
        logError("tipo de nó desconhecido", { type: node.type, flow: flow.id });
        return { kind: "fail", error: `Este motor não suporta o passo ${node.type}.` };
    }
  }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/**
 * Fecha o passo de um nó que estava à espera.
 *
 * O passo já foi registado com status `waiting` quando o percurso parou, e o
 * índice único (run_id, node_id) impede um segundo registo — por isso o
 * desfecho (que ramo, que resposta) tem de ATUALIZAR a linha existente. Antes
 * disto o insert falhava em silêncio e a resposta do contacto desaparecia do
 * histórico, embora o percurso seguisse pelo ramo certo.
 */
// deno-lint-ignore no-explicit-any
async function settleWaitingStep(
  db: any, run: Run, node: FlowNode, detail: Record<string, unknown>,
) {
  const { data: updated, error } = await db
    .from("automation_run_steps")
    .update({ status: "ok", detail: { ...detail, canonical_node_id: node.id, visit: stepVisit(run.context, node.id) } })
    .eq("run_id", run.id)
    .eq("node_id", visitStepKey(run.context, node.id))
    .eq("status", "waiting")
    .select("id");

  if (error) logError("falha a fechar passo de espera", { run: run.id, node: node.id, error: error.message });
  if (!error && (!updated || updated.length === 0)) {
    // Sem linha em espera (percurso antigo, ou retomado por outra via): grava.
    const { error: insErr } = await db.from("automation_run_steps").insert({
      run_id: run.id, organization_id: run.organization_id,
      node_id: visitStepKey(run.context, node.id), node_type: node.type, status: "ok", detail: { ...detail, canonical_node_id: node.id, visit: stepVisit(run.context, node.id) },
    });
    if (insErr) logError("falha a registar desfecho da espera", { run: run.id, node: node.id, error: insErr.message });
  }
}

// deno-lint-ignore no-explicit-any
async function loadFlow(db: any, flowId: string, run?: Run): Promise<Flow | null> {
  const { data, error } = await db.from("automation_flows").select("*").eq("id", flowId).maybeSingle();
  if (error) throw new AutomationPersistenceError("Não foi possível consultar a automação; requer revisão manual.");
  if (!data) return null;
  const snapshot = run?.context?.__flow_snapshot;
  if (snapshot && typeof snapshot === "object" && !Array.isArray(snapshot) && "graph" in snapshot) {
    return { ...data, ...snapshot, status: data.status, organization_id: data.organization_id, id: data.id };
  }
  return data;
}

function deferredContext(nodeId: string | null) {
  return { __cursors: nodeId ? [{ node: nodeId, status: "waiting", wake_at: new Date().toISOString(), resume_self: true }] : [] };
}
function deferredExecution(nodeId: string | null) {
  return { status: "waiting", wake_at: new Date().toISOString(), current_node_id: nodeId };
}

const startConfiguredRecord = (db: any): StartConfiguredRecord => async ({
  flow, record, occurrenceKey, occurrenceLocalDate, timeZone,
}) => {
  if (flow.organization_id !== record.organizationId) throw new Error("configured_workflow_record_scope_mismatch");
  if (!flow.entry_node_id) throw new Error("configured_workflow_entry_missing");
  const subjectType = record.entity === "clients" ? "client"
    : record.entity === "leads" ? "lead"
    : record.entity === "receivables" ? "sale" : "contact";
  const subjectId = await configuredRecordSubjectId(flow.organization_id, record);
  const phone = record.contact?.phone ?? null;
  const context = {
    ...record.fields,
    __configured_workflow_record_id: record.id,
    __configured_workflow_entity: record.entity,
    __configured_workflow_occurrence_key: occurrenceKey,
    __configured_workflow_local_date: occurrenceLocalDate,
    __configured_workflow_time_zone: timeZone,
  };
  const runId = await deterministicUuid(
    `configured-workflow-run:${flow.organization_id}:${flow.id}:${flow.version}:${occurrenceKey}:${record.id}`,
  );
  const { data: run, error } = await db.from("automation_runs").insert({
    id: runId,
    organization_id: flow.organization_id,
    flow_id: flow.id,
    flow_version: flow.version,
    subject_type: subjectType,
    subject_id: subjectId,
    contact_name: record.contact?.name ?? null,
    contact_email: record.contact?.email ?? null,
    contact_phone: phone,
    contact_phone_key: phoneKey(phone),
    context,
    current_node_id: flow.entry_node_id,
  }).select("*").single();
  if (error || !run) {
    if ((error as { code?: string } | null)?.code === "23505") {
      const { data: sameRun } = await db.from("automation_runs").select("id").eq("id", runId).maybeSingle();
      if (sameRun?.id === runId) return;
      throw new Error("configured_workflow_subject_busy");
    }
    throw new Error("configured_workflow_run_create_failed");
  }
  const nativeFlow: Flow = {
    id: flow.id,
    organization_id: flow.organization_id,
    name: flow.name,
    status: flow.status,
    trigger_type: flow.trigger_type,
    graph: {
      nodes: flow.graph.nodes.map((node) => ({ id: node.id, type: node.type, config: { ...node.config } })),
      edges: flow.graph.edges.map((edge) => ({ ...edge })),
    },
    entry_node_id: flow.entry_node_id,
    version: flow.version,
    reentry_policy: flow.reentry_policy,
    quiet_hours: flow.quiet_hours ? { ...flow.quiet_hours } : null,
    max_steps_per_run: flow.max_steps_per_run,
    trigger_config: { ...flow.trigger_config },
  };
  try {
    await new Engine(db).advance(run as Run, nativeFlow, flow.entry_node_id);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "configured workflow action outcome unknown";
    await db.from("automation_runs").update({ status: "failed", last_error: message }).eq("id", run.id);
    throw cause;
  }
};

// deno-lint-ignore no-explicit-any
async function handleEnroll(db: any, body: Record<string, unknown>, deferExecution = false) {
  const triggerType = String(body.trigger_type ?? "");
  const orgId = String(body.organization_id ?? "");
  const record = (body.record ?? {}) as Record<string, unknown>;
  if (!triggerType || !orgId) return { error: "trigger_type e organization_id são obrigatórios" };

  let configured: unknown;
  try {
    configured = await runConfiguredNativeEvent(db, orgId, triggerType, record, startConfiguredRecord(db));
  } catch (error) {
    configured = { matched: 0, error: (error as Error).message };
    logError("falha no gatilho nativo de workflow configurado", { triggerType, orgId, error: (error as Error).message });
  }

  const { data: flows, error: flowsError } = await db
    .from("automation_flows")
    .select("*")
    .eq("organization_id", orgId)
    .eq("trigger_type", triggerType)
    .eq("status", "active");

  if (flowsError) throw new Error("Não foi possível consultar as automações de entrada.");
  if (!flows?.length) return { enrolled: 0, configured, message: "Nenhum fluxo legado ativo para este gatilho" };

  const engine = new Engine(db);
  const results: Array<Record<string, unknown>> = [];

  for (const flow of flows as Flow[]) {
    if (String(body.subject_type ?? "lead") === "lead" && record.automation_enabled === false) {
      results.push({ flow: flow.id, skipped: "automações desativadas para esta lead" }); continue;
    }
    if (typeof body.flow_id === "string" && flow.id !== body.flow_id) continue;
    // Trigger-level filters: a flow scoped to one form (or one pipeline stage)
    // must ignore events from the others, otherwise activating it would blast
    // every lead in the organization.
    const tcfg = (flow.trigger_config ?? {}) as Record<string, unknown>;
    if ((triggerType === "list_joined" || triggerType === "list_left") && tcfg.list_id && record.list_id !== tcfg.list_id) {
      results.push({ flow: flow.id, skipped: "outra lista" }); continue;
    }
    if (triggerType === "form_submitted" && tcfg.form_id && record.form_id !== tcfg.form_id) {
      results.push({ flow: flow.id, skipped: "outro formulário" });
      continue;
    }
    if (triggerType.endsWith("_status_changed")) {
      let stages: PipelineStageIdentity[] = [];
      if (tcfg.from_stage_id || tcfg.to_stage_id) {
        const { data: stageRows, error: stageError } = await db.from("pipeline_stages")
          .select("id,key").eq("organization_id", orgId);
        if (stageError) { results.push({ flow: flow.id, error: "Não foi possível verificar as etapas configuradas." }); continue; }
        stages = stageRows ?? [];
      }
      const previous = body.old_record;
      const previousStatus = previous && typeof previous === "object" && !Array.isArray(previous) && "status" in previous ? previous.status : undefined;
      const transition = matchesStageTransition(tcfg, record.status, previousStatus, stages);
      if (!transition.matches) { results.push({ flow: flow.id, skipped: transition.reason }); continue; }
    }

    if (tcfg.filters && typeof tcfg.filters === "object" && !Array.isArray(tcfg.filters)) {
      const candidate: Run = {
        id: "", organization_id: orgId, flow_id: flow.id, flow_version: flow.version,
        subject_type: String(body.subject_type ?? "lead"), subject_id: typeof record.id === "string" ? record.id : null,
        contact_name: String(record.name ?? record.nome ?? ""), contact_email: String(record.email ?? ""),
        contact_phone: String(record.phone ?? record.telefone ?? ""), contact_phone_key: null,
        status: "running", current_node_id: flow.entry_node_id, context: { ...record }, steps_taken: 0,
      };
      if (!await engine.matches(candidate, flow, { ...tcfg.filters })) {
        results.push({ flow: flow.id, skipped: "não cumpre o filtro de entrada" });
        continue;
      }
    }

    const subjectType = String(body.subject_type ?? "lead");
    const originId = typeof record.id === "string" ? record.id : null;
    const identity = { id: originId, phoneKey: phoneKey(String(record.phone ?? record.telefone ?? "")), email: typeof record.email === "string" ? record.email : null };
    let subjectId = originId;
    try { if (subjectType === "contact") subjectId = await automationContactSubjectId(orgId, identity); }
    catch (error) {
      if (error instanceof InvalidAutomationContactIdentity) { results.push({ flow: flow.id, error: error.message }); continue; }
      throw error;
    }


    const billingEnrollment = requiresSingleBillingEnrollment(triggerType);
    const preventsRepeatedEnrollment =
      flow.reentry_policy === "once" || requiresSingleBillingEnrollment(triggerType);
    if (subjectId && (preventsRepeatedEnrollment || subjectType === "contact")) {
      let priorQuery = db.from("automation_runs").select("id").eq("organization_id", orgId)
        .eq("flow_id", flow.id).eq("subject_type", subjectType)
        .or("context->>__test.is.null,context->>__test.neq.true");
      if (subjectType === "contact") {
        const filter = contactRunIdentityFilter({ ...identity, id: subjectId });
        priorQuery = filter.insensitive ? priorQuery.ilike(filter.column, filter.value) : priorQuery.eq(filter.column, filter.value);
        if (!preventsRepeatedEnrollment) priorQuery = priorQuery.in("status", ["running", "waiting", "awaiting_reply"]);
      } else priorQuery = priorQuery.eq("subject_id", subjectId);
      if (billingEnrollment) priorQuery = priorQuery.eq("flow_version", flow.version);
      const { data: prior, error: priorError } = await priorQuery.limit(1);
      if (priorError) throw new Error("Não foi possível verificar as inscrições anteriores.");
      if (prior?.length) { results.push({ flow: flow.id, skipped: preventsRepeatedEnrollment ? "já entrou neste fluxo" : "já tem um percurso ativo" }); continue; }
    }

    try {
      const decision = await checkAutomationReentry(db, flow, { type: String(body.subject_type ?? "lead"), id: subjectId,
        phoneKey: identity.phoneKey, email: identity.email, now: new Date() });
      if (!decision.allowed) {
        results.push({ flow: flow.id, skipped: "intervalo mínimo de reentrada ainda não terminou", next_entry_at: decision.eligibleAt?.toISOString() });
        continue;
      }
    } catch (error) {
      if (error instanceof InvalidAutomationReentry) { results.push({ flow: flow.id, error: error.message }); continue; }
      throw error;
    }

    let contact = record;
    if (subjectType === "sale" || subjectType === "proposal") {
      const linkedId = record.client_id ?? record.lead_id;
      if (typeof linkedId === "string") {
        const { data: linked, error: linkedError } = await db.from(record.client_id ? "crm_clients" : "leads")
          .select("name,email,phone").eq("id", linkedId).eq("organization_id", orgId).maybeSingle();
        if (linkedError) { results.push({ flow: flow.id, error: "Não foi possível obter o contacto do registo." }); continue; }
        if (linked) contact = linked;
      }
    }
    const phone = (contact.phone ?? contact.telefone ?? null) as string | null;
    const runId = billingEnrollment && subjectId
      ? await deterministicUuid(`automation-run:${triggerType}:${String(record.payment_source ?? "payment")}:${String(record.payment_id ?? subjectId)}:${flow.id}:${flow.version}`)
      : null;
    const { data: run, error } = await db.from("automation_runs").insert({
      ...(runId ? { id: runId } : {}),
      organization_id: orgId,
      flow_id: flow.id,
      flow_version: flow.version,
      enrollment_key: typeof body.occurrence_key === "string" ? body.occurrence_key : null,
      subject_type: String(body.subject_type ?? "lead"),
      subject_id: subjectId,
      contact_name: (contact.name ?? contact.nome ?? null) as string | null,
      contact_email: subjectType === "contact" ? normalizedAutomationEmail(identity.email) : (contact.email ?? null) as string | null,
      contact_phone: phone,
      contact_phone_key: phoneKey(phone),
      context: { ...record, ...(subjectType === "contact" && originId ? { __origin_subject_id: originId } : {}), ...(Array.isArray(body.flow_chain) ? { __flow_chain: body.flow_chain } : {}),
        ...(deferExecution ? deferredContext(flow.entry_node_id) : {}) },
      current_node_id: flow.entry_node_id,
      ...(deferExecution ? deferredExecution(flow.entry_node_id) : {}),
    }).select("*").single();

    if (error) {
      // 23505 = já existe um percurso ativo deste contacto neste fluxo.
      if ((error as { code?: string }).code === "23505") {
        results.push({ flow: flow.id, skipped: "já tem um percurso ativo" });
        continue;
      }
      logError("falha a inscrever", { flow: flow.id, error: error.message });
      results.push({ flow: flow.id, error: error.message });
      continue;
    }

    await db.from("automation_flows").update({ last_enrolled_at: new Date().toISOString() }).eq("id", flow.id);
    if (!deferExecution) {
      const pinned = await loadFlow(db, flow.id, run as Run) ?? flow;
      await engine.advance(run as Run, pinned, pinned.entry_node_id);
    }
    results.push({ flow: flow.id, run: run.id, ...(deferExecution ? { queued: true } : {}) });
  }

  return { enrolled: results.filter((r) => r.run).length, ...(deferExecution ? { queued: results.filter((r) => r.run).length } : {}), results, configured };
}

async function markReplyBoundary(db: Parameters<typeof resolveAutomationEmailRecipient>[0], run: Run, nodeId: string) {
  const context = { ...run.context, ["__reply_after_" + nodeId]: new Date().toISOString(), __action_reply_phone_key: phoneKey(run.contact_phone) };
  const { error } = await db.from("automation_runs").update({ context }).eq("id", run.id).eq("organization_id", run.organization_id);
  if (error) throw new Error("Não foi possível guardar o início da espera por resposta.");
  run.context = context;
}

async function resumePersistedReply(
  db: Parameters<typeof resolveAutomationEmailRecipient>[0], run: Run, flow: Flow, engine: Engine, maxMs = 40_000,
): Promise<boolean> {
  const node = flow.graph.nodes.find(node => node.id === run.current_node_id);
  if (!node || (node.type !== "wait_reply" && node.type !== "send_whatsapp")) return false;
  const cursor = readCursors(run).find(cursor => cursor.node === node.id && cursor.status === "awaiting_reply");
  if (!cursor && readCursors(run).length) return false;
  let fallback = run.started_at ?? null;
  if (typeof run.context["__reply_after_" + node.id] !== "string") {
    const { data: step, error } = await db.from("automation_run_steps").select("created_at")
      .eq("run_id", run.id).eq("node_id", visitStepKey(run.context, node.id)).eq("status", "waiting")
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (error) throw new Error("Não foi possível consultar o início da espera por resposta.");
    if (typeof step?.created_at === "string") fallback = step.created_at;
  }
  const reply = eligiblePersistedReply(run.context, node.id, fallback, cursor?.wake_at ?? (typeof run.context["__reply_deadline_" + node.id] === "string" ? String(run.context["__reply_deadline_" + node.id]) : run.wake_at ?? null));
  if (!reply) return false;
  const rules = (node.config?.rules ?? []) as Array<{ id: string; keywords?: string[]; label?: string }>;
  const matched = replyRuleBranch(reply.text, rules);
  const context = { ...run.context, __reply_consumed_at: reply.receivedAt };
  const { error } = await db.from("automation_runs").update({ context }).eq("id", run.id).eq("status", "running");
  if (error) throw new Error("Não foi possível guardar o processamento da resposta.");
  await settleWaitingStep(db, run, node, { ramo: matched.branch, resposta: reply.text.slice(0, 300), regra: matched.label ?? "nenhuma correspondência" });
  let starts = nextNodeIds(flow.graph, node.id, matched.branch);
  if (!starts.length && matched.branch !== "fallback") starts = nextNodeIds(flow.graph, node.id, "fallback");
  const rest = readCursors(run).filter(cursor => cursor.node !== node.id);
  await engine.advance({ ...run, status: "running", context }, flow, starts, rest, maxMs);
  return true;
}

// deno-lint-ignore no-explicit-any
async function handleTick(db: any) {
  let configured: unknown;
  try {
    configured = await runDueConfiguredWorkflows(db, startConfiguredRecord(db));
  } catch (error) {
    configured = { claimed: 0, completed: 0, failed: 1, error: (error as Error).message };
    logError("falha no tick de workflows configurados", configured);
  }
  const deadline = Date.now() + 40_000;
  const staleBefore = new Date(Date.now() - 5 * 60_000).toISOString();
  const { data: stale, error: staleError } = await db.from("automation_runs").select("*")
    .eq("status", "running").lte("updated_at", staleBefore).order("updated_at").limit(100);
  if (staleError) throw new AutomationPersistenceError("Não foi possível verificar percursos interrompidos.");
  const recoveryEngine = new Engine(db);
  let recovered = 0;
  for (const run of stale ?? []) {
    if (Date.now() >= deadline) break;
    try {
      const reason = "Execução interrompida há mais de cinco minutos; requer revisão manual antes de repetir.";
      run.context = { ...run.context, __requires_review: { reason, at: new Date().toISOString() } };
      if (await recoveryEngine.fail(run, reason, run.updated_at)) recovered++;
    } catch (error) { logError("falha ao recuperar percurso interrompido", { run: run.id, error: error instanceof Error ? error.message : "erro inesperado" }); }
  }
  const { count: goalCount } = await db.from("automation_runs").select("id", { count: "exact", head: true })
    .in("status", ["waiting", "awaiting_reply"])
    .not("context->__flow_snapshot->trigger_config->goal", "is", null);
  if (goalCount) {
    const page = Math.floor(Date.now() / 60_000) % Math.ceil(goalCount / 100);
    const { data: goals } = await db.from("automation_runs").select("*")
      .in("status", ["waiting", "awaiting_reply"])
      .not("context->__flow_snapshot->trigger_config->goal", "is", null)
      .order("started_at").range(page * 100, page * 100 + 99);
    const goalEngine = new Engine(db);
    for (const run of goals ?? []) {
      if (Date.now() >= deadline) break;
      try {
        const flow = await loadFlow(db, run.flow_id, run);
        if (flow) await goalEngine.stopAtGoal(run, flow);
      } catch (error) {
        logError("falha ao verificar objetivo em espera", { run: run.id, error: error instanceof Error ? error.message : "erro inesperado" });
      }
    }
  }
  const { data: due } = await db
    .from("automation_runs")
    .select("*")
    .in("status", ["waiting", "awaiting_reply"])
    .lte("wake_at", new Date().toISOString())
    .order("wake_at", { ascending: true })
    .limit(100);

  if (!due?.length) return { woken: 0, recovered, configured };

  const engine = new Engine(db);
  let woken = 0, failed = 0;

  for (const run of due as Run[]) {
    if (Date.now() >= deadline) break;
    // Claim: só avança quem conseguir mudar o estado, para dois ticks em
    // paralelo não executarem o mesmo percurso (o process-automation-queue
    // antigo não faz isto e pode duplicar envios).
    const { data: claimed } = await db.from("automation_runs")
      .update({ status: "running" })
      .eq("id", run.id)
      .in("status", ["waiting", "awaiting_reply"])
      .select("*")
      .maybeSingle();
    if (!claimed) continue;
    Object.assign(run, claimed, { status: run.status });

    try {
    const flow = await loadFlow(db, run.flow_id, run);
    if (!flow) { await engine.fail(run, "Fluxo apagado"); failed++; continue; }

    if (run.status === "awaiting_reply" && await resumePersistedReply(db, run, flow, engine, Math.max(0, deadline - Date.now()))) { woken++; continue; }
    const wasAwaitingReply = run.status === "awaiting_reply";
    const nodes = flow.graph?.nodes ?? [];
    const node = nodes.find((n) => n.id === run.current_node_id);
    const cursors = readCursors(run);
      if (cursors.length) {
        // Um percurso pode estar parado em vários caminhos ao mesmo tempo.
        // Retoma os que já venceram e volta a guardar os restantes tal como
        // estavam, para cada espera acordar à sua própria hora.
        const nowMs = Date.now();
        const due = cursors.filter((c) => !c.wake_at || Date.parse(c.wake_at) <= nowMs);
        const rest = cursors.filter((c) => !due.includes(c));
        const starts: string[] = [];

        for (const cursor of due) {
          const parkedNode = nodes.find((n) => n.id === cursor.node);
          if (!parkedNode) continue;
          if (cursor.resume_self) {
            // Adiado pelo horário de silêncio: re-executa o próprio nó.
            starts.push(parkedNode.id);
          } else if (cursor.status === "awaiting_reply") {
            await settleWaitingStep(db, run, parkedNode, {
              ramo: "timeout", motivo: "sem resposta dentro do prazo",
            });
            starts.push(...nextNodeIds(flow.graph, parkedNode.id, "timeout"));
          } else {
            await settleWaitingStep(db, run, parkedNode, { espera_concluida: true });
            starts.push(...nextNodeIds(flow.graph, parkedNode.id));
          }
        }

        await engine.advance({ ...run, status: "running" }, flow, starts, rest, Math.max(0, deadline - Date.now()));
      } else if (wasAwaitingReply && node) {
        // Esgotou o tempo de espera: segue pelo ramo "timeout".
        await settleWaitingStep(db, run, node, {
          ramo: "timeout", motivo: "sem resposta dentro do prazo",
        });
        const next = nextNodeId(flow.graph, node.id, "timeout");
        if (!next) { await engine.complete(run); woken++; continue; }
        await engine.advance({ ...run, status: "running" }, flow, next, [], Math.max(0, deadline - Date.now()));
      } else if (node && (run.context as Record<string, unknown>)?.__resume_node === node.id) {
        // Parou ANTES de executar (adiado pelo horário de silêncio): re-executa
        // o próprio nó, agora fora da janela. Limpa a marca primeiro para não
        // voltar a entrar aqui em ciclo.
        const context = { ...run.context };
        delete (context as Record<string, unknown>).__resume_node;
        await db.from("automation_runs").update({ context }).eq("id", run.id);
        await engine.advance({ ...run, status: "running", context }, flow, node.id, [], Math.max(0, deadline - Date.now()));
      } else {
        if (node) await settleWaitingStep(db, run, node, { espera_concluida: true });
        const next = node ? nextNodeId(flow.graph, node.id) : run.current_node_id;
        await engine.advance({ ...run, status: "running" }, flow, next, [], Math.max(0, deadline - Date.now()));
      }
      woken++;
    } catch (e) {
      logError("percurso falhou no tick", { run: run.id, error: (e as Error).message });
      if (e instanceof AutomationPersistenceError) run.context = { ...run.context, __requires_review: { reason: e.message, at: new Date().toISOString() } };
      await engine.fail(run, e instanceof Error ? e.message : "Falha inesperada ao retomar o percurso.");
      failed++;
    }
  }

  if (failed > 0) logError("tick terminou com falhas", { failed });
  return { woken, failed, recovered, configured };
}

/**
 * Corre um fluxo contra um contacto à escolha, sem esperar pelo gatilho.
 *
 * Serve para o utilizador se enviar as mensagens a si próprio antes de expor o
 * fluxo a clientes — sem isto, a primeira execução a sério é sempre com um
 * cliente real. Funciona com o fluxo em rascunho de propósito (é esse o ponto),
 * ignora a política de reentrada, e marca o percurso no contexto para o
 * separador Atividade o poder distinguir de tráfego verdadeiro.
 */
// deno-lint-ignore no-explicit-any
async function handleTest(db: any, body: Record<string, unknown>) {
  const flowId = String(body.flow_id ?? "");
  if (!flowId) return { error: "flow_id é obrigatório" };

  const flow = await loadFlow(db, flowId);
  if (!flow) return { error: "Fluxo não encontrado" };

  const phone = body.phone ? String(body.phone) : null;
  const email = body.email ? String(body.email) : null;
  if (!phone && !email) return { error: "Indique um telefone ou email para o teste" };

  const { data: run, error } = await db.from("automation_runs").insert({
    organization_id: flow.organization_id,
    flow_id: flow.id,
    flow_version: flow.version,
    subject_type: "contact",
    // subject_id fica nulo: o índice único de percurso ativo por contacto só se
    // aplica quando há sujeito, por isso um teste nunca colide com o percurso
    // real da mesma pessoa nem o bloqueia.
    subject_id: null,
    contact_name: body.name ? String(body.name) : "Contacto de teste",
    contact_email: email,
    contact_phone: phone,
    contact_phone_key: phoneKey(phone),
    context: {
      __test: true,
      nome: body.name ? String(body.name) : "Contacto de teste",
      email, telefone: phone,
    },
    current_node_id: flow.entry_node_id,
  }).select("*").single();

  if (error) {
    logError("falha a iniciar teste", { flow: flowId, error: error.message });
    return { error: error.message };
  }

  const pinned = await loadFlow(db, flow.id, run as Run) ?? flow;
  await new Engine(db).advance(run as Run, pinned, pinned.entry_node_id);

  const { data: fresh } = await db
    .from("automation_runs").select("status, last_error").eq("id", run.id).maybeSingle();

  return { run_id: run.id, status: fresh?.status ?? "running", error: fresh?.last_error ?? null };
}

/**
 * Repete uma execução terminada — o "retry" do n8n.
 *
 *   from: "failed_step" → retoma o MESMO percurso no passo que falhou. Tudo o
 *                         que correu antes fica como está; só esse passo volta
 *                         a executar (a linha falhada é apagada para o poder).
 *   from: "start"       → percurso NOVO para o mesmo contacto e o mesmo
 *                         registo, desde o gatilho.
 *
 * Uma execução cancelada ou concluída não tem passo falhado: repete do início.
 */
// deno-lint-ignore no-explicit-any
async function handleRetry(db: any, body: Record<string, unknown>, deferExecution = false) {
  const runId = String(body.run_id ?? "");
  const from = body.from === "start" ? "start" : "failed_step";
  if (!runId) return { error: "run_id é obrigatório" };

  const { data: run } = await db.from("automation_runs").select("*").eq("id", runId).maybeSingle();
  if (!run) return { error: "Execução não encontrada" };
  if (!["failed", "cancelled", "completed"].includes(run.status)) {
    return { error: "Esta execução ainda está a correr. Pára-a primeiro, ou espera que termine." };
  }
  const flow = await loadFlow(db, run.flow_id, run);
  if (!flow) return { error: "Fluxo apagado" };

  let retrySubjectId = run.subject_id;
  if (run.subject_type === "contact" && run.context?.__test !== true) {
    const identity = { id: run.subject_id, phoneKey: run.contact_phone_key ?? phoneKey(run.contact_phone), email: run.contact_email };
    try {
      retrySubjectId = await automationContactSubjectId(run.organization_id, identity);
      const filter = contactRunIdentityFilter(identity);
      let activeQuery = db.from("automation_runs").select("id").eq("organization_id", run.organization_id)
        .eq("flow_id", run.flow_id).eq("subject_type", "contact").neq("id", run.id)
        .in("status", ["running", "waiting", "awaiting_reply"])
        .or("context->>__test.is.null,context->>__test.neq.true");
      activeQuery = filter.insensitive ? activeQuery.ilike(filter.column, filter.value) : activeQuery.eq(filter.column, filter.value);
      const { data: active, error: activeError } = await activeQuery.limit(1);
      if (activeError) return { error: "Não foi possível verificar percursos ativos deste contacto." };
      if (active?.length) return { error: "Este contacto já tem um percurso ativo neste fluxo. Pára-o primeiro." };
    } catch (error) {
      if (error instanceof InvalidAutomationContactIdentity) return { error: error.message };
      throw error;
    }
  }

  const engine = new Engine(db);
  const context = { ...((run.context ?? {}) as Record<string, unknown>) };
  delete context.__cursors;
  delete context.__resume_node;

  if (from === "failed_step" && run.status === "failed") {
    const { data: failedSteps } = await db.from("automation_run_steps")
      .select("id, node_id")
      .eq("run_id", run.id)
      .eq("status", "failed")
      .order("created_at", { ascending: false })
      .limit(1);
    const failedStoredId = failedSteps?.[0]?.node_id as string | undefined;
    const failedNodeId = failedStoredId ? canonicalStepNodeId(failedStoredId) : undefined;
    const node = failedNodeId ? flow.graph?.nodes?.find((n) => n.id === failedNodeId) : undefined;

    if (node) {
      delete context["__retry_" + node.id];
      // Um passo corre uma vez por percurso: a linha falhada tem de sair para
      // o motor o deixar executar outra vez.
      await db.from("automation_run_steps").delete()
        .eq("run_id", run.id).eq("node_id", failedStoredId).eq("status", "failed");
      const { data: claimed } = await db.from("automation_runs").update({
        status: deferExecution ? "waiting" : "running",
        last_error: null,
        completed_at: null,
        wake_at: deferExecution ? new Date().toISOString() : null,
        current_node_id: node.id,
        context: { ...context, __retried_at: new Date().toISOString(), ...(deferExecution ? deferredContext(node.id) : {}) },
      }).eq("id", run.id).eq("status", "failed").select("*").maybeSingle();
      if (!claimed) return { error: "A execução mudou entretanto. Tenta outra vez." };

      if (deferExecution) return { run_id: run.id, resumed_at: node.id, status: "waiting", queued: true, error: null };
      await engine.advance(claimed as Run, flow, node.id);
      const { data: fresh } = await db.from("automation_runs")
        .select("status, last_error").eq("id", run.id).maybeSingle();
      return { run_id: run.id, resumed_at: node.id, status: fresh?.status ?? "running", error: fresh?.last_error ?? null };
    }
    // Falhou antes de qualquer passo ficar registado (fluxo apagado, nó em
    // falta): não há onde retomar — começa de novo.
  }

  const currentFlow = await loadFlow(db, run.flow_id);
  if (!currentFlow) return { error: "Fluxo apagado" };
  for (const key of Object.keys(context)) {
    if (key.startsWith("__wait_deadline_") || key.startsWith("__retry_") || key === "__goal_reached_at" || key === "__flow_snapshot" || key === "__node_visits" || key === "__jump_counts" || key.startsWith("__email_wait_")) delete context[key];
  }
  const { data: created, error } = await db.from("automation_runs").insert({
    organization_id: run.organization_id,
    flow_id: currentFlow.id,
    flow_version: currentFlow.version,
    subject_type: run.subject_type,
    subject_id: retrySubjectId,
    contact_name: run.contact_name,
    contact_email: run.contact_email,
    contact_phone: run.contact_phone,
    contact_phone_key: run.contact_phone_key,
    context: { ...context, __retry_of: run.id, ...(deferExecution ? deferredContext(currentFlow.entry_node_id) : {}) },
    current_node_id: currentFlow.entry_node_id,
    ...(deferExecution ? deferredExecution(currentFlow.entry_node_id) : {}),
  }).select("*").single();
  if (error) {
    if ((error as { code?: string }).code === "23505") {
      return { error: "Este contacto já tem um percurso ativo neste fluxo. Pára-o primeiro." };
    }
    return { error: error.message };
  }

  if (deferExecution) return { run_id: created.id, status: "waiting", queued: true, error: null };
  const pinned = await loadFlow(db, currentFlow.id, created as Run) ?? currentFlow;
  await engine.advance(created as Run, pinned, pinned.entry_node_id);
  const { data: fresh } = await db.from("automation_runs")
    .select("status, last_error").eq("id", created.id).maybeSingle();
  return { run_id: created.id, status: fresh?.status ?? "running", error: fresh?.last_error ?? null };
}

/**
 * Nenhum percurso à espera desta pessoa — mas a mensagem pode arrancar um
 * fluxo. Dois gatilhos:
 *
 *   whatsapp_keyword  — o texto contém uma das palavras configuradas.
 *   message_received  — qualquer mensagem, na caixa escolhida (ou em qualquer
 *                       caixa de WhatsApp, sem caixa escolhida).
 *
 * O específico ganha: se uma palavra-chave arrancou um fluxo, os de
 * «Mensagem recebida» ficam quietos — senão quem escrevesse a palavra da
 * campanha recebia a oferta e a mensagem genérica ao mesmo tempo.
 */
// deno-lint-ignore no-explicit-any
async function handleMessageStart(
  db: any, orgId: string, key: string, text: string, body: Record<string, unknown>,
) {
  const { data: flows, error: flowsError } = await db
    .from("automation_flows")
    .select("*")
    .eq("organization_id", orgId)
    .in("trigger_type", ["whatsapp_keyword", "message_received"])
    .eq("status", "active");

  if (flowsError) throw new Error("Não foi possível consultar os gatilhos de mensagem.");
  if (!flows?.length) return { resumed: 0, started: 0 };

  const lower = text.toLowerCase();
  const engine = new Engine(db);
  const phone = String(body.phone ?? "");
  const channelId = body.channel_id ? String(body.channel_id) : null;
  const conversationId = body.conversation_id ? String(body.conversation_id) : null;
  // Quando a mensagem foi escrita (no WhatsApp), para o buffer a apanhar.
  const sentMs = Date.parse(String(body.message_at ?? ""));
  const messageAtMs = Number.isFinite(sentMs) ? Math.min(sentMs, Date.now()) : Date.now();
  let started = 0;
  // Até quando os percursos postos em buffer por esta mensagem esperam.
  const buffered: string[] = [];
  const later = (iso: string) => { buffered.push(iso); };
  const bufferedUntil = () => buffered.sort().at(-1) ?? null;

  /**
   * O trinco por número: o percurso ativo deste fluxo para esta conversa, se
   * houver. O índice único uniq_active_run_per_subject garante que nunca há
   * dois — mesmo com duas mensagens a chegar no mesmo milissegundo, uma das
   * inserções recebe 23505.
   */
  const activeRun = async (flowId: string, subjectId: string) => {
    const { data, error } = await db.from("automation_runs")
      .select("id, status, context, current_node_id")
      .eq("flow_id", flowId)
      .eq("organization_id", orgId).eq("subject_type", "contact")
      .eq("contact_phone_key", key)
      .or("context->>__test.is.null,context->>__test.neq.true")
      .in("status", ["running", "waiting", "awaiting_reply"])
      .limit(1)
      .maybeSingle();
    if (error) throw new Error("Não foi possível verificar o percurso ativo do contacto.");
    return data as { id: string; status: string; context: Record<string, unknown> | null; current_node_id: string | null } | null;
  };

  /**
   * «Só uma vez por número» (reentry_policy "once"). Pelo número e não pela
   * conversa: quem escreve para duas caixas continua a ser a mesma pessoa.
   * Os testes não contam (subject_id nulo) — testar o fluxo com o próprio
   * número não o pode gastar. Desligado ("after_completion"/"always"), arranca
   * sempre; o trinco acima continua a impedir dois ao mesmo tempo.
   */
  const alreadyRan = async (flow: Flow) => {
    if (flow.reentry_policy !== "once") return false;
    const { data: prior, error: priorError } = await db.from("automation_runs")
      .select("id")
      .eq("flow_id", flow.id)
      .eq("organization_id", orgId).eq("subject_type", "contact")
      .or("context->>__test.is.null,context->>__test.neq.true")
      .eq("contact_phone_key", key)
      .not("subject_id", "is", null)
      .limit(1);
    if (priorError) throw new Error("Não foi possível verificar as entradas anteriores do contacto.");
    return !!prior?.length;
  };

  /**
   * Uma mensagem a meio do buffer: a hora de arrancar passa para daqui a
   * `seconds`. Só enquanto o percurso ainda não arrancou (status waiting e
   * parado no próprio gatilho); depois disso o atendimento está em curso e a
   * mensagem fica na Caixa de Entrada, sem novo percurso.
   */
  const extendBuffer = async (flow: Flow, run: { id: string; status: string; context: Record<string, unknown> | null }, seconds: number) => {
    if (run.status !== "waiting" || run.context?.__resume_node !== flow.entry_node_id) return false;
    const until = new Date(Date.now() + seconds * 1000).toISOString();
    const { data, error } = await db.from("automation_runs")
      .update({ wake_at: until })
      .eq("id", run.id)
      .eq("status", "waiting")
      .select("id");
    if (error) throw new Error("Não foi possível prolongar a espera pelas mensagens.");
    if (!data?.length) return false;
    later(until);
    return true;
  };

  const insertRun = async (flow: Flow, bufferSeconds: number) => {
    try {
      const decision = await checkAutomationReentry(db, flow, { type: "contact", id: conversationId, phoneKey: key, now: new Date() });
      if (!decision.allowed) return "cooldown" as const;
    } catch (error) {
      logError("reentrada por mensagem rejeitada", { flow: flow.id, error: error instanceof Error ? error.message : "intervalo inválido" });
      throw error;
    }
    const buffering = bufferSeconds > 0;
    const until = new Date(Date.now() + bufferSeconds * 1000).toISOString();
    const { data: run, error } = await db.from("automation_runs").insert({
      organization_id: orgId,
      flow_id: flow.id,
      flow_version: flow.version,
      // Um contacto sem ficha usa identidade lógica por organização e telefone.
      // A conversa original mantém-se em context.conversa_id para ações da Caixa.
      subject_type: "contact",
      subject_id: await automationContactSubjectId(orgId, { phoneKey: key, id: conversationId }),
      contact_name: (body.name ?? null) as string | null,
      contact_phone: phone,
      contact_phone_key: key,
      context: {
        telefone: phone,
        nome: body.name ?? null,
        mensagem_inicial: text,
        canal_id: channelId,
        conversa_id: conversationId,
        __origin_subject_id: conversationId,
        // Com buffer, o percurso fica parado NO gatilho até ao silêncio: o
        // tick re-executa o gatilho (ver __resume_node em handleTick), que
        // junta as mensagens desde __collect_from.
        ...(buffering ? { __resume_node: flow.entry_node_id, __collect_from: new Date(messageAtMs - 1000).toISOString() } : {}),
      },
      current_node_id: flow.entry_node_id,
      ...(buffering ? { status: "waiting", wake_at: until } : {}),
    }).select("*").single();

    if (error) {
      if ((error as { code?: string }).code === "23505") return "taken" as const;
      logError("falha a iniciar fluxo por mensagem", { flow: flow.id, error: error.message });
      throw new Error("Não foi possível iniciar o percurso por mensagem.");
    }
    await db.from("automation_flows").update({ last_enrolled_at: new Date().toISOString() }).eq("id", flow.id);
    if (buffering) {
      later(until);
    } else {
      const pinned = await loadFlow(db, flow.id, run as Run) ?? flow;
    await engine.advance(run as Run, pinned, pinned.entry_node_id);
    }
    started++;
    return "started" as const;
  };

  const ofType = (type: string) =>
    (flows as Flow[]).filter((f) => (f as unknown as { trigger_type: string }).trigger_type === type);

  for (const flow of ofType("whatsapp_keyword")) {
    const keywords = ((flow.trigger_config ?? {}) as { keywords?: string[] }).keywords ?? [];
    // Sem palavras configuradas o fluxo responderia a QUALQUER mensagem — o que
    // seria um disparo em massa acidental. Exige configuração explícita (para
    // isso existe o «Mensagem recebida»).
    if (!keywords.length) continue;
    if (!keywords.some((k) => lower.includes(String(k).toLowerCase()))) continue;
    // A identidade pelo número evita duplicados entre conversas e caixas;
    // «Só uma vez por número» também considera os percursos antigos.
    if (conversationId && await activeRun(flow.id, conversationId)) continue;
    if (await alreadyRan(flow)) continue;
    await insertRun(flow, 0);
  }
  if (started > 0) return { resumed: 0, started, buffered_until: null };

  for (const flow of ofType("message_received")) {
    const tcfg = (flow.trigger_config ?? {}) as { channel_id?: string | null; buffer_seconds?: number };
    if (tcfg.channel_id && tcfg.channel_id !== channelId) continue;
    // A conversa é o sujeito. Sem sujeito, cada mensagem arrancava um percurso
    // novo — um contacto que escrevesse cinco linhas seguidas recebia cinco
    // respostas.
    if (!conversationId) continue;
    const configured = typeof tcfg.buffer_seconds === "number" && Number.isFinite(tcfg.buffer_seconds)
      ? tcfg.buffer_seconds
      : MESSAGE_BUFFER_DEFAULT_SECONDS;
    const bufferSeconds = Math.min(MESSAGE_BUFFER_MAX_SECONDS, Math.max(0, Math.round(configured)));

    const current = await activeRun(flow.id, conversationId);
    if (current) {
      // Trinco: já há um percurso desta conversa. Se ainda está a juntar
      // mensagens, esta junta-se; se já arrancou, fica só na Caixa de Entrada.
      await extendBuffer(flow, current, bufferSeconds);
      continue;
    }
    if (await alreadyRan(flow)) continue;

    const outcome = await insertRun(flow, bufferSeconds);
    if (outcome === "taken") {
      // Outra mensagem da mesma pessoa ganhou a corrida neste instante: junta-se
      // ao buffer dela em vez de abrir um segundo percurso.
      const winner = await activeRun(flow.id, conversationId);
      if (winner) await extendBuffer(flow, winner, bufferSeconds);
    }
  }

  return { resumed: 0, started, buffered_until: bufferedUntil() };
}

/** Chegou uma mensagem do contacto: retoma quem estava à espera dela. */
// deno-lint-ignore no-explicit-any
async function handleReply(db: any, body: Record<string, unknown>) {
  const orgId = String(body.organization_id ?? "");
  const key = phoneKey(String(body.phone ?? ""));
  const text = String(body.text ?? "").trim();
  if (!orgId || !key) return { resumed: 0, message: "organization_id e phone são obrigatórios" };
  // Persisted inbox callbacks use the INSERT ingestion fact. Re-stamping a delayed callback
  // would turn the same message into a second response after a later question.
  if (typeof body.conversation_id !== "string") {
    const receivedAt = new Date();
    const { error: factError } = await db.rpc("record_automation_reply_fact", {
      p_org_id: orgId, p_phone: String(body.phone ?? ""), p_text: text,
      p_received_at: receivedAt.toISOString(),
      p_conversation_id: typeof body.conversation_id === "string" ? body.conversation_id : null,
    });
    if (factError) return { resumed: 0, error: "Não foi possível registar a resposta recebida." };
  }


  if (await automationContactSuppressed(db, orgId, String(body.phone ?? ""))) {
    return { resumed: 0, suppressed: true };
  }
  const { data: runs, error: runsError } = await db
    .from("automation_runs")
    .select("*")
    .eq("organization_id", orgId)
    .or(`context->>__action_reply_phone_key.eq.${key},and(context->>__action_reply_phone_key.is.null,contact_phone_key.eq.${key})`)
    .eq("status", "awaiting_reply")
    .limit(10);

  if (runsError) throw new Error("Não foi possível consultar os percursos à espera de resposta.");

  // Ninguém estava à espera desta pessoa: a mensagem pode, ainda assim, ser a
  // palavra-chave que ARRANCA um fluxo ("escreva PROMO para receber…"). É o
  // outro metade do modelo conversacional.
  if (!runs?.length) return await handleMessageStart(db, orgId, key, text, body);

  const engine = new Engine(db);
  let resumed = 0;

  for (const run of runs as Run[]) {
    const { data: claimed, error: claimError } = await db.from("automation_runs")
      .update({ status: "running" })
      .eq("id", run.id)
      .eq("status", "awaiting_reply")
      .select("*")
      .maybeSingle();
    if (claimError) throw new Error("Não foi possível reservar o percurso para esta resposta.");
    if (!claimed) continue;
    Object.assign(run, claimed, { status: run.status });

    try {
    const flow = await loadFlow(db, run.flow_id, run);
    const node = flow?.graph?.nodes?.find((n) => n.id === run.current_node_id);
    if (!flow || !node) {
      await engine.fail(run, "Fluxo ou nó em falta");
      continue;
    }

    if (await resumePersistedReply(db, run, flow, engine)) resumed++;
    else {
      // An old or already consumed delivery leaves the original timeout/cursors intact.
      const { error } = await db.from("automation_runs").update({ status: "awaiting_reply" }).eq("id", run.id).eq("status", "running");
      if (error) throw new Error("Não foi possível repor a espera por resposta.");
    }
    } catch (error) {
      await engine.fail(run, error instanceof Error ? error.message : "Falha inesperada ao processar a resposta.");
    }
  }

  return { resumed };
}

async function handleStepSimulation(db: Parameters<typeof executeCrmAction>[0], body: Record<string, unknown>) {
  const flow = await loadFlow(db, String(body.flow_id ?? ""));
  const node = flow?.graph.nodes.find(node => node.id === String(body.node_id ?? ""));
  if (!flow || !node) return { error: "Passo não encontrado." };
  const tables: Record<string, string> = { lead: "leads", client: "crm_clients", sale: "sales", proposal: "proposals" };
  const type = String(body.subject_type ?? "lead");
  const table = tables[type];
  if (!table || typeof body.subject_id !== "string") return { error: "Escolha um registo para simular." };
  const { data: record, error } = await db.from(table).select("*").eq("id", body.subject_id)
    .eq("organization_id", flow.organization_id).maybeSingle();
  if (error || !record) return { error: "Registo não encontrado nesta organização." };
  const run: Run = { id: "simulation", organization_id: flow.organization_id, flow_id: flow.id, flow_version: flow.version,
    subject_type: type, subject_id: body.subject_id, contact_name: record.name ?? record.nome ?? null,
    contact_email: record.email ?? null, contact_phone: record.phone ?? null, contact_phone_key: null,
    status: "running", current_node_id: node.id, context: record, steps_taken: 0 };
  const vars = buildVars(run);
  const engine = new Engine(db);
  const detail: Record<string, unknown> = { sem_efeitos: true };
  if (node.type === "condition" || node.type === "filter" || node.type === "wait_until") {
    detail.resultado = await engine.matches(run, flow, node.config);
  } else if (node.type === "router" && Array.isArray(node.config.routes)) {
    detail.ramo = "fallback";
    for (const route of node.config.routes) {
      if (route && typeof route === "object" && await engine.matches(run, flow, { conditions: route.conditions, match: route.match })) {
        detail.ramo = route.id; break;
      }
    }
  } else if (node.type === "wait") detail.espera_ate = calculateAutomationWakeAt(node.config, vars, new Date()).toISOString();
  else {
    detail.mensagem = render(String(node.config.message ?? node.config.text ?? ""), vars);
    detail.assunto = render(String(node.config.subject ?? ""), vars);
    detail.html = render(String(node.config.html ?? ""), vars);
    detail.acao_planeada = node.type;
  }
  return { simulation: true, status: "simulated", node_type: node.type, detail };
}

async function handleManual(db: Parameters<typeof executeCrmAction>[0], body: Record<string, unknown>) {
  const flow = await loadFlow(db, String(body.flow_id ?? ""));
  if (!flow || flow.status !== "active") return { error: "Escolha uma automação ativa." };
  const tables: Record<string, string> = { lead: "leads", client: "crm_clients", sale: "sales", proposal: "proposals" };
  const entity = String(body.subject_type ?? "");
  const table = tables[entity];
  const ids = body.subject_ids;
  if (!table || !Array.isArray(ids) || !ids.length || ids.length > 100 || ids.some(id => typeof id !== "string")) {
    return { error: "Escolha de 1 a 100 registos de um tipo suportado." };
  }
  const { data, error } = await db.from(table).select("*").eq("organization_id", flow.organization_id).in("id", ids);
  if (error) return { error: "Não foi possível consultar os registos selecionados." };
  const results: unknown[] = [];
  let enrolled = 0;
  for (const record of data ?? []) {
    const result = await handleEnroll(db, { flow_id: flow.id, trigger_type: flow.trigger_type,
      organization_id: flow.organization_id, subject_type: entity, record }, true);
    enrolled += Number(result.enrolled ?? 0);
    results.push(result);
  }
  return { enrolled, queued: enrolled, results };
}

// ---------------------------------------------------------------------------
if (import.meta.main) serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const db = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  // Interno apenas: envia mensagens reais em nome da organização. Aceita a
  // service-role key (outras edge functions) ou o segredo do Vault (triggers e
  // cron da base de dados), tal como o process-automation.
  const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  let authorized = !!bearer && bearer === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!authorized) {
    const provided = req.headers.get("x-automation-secret");
    if (provided) {
      const { data } = await db.rpc("verify_automation_secret", { p_secret: provided });
      authorized = data === true;
    }
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch { /* corpo vazio é tratado abaixo */ }
  const action = String(body.action ?? "tick");
  let authenticatedUserId: string | null = null;
  let authenticatedOrgId: string | null = null;

  // Exceção estreita: um administrador autenticado pode disparar um TESTE do
  // seu próprio fluxo, ou REPETIR uma execução dele, a partir do browser. Só
  // estas ações, só na sua organização — enroll/tick/reply continuam a exigir
  // credencial interna, senão qualquer utilizador podia inscrever contactos à
  // sua escolha.
  if (!authorized && (action === "prepare_configured_manual" || action === "run_configured_manual" || action === "test" || action === "step_test" || action === "retry" || action === "manual" || action === "retry_bulk") && bearer) {
    const { data: userData } = await db.auth.getUser(bearer);
    const userId = userData?.user?.id;
    if (userId && (body.flow_id || body.run_id)) {
      const mfaDenied = await requestMfaResponse(req, userId, corsHeaders);
      if (mfaDenied) return mfaDenied;
      // A organização em causa: a do fluxo (teste) ou a da execução (repetir).
      const { data: flowRow } = action === "retry"
        ? await db.from("automation_runs").select("organization_id").eq("id", String(body.run_id ?? "")).maybeSingle()
        : await db.from("automation_flows").select("organization_id").eq("id", String(body.flow_id ?? "")).maybeSingle();
      if (flowRow?.organization_id) {
        const { data: isMember } = await db.rpc("is_org_member", {
          _user_id: userId, _org_id: flowRow.organization_id,
        });
        const { data: isAdmin } = await db.rpc("is_org_admin", { _user_id: userId, _org_id: flowRow.organization_id });
        authorized = isMember === true && isAdmin === true;
        if (authorized) {
          authenticatedUserId = userId;
          authenticatedOrgId = flowRow.organization_id;
        }
      }
    }
    if (!authorized) logError("teste rejeitado: utilizador sem permissão no fluxo", { flow: body.flow_id });
  }

  if (!authorized) {
    return new Response(JSON.stringify({ error: "Não autorizado" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {

    let result: unknown;
    if (action === "enroll")      result = await handleEnroll(db, body, body.deferred_execution === true);
    else if (action === "reply")  result = await handleReply(db, body);
    else if (action === "tick")   result = await handleTick(db);
    else if (action === "test")   result = await handleTest(db, body);
    else if (action === "step_test") result = await handleStepSimulation(db, body);
    else if (action === "retry")  result = await handleRetry(db, body);
    else if (action === "prepare_configured_manual") {
      if (!authenticatedUserId || !authenticatedOrgId) {
        result = { error: "A preparação manual exige um administrador autenticado" };
      } else {
        const flowId = String(body.flow_id ?? "");
        const { data: flow } = await db.from("automation_flows")
          .select("id,version,status,trigger_type,trigger_config")
          .eq("id", flowId).eq("organization_id", authenticatedOrgId).maybeSingle();
        const workflow = flow?.trigger_config?.workflow as { trigger?: { kind?: string } } | undefined;
        if (!flow || flow.status !== "active" || flow.trigger_type !== "configured_workflow"
          || workflow?.trigger?.kind !== "authenticated_manual") {
          result = { error: "Fluxo manual ativo não encontrado" };
        } else {
          const pending = await preparePendingAction({
            supabaseAdmin: db,
            userId: authenticatedUserId,
            organizationId: authenticatedOrgId,
            moduleKey: "automations",
            tool: "run_configured_manual",
            payload: { flow_id: flow.id, flow_version: flow.version },
          });
          result = pending.ok
            ? { confirmation_id: pending.value.confirmationId, expires_at: pending.value.expiresAt }
            : { error: `Não foi possível preparar a confirmação: ${pending.failure.kind}` };
        }
      }
    }
    else if (action === "run_configured_manual") {
      if (!authenticatedUserId || !authenticatedOrgId) {
        result = { error: "A execução manual exige um administrador autenticado" };
      } else {
        const confirmation = await consumePendingAction({
          supabaseAdmin: db,
          confirmationId: String(body.confirmation_id ?? ""),
          userId: authenticatedUserId,
          organizationId: authenticatedOrgId,
          moduleKey: "automations",
          tool: "run_configured_manual",
        });
        const payload = confirmation.ok ? confirmation.value.payload : null;
        const flowId = payload && typeof payload.flow_id === "string" ? payload.flow_id : null;
        const flowVersion = payload && typeof payload.flow_version === "number" ? payload.flow_version : null;
        result = confirmation.ok && flowId && flowVersion && flowId === String(body.flow_id ?? "")
          ? await runConfiguredManual(
            db, flowId, flowVersion, authenticatedUserId,
            `manual:${confirmation.value.actionId}`, startConfiguredRecord(db),
          )
          : { error: "Confirmação manual inválida, expirada ou já utilizada" };
      }
    }
    else if (action === "manual") result = await handleManual(db, body);
    else if (action === "retry_bulk") {
      const flow = await loadFlow(db, String(body.flow_id ?? ""));
      if (!flow) result = { error: "Automação não encontrada." };
      else {
        const ids = body.run_ids;
        if (ids !== undefined && (!Array.isArray(ids) || ids.some(id => typeof id !== "string"))) result = { error: "Seleção de percursos inválida." };
        else result = await retryFailedRuns(db, { flowId: flow.id, organizationId: flow.organization_id,
          runIds: ids, limit: typeof body.limit === "number" ? body.limit : 50 },
          runId => handleRetry(db, { run_id: runId, from: "failed_step" }, true));
      }
    }
    else result = { error: `Ação desconhecida: ${action}` };

    log("concluído", { action, result });
    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    logError("erro não tratado", { error: (e as Error).message });
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

