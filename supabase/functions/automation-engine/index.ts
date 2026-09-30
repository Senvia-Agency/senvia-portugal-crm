import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { requestMfaResponse } from "../_shared/user-authorization.ts";

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
interface Run {
  id: string;
  organization_id: string;
  flow_id: string;
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
}
interface Flow {
  id: string;
  organization_id: string;
  name: string;
  status: string;
  graph: Graph;
  entry_node_id: string | null;
  version: number;
  reentry_policy: string;
  quiet_hours: { start?: string; end?: string } | null;
  max_steps_per_run: number;
  trigger_config?: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// Utilitários
// ---------------------------------------------------------------------------

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
  return String(template ?? "").replace(/\{\{\s*([\w:]+)\s*\}\}/g, (_whole, key) => {
    const v = vars[key];
    return v === undefined || v === null ? "" : String(v);
  });
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

// ---------------------------------------------------------------------------
// Motor
// ---------------------------------------------------------------------------
class Engine {
  // deno-lint-ignore no-explicit-any
  constructor(private db: any) {}

  // Aqui viviam whatsappInstance() e sendWhatsappText(), os únicos pontos deste
  // motor que falavam com a Evolution. Saíram com a integração.

  private async recordStep(
    run: Run, node: FlowNode, status: string, detail: Record<string, unknown>
  ): Promise<boolean> {
    const { error } = await this.db.from("automation_run_steps").insert({
      run_id: run.id,
      organization_id: run.organization_id,
      node_id: node.id,
      node_type: node.type,
      status,
      detail,
    });
    if (error) {
      // 23505 = este nó já correu neste percurso. É o índice único a impedir
      // uma reentrega de enviar a mensagem outra vez.
      if ((error as { code?: string }).code === "23505") {
        log("nó já executado neste percurso — a ignorar", { run: run.id, node: node.id });
        return false;
      }
      logError("falha a registar passo", { error: error.message, run: run.id, node: node.id });
    }
    return true;
  }

  private async finish(run: Run, status: string, error?: string) {
    const context = { ...((run.context ?? {}) as Record<string, unknown>) };
    delete context.__cursors;
    await this.db.from("automation_runs").update({
      status,
      last_error: error ?? null,
      completed_at: new Date().toISOString(),
      current_node_id: null,
      wake_at: null,
      context,
    }).eq("id", run.id);
  }

  /**
   * Guarda todos os caminhos que ficaram à espera. O percurso acorda à hora do
   * mais próximo, e o tick retoma só aqueles cuja hora chegou.
   */
  private async parkAll(run: Run, cursors: Cursor[], context: Record<string, unknown>) {
    const times = cursors.map((c) => c.wake_at).filter((t): t is string => !!t).sort();
    const replying = cursors.find((c) => c.status === "awaiting_reply");
    await this.db.from("automation_runs").update({
      status: replying ? "awaiting_reply" : "waiting",
      // Continua a nomear um nó: é por ele que handleReply encontra o percurso,
      // e um fluxo de caminho único comporta-se exactamente como antes.
      current_node_id: (replying ?? cursors[0]).node,
      wake_at: times.length ? times[0] : null,
      context: { ...context, __cursors: cursors },
    }).eq("id", run.id);
  }

  /** Passos que este percurso já executou. */
  private async executedNodes(run: Run): Promise<Set<string>> {
    const { data } = await this.db
      .from("automation_run_steps")
      .select("node_id")
      .eq("run_id", run.id)
      .neq("status", "failed");
    return new Set((data ?? []).map((row: { node_id: string }) => row.node_id));
  }

