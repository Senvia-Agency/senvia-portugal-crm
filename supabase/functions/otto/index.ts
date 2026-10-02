// otto — Otto 2.0 platform agent. Modular successor to otto-chat:
//   * registry-based tools (read + write + onboarding + support)
//   * auto mode detection (onboarding vs support) from real org state
//   * permission-gated, audited write actions
//   * model/provider configurable via env (defaults to Gemini 2.5 Flash)
//   * progressive SSE streaming of the final answer
//
// Runs ALONGSIDE the legacy otto-chat (which still serves production) until the
// frontend is cut over. See agent_docs and OTTO_2_TESTING.md.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders, jsonError, streamText } from "./lib/cors.ts";
import { loadContext } from "./lib/context.ts";
import { buildSystemPrompt } from "./lib/prompts.ts";
import { getAIConfigs, chatCompletionResilient } from "./lib/ai.ts";
import { ALL_TOOLS, getToolsForModel, canUseTool, runTool } from "./lib/tools/registry.ts";

const MAX_ITERATIONS = 5;

const MODULE_LABELS: Record<string, string> = {
  clients: "Clientes", leads: "Leads", finance: "Finanças", sales: "Vendas",
  proposals: "Propostas", calendar: "Agenda", marketing: "Marketing",
  ecommerce: "E-commerce", settings: "Definições",
};

function latestUserText(messages: any[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") return String(messages[i]?.content || "");
  }
  return "";
}

function recentConversationText(messages: any[], limit = 8): string {
  return messages.slice(-limit).map((m: any) => String(m?.content || "")).join("\n");
}

function matchLine(text: string, label: string): string | null {
  const re = new RegExp(`${label}\\s*:\\s*([^\\n]+)`, "i");
  return text.match(re)?.[1]?.trim() || null;
}

function extractDelayMinutes(text: string): number | null {
  if (/\b(imediato|imediatamente|agora|sem atraso)\b/i.test(text)) return 0;
  const minutes = text.match(/(\d+)\s*(?:minutos|min|minutes)\b/i);
  if (minutes) return Math.max(0, Number(minutes[1]));
  const hours = text.match(/(\d+)\s*(?:horas?|h)\b/i);
  if (hours) return Math.max(0, Number(hours[1]) * 60);
  const days = text.match(/(\d+)\s*dias?\b/i);
  if (days) return Math.max(0, Number(days[1]) * 24 * 60);
  return null;
}

function extractStage(text: string): string | null {
  const explicit = text.match(/(?:estado|etapa)\s*[:=]\s*([^\n,.;]+)/i)?.[1]?.trim();
  if (explicit) return explicit;
  const named = text.match(/estado\s+([A-Za-zÀ-ÿ0-9 _-]+)/i)?.[1]?.trim();
  if (named) return named;
  return text.match(/\b(Contactado|Contacto)\b/i)?.[0] || null;
}

function shouldDirectCreateEmailAutomation(userText: string, contextText: string): boolean {
  const text = `${userText}\n${contextText}`.toLowerCase();
  const wantsAutomation = text.includes("automação") || text.includes("automatico") || text.includes("automático");
  const automationContext =
    text.includes("email") ||
    text.includes("e-mail") ||
    text.includes("gatilho") ||
    text.includes("lead") ||
    text.includes("etapa") ||
    text.includes("estado") ||
    text.includes("atraso");
  // Users often approve an automation after Otto has already summarized it.
  // The latest user message may be just "sim" or "tenta de novo", so intent
  // must be read from the whole recent exchange, not only the last sentence.
  const createIntent = /\b(cria|criar|grava|gravar|configura|configurar|faz|fazer|usa|usar|sim|confirmo|aprovado|podes|pode|quero|preciso|tenta|tentar)\b/i.test(text);
  return wantsAutomation && automationContext && createIntent;
}

function defaultAutomationCopy(stage: string): { subject: string; message: string } {
  const normalized = stage.toLowerCase();
  if (normalized.includes("contact")) {
    return {
      subject: "Ainda faz sentido avançarmos?",
      message:
        "Olá {{nome}},\n\nEstou a passar só para confirmar se ainda faz sentido avançarmos com o teu pedido.\n\nSe quiseres, responde a este email e ajudamos-te com o próximo passo.\n\nObrigado.",
    };
  }

  return {
    subject: "Seguimos com o próximo passo?",
    message:
      "Olá {{nome}},\n\nEstou a passar para dar seguimento ao teu pedido.\n\nSe quiseres avançar, responde a este email e ajudamos-te com o próximo passo.\n\nObrigado.",
  };
}