  /**
   * Percorre o grafo por todos os caminhos abertos até nenhum poder avançar.
   * Um passo com duas arestas de saída põe as duas na fila, por isso os
   * caminhos correm lado a lado na mesma passagem; um que pare numa espera
   * deixa o seu cursor para trás enquanto os outros seguem.
   */
  async advance(run: Run, flow: Flow, start: string | string[] | null, parked: Cursor[] = []) {
    const graph = flow.graph ?? { nodes: [], edges: [] };
    const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
    const queue: string[] = (Array.isArray(start) ? start : start ? [start] : []).filter(Boolean);
    const stillParked: Cursor[] = [...parked];
    let steps = run.steps_taken;
    let context = (run.context ?? {}) as Record<string, unknown>;

    // Lido uma vez. Dois caminhos que se encontrem no mesmo passo não podem
    // enviar a mesma mensagem duas vezes, e o índice único só apanha isso
    // DEPOIS de o efeito já ter acontecido.
    const done = await this.executedNodes(run);
    for (const cursor of stillParked) done.add(cursor.node);

    while (queue.length) {
      if (steps >= flow.max_steps_per_run) {
        logError("limite de passos atingido — possível ciclo no fluxo", { run: run.id, flow: flow.id });
        await this.finish(run, "failed", `Limite de ${flow.max_steps_per_run} passos atingido`);
        return;
      }

      const cursor = queue.shift() as string;
      if (done.has(cursor)) continue;

      const node = nodeById.get(cursor);
      if (!node) {
        logError("nó inexistente no grafo", { run: run.id, node: cursor });
        await this.finish(run, "failed", `Nó ${cursor} não existe neste fluxo`);
        return;
      }

      steps++;
      const outcome = await this.execute({ ...run, context }, flow, node);

      if (outcome.kind === "park") {
        const wakeAt = outcome.wakeAt ? outcome.wakeAt.toISOString() : null;
        if (outcome.resumeSelf) {
          // Ainda não executou nada: sem linha de passo, e o cursor aponta para
          // ESTE nó para o tick o re-executar fora da janela de silêncio.
          stillParked.push({ node: node.id, status: outcome.status!, wake_at: wakeAt, resume_self: true });
        } else {
          await this.recordStep(run, node, "waiting", outcome.detail ?? {});
          done.add(node.id);
          stillParked.push({ node: node.id, status: outcome.status!, wake_at: wakeAt });
        }
        continue;
      }

      const fresh = await this.recordStep(run, node, outcome.kind === "fail" ? "failed" : "ok", outcome.detail ?? {});
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

      // Um "end" fecha o seu caminho. Os outros continuam.
      if (outcome.kind === "end") continue;

      for (const nextId of nextNodeIds(graph, node.id, outcome.branch)) {
        if (!done.has(nextId)) queue.push(nextId);
      }
    }

    await this.db.from("automation_runs").update({ steps_taken: steps }).eq("id", run.id);
    run.context = context;

    if (stillParked.length) {
      await this.parkAll(run, stillParked, context);
      return;
    }
    await this.finish(run, "completed");
  }

  /** Executa um nó. Não decide o próximo — só diz o que aconteceu. */
  private async execute(run: Run, flow: Flow, node: FlowNode): Promise<{
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
  }> {
    const cfg = node.config ?? {};
    const vars = buildVars(run);

    switch (node.type) {
      // O gatilho é apenas o ponto de entrada.
      case "trigger":
      case "lead_created":
      case "lead_status_changed":
      case "form_submitted":
      case "whatsapp_keyword":
      case "sale_status_changed":
      case "list_joined":
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
      case "trial_started":
      case "trial_day_3":
      case "trial_day_7":
      case "trial_expiring_3d":
      case "trial_expiring_1d":
      case "trial_expired":
      case "trial_inactive_48h":
        return { kind: "next", detail: { entrada: node.type } };

      case "wait": {
        const quiet = quietUntil(flow.quiet_hours);
        const base = Date.now() + durationMs(cfg);
        const wake = quiet && quiet.getTime() > base ? quiet : new Date(base);
        return {
          kind: "park", status: "waiting", wakeAt: wake,
          detail: { espera_ate: wake.toISOString(), adiado_por_silencio: !!(quiet && quiet.getTime() > base) },
        };
      }

      // Os nós de WhatsApp deixaram de poder enviar: a integração da Evolution
      // foi removida do produto (violava os Termos da Meta e arriscava o ban do
      // número). Falham de forma explícita em vez de fingirem que enviaram — um
      // percurso que diz "ok" sem entregar nada é pior do que um que falha e diz
      // porquê; foi exatamente esse o problema dos botões.
      case "wait_reply":
      case "send_whatsapp":
        return {
          kind: "fail",
          error: "O envio por WhatsApp foi desativado neste CRM. Substitui este passo por um envio de email.",
        };

      case "send_email": {
        if (!run.contact_email) return { kind: "fail", error: "Contacto sem email" };
        const { data, error } = await this.db.functions.invoke("send-template-email", {
          body: {
            organizationId: run.organization_id,
            templateId: cfg.template_id ?? undefined,
            subject: cfg.subject ? render(String(cfg.subject), vars) : undefined,
            htmlContent: cfg.html ? render(String(cfg.html), vars) : undefined,
            recipients: [{
              email: run.contact_email,
              name: run.contact_name ?? run.contact_email,
              clientId: run.subject_type === "client" ? run.subject_id : undefined,
              variables: vars,
            }],
          },
        });
        if (error) return { kind: "fail", error: `Email falhou: ${error.message}` };
        // send-template-email always answers HTTP 200 (per-recipient outcome
        // lives in the body, not the status code) — a real Brevo rejection
        // never sets `error` above and was silently reported as success. Read
        // the actual per-recipient result instead of trusting the envelope.
        const outcome = (data as { results?: Array<{ status: string; error?: string }> } | null)
          ?.results?.[0];
        if (!outcome || outcome.status !== "sent") {
          return { kind: "fail", error: `Email rejeitado: ${outcome?.error ?? "resposta inesperada de send-template-email"}` };
        }
        return { kind: "next", detail: { canal: "email", para: run.contact_email, template: cfg.template_id ?? null } };
      }

      case "condition": {
        const field = String(cfg.field ?? "");
        const op = String(cfg.operator ?? "equals");
        const expected = cfg.value;
        const actual = (vars as Record<string, unknown>)[field];

        let yes = false;
        switch (op) {
          case "exists":       yes = actual !== undefined && actual !== null && actual !== ""; break;
          case "not_exists":   yes = actual === undefined || actual === null || actual === ""; break;
          case "contains":     yes = String(actual ?? "").toLowerCase().includes(String(expected ?? "").toLowerCase()); break;
          case "not_equals":   yes = String(actual ?? "") !== String(expected ?? ""); break;
          case "greater_than": yes = Number(actual) > Number(expected); break;
          case "less_than":    yes = Number(actual) < Number(expected); break;
          default:             yes = String(actual ?? "").toLowerCase() === String(expected ?? "").toLowerCase();
        }
        return { kind: "next", branch: yes ? "yes" : "no", detail: { campo: field, operador: op, resultado: yes } };
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
        const table = run.subject_type === "client" ? "crm_clients" : "leads";
        const { error } = await this.db.from(table)
          .update({ assigned_to: cfg.user_id })
          .eq("id", run.subject_id)
          .eq("organization_id", run.organization_id);
        if (error) return { kind: "fail", error: `Atribuição falhou: ${error.message}` };
        return { kind: "next", detail: { atribuido_a: cfg.user_id } };
      }

      case "add_to_list": {
        if (!run.contact_email) return { kind: "next", detail: { ignorado: "contacto sem email" } };
        const { data: contact } = await this.db.from("marketing_contacts").upsert(
          {
            organization_id: run.organization_id,
            email: run.contact_email,
            name: run.contact_name ?? run.contact_email,
            source: "automation",
            subscribed: true,
          },
          { onConflict: "organization_id,email" },
        ).select("id").single();

        if (contact?.id && cfg.list_id) {
          await this.db.from("marketing_list_members").upsert(
            { list_id: cfg.list_id, contact_id: contact.id },
            { onConflict: "list_id,contact_id" },
          );
        }
        return { kind: "next", detail: { lista: cfg.list_id } };
      }

      case "create_task": {
        const title = render(String(cfg.title ?? ""), vars).trim();
        if (!title) return { kind: "fail", error: "Tarefa sem título" };

        const dueDays = Number(cfg.due_in_days ?? 1);
        const dueAt = new Date(Date.now() + Math.max(0, dueDays) * 86_400_000).toISOString();

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
        const url = String(cfg.url ?? "");
        if (!url) return { kind: "fail", error: "Webhook sem URL" };
        try {
          const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ run_id: run.id, flow_id: flow.id, contact: vars }),
          });
          return { kind: "next", detail: { url, status: res.status } };
        } catch (e) {
          return { kind: "fail", error: `Webhook falhou: ${(e as Error).message}` };
        }
      }

      case "end":
        return { kind: "end", detail: { motivo: cfg.reason ?? "fim do fluxo" } };

      default:
        logError("tipo de nó desconhecido", { type: node.type, flow: flow.id });
        return { kind: "next", detail: { ignorado: `tipo desconhecido: ${node.type}` } };
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
    .update({ status: "ok", detail })
    .eq("run_id", run.id)
    .eq("node_id", node.id)
    .eq("status", "waiting")
    .select("id");

  if (error) logError("falha a fechar passo de espera", { run: run.id, node: node.id, error: error.message });
  if (!error && (!updated || updated.length === 0)) {
    // Sem linha em espera (percurso antigo, ou retomado por outra via): grava.
    const { error: insErr } = await db.from("automation_run_steps").insert({
      run_id: run.id, organization_id: run.organization_id,
      node_id: node.id, node_type: node.type, status: "ok", detail,
    });
    if (insErr) logError("falha a registar desfecho da espera", { run: run.id, node: node.id, error: insErr.message });
  }
}