async function maybeCreateEmailAutomationDirect(messages: any[], ctx: any): Promise<string | null> {
  const userText = latestUserText(messages);
  const contextText = recentConversationText(messages);
  if (!shouldDirectCreateEmailAutomation(userText, contextText)) return null;

  const allText = `${contextText}\n${userText}`;
  const stage = extractStage(allText);

  if (!stage) {
    return "Consigo criar essa automação, mas preciso de saber em que estado/etapa ela deve disparar.";
  }

  const defaults = defaultAutomationCopy(stage);
  const subject = matchLine(allText, "Assunto") || allText.match(/assunto\s+["“]?([^"\n”]+)["”]?/i)?.[1]?.trim() || defaults.subject;
  const rawMessage = matchLine(allText, "Mensagem") || matchLine(allText, "Corpo") || matchLine(allText, "Texto") || defaults.message;
  const delay = extractDelayMinutes(allText) ?? 4320;

  const resultRaw = await runTool("create_email_automation", {
    name: subject,
    subject,
    message: rawMessage,
    trigger_type: "lead_status_changed",
    to_status: stage,
    from_status: "any",
    delay_minutes: delay,
    category: "followup",
  }, ctx);

  const result = JSON.parse(resultRaw);
  if (result?.success) {
    return `Automação criada e ativa.\n\n- Estado: ${stage}\n- Atraso: ${delay} minutos\n- Assunto: ${subject}\n\n[link:Ver Templates|/marketing/templates]`;
  }
  return `Não consegui criar a automação: ${result?.error || "erro desconhecido"}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonError("Método não permitido", 405);

  try {
    const { messages, organization_id, attachment_paths } = await req.json();

    let aiConfigs;
    try {
      aiConfigs = getAIConfigs();
    } catch (e) {
      return jsonError((e as Error).message, 500);
    }

    // ── Load context (auth, org, permissions, onboarding, mode) ──
    const { ctx, hasDataAccess } = await loadContext(req, organization_id || null, attachment_paths);

    // Tools available to this user.
    const toolsForModel = (hasDataAccess && ctx)
      ? getToolsForModel({ isAdmin: ctx.isAdmin, permissions: ctx.permissions })
      : [];

    // Which permissioned modules are blocked (for the prompt note).
    let blockedLabels: string[] = [];
    if (hasDataAccess && ctx && !ctx.isAdmin) {
      // Only consider read ("view") tools: a profile that can view a module but
      // not create in it still HAS access to that module's data, so it must not
      // be listed as blocked.
      const blocked = new Set<string>();
      for (const t of ALL_TOOLS) {
        if (t.permission?.action === "view" && !canUseTool(t, { isAdmin: false, permissions: ctx.permissions })) {
          blocked.add(MODULE_LABELS[t.permission.module] || t.permission.module);
        }
      }
      blockedLabels = [...blocked];
    }

    const systemContent = buildSystemPrompt(ctx, { hasDataAccess, blockedLabels });
    let conversationMessages: any[] = [{ role: "system", content: systemContent }, ...messages];

    if (hasDataAccess && ctx) {
      const directAutomation = await maybeCreateEmailAutomationDirect(messages, ctx);
      if (directAutomation) return streamText(directAutomation);
    }

    // ── Tool-calling loop ──
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const { resp, provider, model } = await chatCompletionResilient(aiConfigs, {
        messages: conversationMessages,
        tools: toolsForModel,
        stream: false,
        temperature: 0,
      });
      const providerHeaders = { "x-otto-provider": provider, "x-otto-model": model };

      if (!resp.ok) {
        const status = resp.status;
        if (status === 429) return jsonError("O Otto está com muitos pedidos. Tenta novamente em alguns segundos.", 429);
        if (status === 402) return jsonError("Créditos de IA esgotados. Contacta o administrador.", 402);
        const errorText = await resp.text();
        console.error("AI gateway error:", status, errorText);
        return jsonError("Erro ao contactar o Otto. Tenta novamente.", 500);
      }

      const result = await resp.json();
      const choice = result.choices?.[0];
      if (!choice) return jsonError("Resposta vazia do modelo.", 500);

      const assistantMessage = choice.message;

      // Tool calls → execute and loop.
      if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
        conversationMessages.push(assistantMessage);
        for (const toolCall of assistantMessage.tool_calls) {
          const fnName = toolCall.function.name;
          let fnArgs: Record<string, any> = {};
          try { fnArgs = JSON.parse(toolCall.function.arguments || "{}"); } catch { fnArgs = {}; }

          let toolResult: string;
          if (!hasDataAccess || !ctx) {
            toolResult = JSON.stringify({ error: "Sem acesso a dados", _instruction: "O utilizador não está autenticado. Informa-o." });
          } else {
            console.log(`[otto] tool: ${fnName}`, JSON.stringify(fnArgs).slice(0, 200));
            toolResult = await runTool(fnName, fnArgs, ctx);
          }
          conversationMessages.push({ role: "tool", tool_call_id: toolCall.id, content: toolResult });
        }
        continue;
      }

      // Final answer → stream it progressively. We already have the full content
      // (no second model call, so multi-step flows like tickets stay consistent);
      // streamText just chunks it so the client renders word-by-word.
      if (assistantMessage.content) {
        return streamText(assistantMessage.content, providerHeaders);
      }
      return jsonError("Resposta vazia do Otto.", 500);
    }

    return streamText("Peço desculpa, não consegui processar o pedido. Tenta reformular a tua pergunta.");
  } catch (e) {
    console.error("otto error:", e);
    return jsonError(e instanceof Error ? e.message : "Erro desconhecido", 500);
  }
});