// deno-lint-ignore no-explicit-any
async function loadFlow(db: any, flowId: string): Promise<Flow | null> {
  const { data } = await db.from("automation_flows").select("*").eq("id", flowId).maybeSingle();
  return data ?? null;
}

// deno-lint-ignore no-explicit-any
async function handleEnroll(db: any, body: Record<string, unknown>) {
  const triggerType = String(body.trigger_type ?? "");
  const orgId = String(body.organization_id ?? "");
  const record = (body.record ?? {}) as Record<string, unknown>;
  if (!triggerType || !orgId) return { error: "trigger_type e organization_id são obrigatórios" };

  const { data: flows } = await db
    .from("automation_flows")
    .select("*")
    .eq("organization_id", orgId)
    .eq("trigger_type", triggerType)
    .eq("status", "active");

  if (!flows?.length) return { enrolled: 0, message: "Nenhum fluxo ativo para este gatilho" };

  const engine = new Engine(db);
  const results: Array<Record<string, unknown>> = [];

  for (const flow of flows as Flow[]) {
    // Trigger-level filters: a flow scoped to one form (or one pipeline stage)
    // must ignore events from the others, otherwise activating it would blast
    // every lead in the organization.
    const tcfg = (flow.trigger_config ?? {}) as Record<string, unknown>;
    if (triggerType === "form_submitted" && tcfg.form_id && record.form_id !== tcfg.form_id) {
      results.push({ flow: flow.id, skipped: "outro formulário" });
      continue;
    }
    if (triggerType.endsWith("_status_changed") && tcfg.to_stage && record.status !== tcfg.to_stage) {
      results.push({ flow: flow.id, skipped: "outra etapa" });
      continue;
    }

    const subjectId = (record.id as string) ?? null;

    // Reinscrição: 'once' impede para sempre; 'after_completion' só permite
    // depois de o anterior ter terminado (o índice único já bloqueia percursos
    // simultâneos, aqui trata-se dos já concluídos).
    if (subjectId && flow.reentry_policy === "once") {
      const { data: prior } = await db.from("automation_runs")
        .select("id").eq("flow_id", flow.id).eq("subject_id", subjectId).limit(1);
      if (prior?.length) { results.push({ flow: flow.id, skipped: "já entrou neste fluxo" }); continue; }
    }

    const phone = (record.phone ?? record.telefone ?? null) as string | null;
    const { data: run, error } = await db.from("automation_runs").insert({
      organization_id: orgId,
      flow_id: flow.id,
      flow_version: flow.version,
      subject_type: String(body.subject_type ?? "lead"),
      subject_id: subjectId,
      contact_name: (record.name ?? record.nome ?? null) as string | null,
      contact_email: (record.email ?? null) as string | null,
      contact_phone: phone,
      contact_phone_key: phoneKey(phone),
      context: { ...record },
      current_node_id: flow.entry_node_id,
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
    await engine.advance(run as Run, flow, flow.entry_node_id);
    results.push({ flow: flow.id, run: run.id });
  }

  return { enrolled: results.filter((r) => r.run).length, results };
}

// deno-lint-ignore no-explicit-any
async function handleTick(db: any) {
  const { data: due } = await db
    .from("automation_runs")
    .select("*")
    .in("status", ["waiting", "awaiting_reply"])
    .lte("wake_at", new Date().toISOString())
    .order("wake_at", { ascending: true })
    .limit(100);

  if (!due?.length) return { woken: 0 };

  const engine = new Engine(db);
  let woken = 0, failed = 0;

  for (const run of due as Run[]) {
    // Claim: só avança quem conseguir mudar o estado, para dois ticks em
    // paralelo não executarem o mesmo percurso (o process-automation-queue
    // antigo não faz isto e pode duplicar envios).
    const { data: claimed } = await db.from("automation_runs")
      .update({ status: "running" })
      .eq("id", run.id)
      .in("status", ["waiting", "awaiting_reply"])
      .select("id")
      .maybeSingle();
    if (!claimed) continue;

    const flow = await loadFlow(db, run.flow_id);
    if (!flow) { await db.from("automation_runs").update({ status: "failed", last_error: "Fluxo apagado" }).eq("id", run.id); failed++; continue; }

    const wasAwaitingReply = run.status === "awaiting_reply";
    const nodes = flow.graph?.nodes ?? [];
    const node = nodes.find((n) => n.id === run.current_node_id);
    const cursors = readCursors(run);

    try {
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
            starts.push(...nextNodeIds(flow.graph, parkedNode.id));
          }
        }

        await engine.advance({ ...run, status: "running" }, flow, starts, rest);
      } else if (wasAwaitingReply && node) {
        // Esgotou o tempo de espera: segue pelo ramo "timeout".
        await settleWaitingStep(db, run, node, {
          ramo: "timeout", motivo: "sem resposta dentro do prazo",
        });
        const next = nextNodeId(flow.graph, node.id, "timeout");
        if (!next) { await db.from("automation_runs").update({ status: "completed", completed_at: new Date().toISOString(), current_node_id: null, wake_at: null }).eq("id", run.id); woken++; continue; }
        await engine.advance({ ...run, status: "running" }, flow, next);
      } else if (node && (run.context as Record<string, unknown>)?.__resume_node === node.id) {
        // Parou ANTES de executar (adiado pelo horário de silêncio): re-executa
        // o próprio nó, agora fora da janela. Limpa a marca primeiro para não
        // voltar a entrar aqui em ciclo.
        const context = { ...run.context };
        delete (context as Record<string, unknown>).__resume_node;
        await db.from("automation_runs").update({ context }).eq("id", run.id);
        await engine.advance({ ...run, status: "running", context }, flow, node.id);
      } else {
        const next = node ? nextNodeId(flow.graph, node.id) : run.current_node_id;
        await engine.advance({ ...run, status: "running" }, flow, next);
      }
      woken++;
    } catch (e) {
      logError("percurso falhou no tick", { run: run.id, error: (e as Error).message });
      await db.from("automation_runs").update({ status: "failed", last_error: (e as Error).message }).eq("id", run.id);
      failed++;
    }
  }

  if (failed > 0) logError("tick terminou com falhas", { failed });
  return { woken, failed };
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

  await new Engine(db).advance(run as Run, flow, flow.entry_node_id);

  const { data: fresh } = await db
    .from("automation_runs").select("status, last_error").eq("id", run.id).maybeSingle();

  return { run_id: run.id, status: fresh?.status ?? "running", error: fresh?.last_error ?? null };
}

/**
 * Nenhum percurso à espera desta pessoa — mas a mensagem pode ser a palavra-
 * chave que inicia um fluxo. Procura fluxos com gatilho `whatsapp_keyword`
 * cujas palavras apareçam no texto.
 */
// deno-lint-ignore no-explicit-any
async function handleKeywordStart(
  db: any, orgId: string, key: string, text: string, body: Record<string, unknown>,
) {
  const { data: flows } = await db
    .from("automation_flows")
    .select("*")
    .eq("organization_id", orgId)
    .eq("trigger_type", "whatsapp_keyword")
    .eq("status", "active");

  if (!flows?.length) return { resumed: 0, started: 0 };

  const lower = text.toLowerCase();
  const engine = new Engine(db);
  let started = 0;

  for (const flow of flows as Flow[]) {
    const keywords = ((flow as unknown as { trigger_config?: { keywords?: string[] } })
      .trigger_config?.keywords ?? []) as string[];
    // Sem palavras configuradas o fluxo responderia a QUALQUER mensagem — o que
    // seria um disparo em massa acidental. Exige configuração explícita.
    if (!keywords.length) continue;
    if (!keywords.some((k) => lower.includes(String(k).toLowerCase()))) continue;

    const phone = String(body.phone ?? "");
    const { data: run, error } = await db.from("automation_runs").insert({
      organization_id: orgId,
      flow_id: flow.id,
      flow_version: flow.version,
      subject_type: "contact",
      subject_id: null,
      contact_name: (body.name ?? null) as string | null,
      contact_phone: phone,
      contact_phone_key: key,
      context: { telefone: phone, mensagem_inicial: text },
      current_node_id: flow.entry_node_id,
    }).select("*").single();

    if (error) {
      logError("falha a iniciar fluxo por palavra-chave", { flow: flow.id, error: error.message });
      continue;
    }

    await engine.advance(run as Run, flow, flow.entry_node_id);
    started++;
  }

  return { resumed: 0, started };
}

/** Chegou uma mensagem do contacto: retoma quem estava à espera dela. */
// deno-lint-ignore no-explicit-any
async function handleReply(db: any, body: Record<string, unknown>) {
  const orgId = String(body.organization_id ?? "");
  const key = phoneKey(String(body.phone ?? ""));
  const text = String(body.text ?? "").trim();
  if (!orgId || !key) return { resumed: 0, message: "organization_id e phone são obrigatórios" };

  const { data: runs } = await db
    .from("automation_runs")
    .select("*")
    .eq("organization_id", orgId)
    .eq("contact_phone_key", key)
    .eq("status", "awaiting_reply")
    .limit(10);

  // Ninguém estava à espera desta pessoa: a mensagem pode, ainda assim, ser a
  // palavra-chave que ARRANCA um fluxo ("escreva PROMO para receber…"). É o
  // outro metade do modelo conversacional.
  if (!runs?.length) return await handleKeywordStart(db, orgId, key, text, body);

  const engine = new Engine(db);
  let resumed = 0;

  for (const run of runs as Run[]) {
    const { data: claimed } = await db.from("automation_runs")
      .update({ status: "running" })
      .eq("id", run.id)
      .eq("status", "awaiting_reply")
      .select("id")
      .maybeSingle();
    if (!claimed) continue;

    const flow = await loadFlow(db, run.flow_id);
    const node = flow?.graph?.nodes?.find((n) => n.id === run.current_node_id);
    if (!flow || !node) {
      await db.from("automation_runs").update({ status: "failed", last_error: "Fluxo ou nó em falta" }).eq("id", run.id);
      continue;
    }

    // Qual das regras corresponde ao que a pessoa escreveu? Aceita, por regra:
    // palavras-chave no texto, o rótulo do botão tal e qual (clique num botão
    // interativo devolve o displayText), ou o número da opção ("1", "2"…) do
    // modo degradado sem botões.
    const rules = (node.config?.rules ?? []) as Array<{ id: string; keywords?: string[]; label?: string }>;
    const lower = text.toLowerCase();
    const exact = lower.trim();
    const matched = rules.find((r, i) =>
      (r.keywords ?? []).some((k) => lower.includes(String(k).toLowerCase())) ||
      (r.label && exact === r.label.toLowerCase()) ||
      exact === String(i + 1)
    );
    const branch = matched?.id ?? "fallback";

    await settleWaitingStep(db, run, node, {
      ramo: branch,
      resposta: text.slice(0, 300),
      regra: matched?.label ?? "nenhuma correspondência",
    });

    const context = { ...run.context, ultima_resposta: text };
    await db.from("automation_runs").update({ context }).eq("id", run.id);

    let starts = nextNodeIds(flow.graph, node.id, branch);
    // Sem ramo específico para esta resposta, tenta o de fallback.
    if (!starts.length && branch !== "fallback") {
      starts = nextNodeIds(flow.graph, node.id, "fallback");
    }

    // Outros caminhos deste percurso podem continuar parados nas suas esperas.
    const rest = readCursors({ ...run, context }).filter((c) => c.node !== node.id);

    if (!starts.length && !rest.length) {
      await db.from("automation_runs").update({
        status: "completed", completed_at: new Date().toISOString(),
        current_node_id: null, wake_at: null,
      }).eq("id", run.id);
      resumed++;
      continue;
    }

    await engine.advance({ ...run, status: "running", context }, flow, starts, rest);
    resumed++;
  }

  return { resumed };
}

// ---------------------------------------------------------------------------
serve(async (req) => {
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

  // Exceção estreita: um administrador autenticado pode disparar um TESTE do
  // seu próprio fluxo a partir do browser. Só esta ação, só o fluxo da sua
  // organização — enroll/tick/reply continuam a exigir credencial interna,
  // senão qualquer utilizador podia inscrever contactos à sua escolha.
  if (!authorized && action === "test" && bearer) {
    const { data: userData } = await db.auth.getUser(bearer);
    const userId = userData?.user?.id;
    if (userId && body.flow_id) {
      const mfaDenied = await requestMfaResponse(req, userId, corsHeaders);
      if (mfaDenied) return mfaDenied;
      const { data: flowRow } = await db
        .from("automation_flows").select("organization_id").eq("id", String(body.flow_id)).maybeSingle();
      if (flowRow?.organization_id) {
        const { data: isMember } = await db.rpc("is_org_member", {
          _user_id: userId, _org_id: flowRow.organization_id,
        });
        const { data: isAdmin } = await db.rpc("is_org_admin", { _user_id: userId, _org_id: flowRow.organization_id });
        authorized = isMember === true && isAdmin === true;
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
    if (action === "enroll")      result = await handleEnroll(db, body);
    else if (action === "reply")  result = await handleReply(db, body);
    else if (action === "tick")   result = await handleTick(db);
    else if (action === "test")   result = await handleTest(db, body);
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
