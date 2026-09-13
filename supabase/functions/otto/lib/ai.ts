import { toOpenClawInput, fromOpenClawResponse } from './openclaw.ts';
// AI provider client. Model + endpoint are configurable via env vars so the
// deploy can switch models without code changes. Defaults reproduce the legacy
// otto-chat behaviour exactly (Gemini 2.5 Flash via the OpenAI-compat gateway).
//
//   OTTO_MODEL     — model id            (default: "gemini-2.5-flash")
//   OTTO_API_BASE  — chat completions URL (default: Gemini OpenAI-compat endpoint)
//   OTTO_API_KEY   — provider key         (default: falls back to GEMINI_API_KEY)
//
// Resilience: if the primary config (OTTO_*) is set but misconfigured/unreachable,
// we automatically fall back to the proven Gemini defaults (GEMINI_API_KEY +
// default endpoint/model) so a bad OTTO_* secret can never take Otto down.
const DEFAULT_BASE =
  "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const DEFAULT_MODEL = "gemini-2.5-flash";

export interface AIConfig {
  model: string;
  baseUrl: string;
  apiKey: string;
  openclaw?: boolean;
  responses?: boolean;
}

export interface AIConfigs {
  primary: AIConfig;
  fallback: AIConfig | null; // proven Gemini default, when it differs from primary
}

// Accept a base URL given as a host (DeepSeek/OpenAI style, e.g.
// "https://api.deepseek.com" or ".../v1") and turn it into the full
// chat-completions endpoint this client POSTs to. A URL that already targets a
// completions path is left untouched.
function normalizeBase(url: string): string {
  if (/\/(responses|(chat\/)?completions)(\?|#|$)/.test(url)) return url;
  return url.replace(/\/+$/, "") + "/chat/completions";
}

export function getAIConfigs(): AIConfigs {
  const ottoKey = Deno.env.get("OTTO_API_KEY");
  const geminiKey = Deno.env.get("GEMINI_API_KEY");
  const apiKey = ottoKey || geminiKey || "";
  if (!apiKey) throw new Error("Nenhuma chave de IA configurada (OTTO_API_KEY ou GEMINI_API_KEY).");

  const ottoBase = Deno.env.get("OTTO_API_BASE");
  const ottoModel = Deno.env.get("OTTO_MODEL");

  const primary: AIConfig = {
    model: ottoModel || DEFAULT_MODEL,
    baseUrl: ottoBase ? normalizeBase(ottoBase) : DEFAULT_BASE,
    apiKey,
    responses: Deno.env.get('OTTO_API_STYLE') === 'openclaw-responses',
    openclaw: /^(openclaw(?:[/:]|$)|agent:)/.test(ottoModel || "") || Deno.env.get('OTTO_API_STYLE')?.startsWith('openclaw') === true,
  };

  // A distinct Gemini fallback only makes sense when an OTTO_* override is in play
  // and we still have a Gemini key to fall back to.
  const usingOverride = !!(ottoKey || ottoBase || ottoModel);
  const fallback: AIConfig | null = (usingOverride && geminiKey)
    ? { model: DEFAULT_MODEL, baseUrl: DEFAULT_BASE, apiKey: geminiKey }
    : null;

  return { primary, fallback };
}

export interface ChatPayload {
  messages: any[];
  tools?: any[];
  stream?: boolean;
  temperature?: number;
}

export async function chatCompletion(cfg: AIConfig, payload: ChatPayload): Promise<Response> {
  const body: Record<string, any> = {
    model: cfg.model,
    messages: payload.messages,
    stream: payload.stream ?? false,
    temperature: payload.temperature ?? 0,
  };
  if (payload.tools && payload.tools.length > 0) body.tools = payload.tools;

  if (cfg.responses) {
    const url = cfg.baseUrl.replace(/\/chat\/completions$/, '/responses');
    const resp = await fetch(url, {
      method: 'POST', signal: AbortSignal.timeout(90000),
      headers: { Authorization: 'Bearer ' + cfg.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: cfg.model, input: toOpenClawInput(payload.messages), stream: false,
        tools: (payload.tools || []).map(tool => ({ type: 'function', ...tool.function })) }),
    });
    if (!resp.ok) return resp;
    return new Response(JSON.stringify(fromOpenClawResponse(await resp.json())), { headers: { 'Content-Type': 'application/json' } });
  }
  return await fetch(cfg.baseUrl, {
    method: "POST",
    signal: AbortSignal.timeout(90000),
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

export interface ResilientResult {
  resp: Response;
  provider: "primary" | "fallback";
  model: string;
}

// Statuses worth a retry: transient gateway/model errors (Gemini frequently
// returns 503 "model overloaded" under load). Rate-limit/quota (429/402) are NOT
// retried — they need a specific user-facing message, not a retry.
const TRANSIENT_STATUS = new Set([500, 502, 503, 504]);

// One config attempt, with a single short-backoff retry on a transient 5xx. This
// absorbs the occasional Gemini "overloaded" blip that previously surfaced as a
// hard 500 to the user.
async function attemptWithRetry(cfg: AIConfig, payload: ChatPayload): Promise<Response> {
  const resp = await chatCompletion(cfg, payload);
  if (resp.ok || resp.status === 429 || resp.status === 402 || !TRANSIENT_STATUS.has(resp.status)) {
    return resp;
  }
  console.error(`[otto] ${cfg.model} returned ${resp.status}; retrying once after backoff.`);
  await resp.body?.cancel();
  await new Promise((r) => setTimeout(r, 600));
  return await chatCompletion(cfg, payload);
}

// Try the primary config (each attempt self-retries on a transient 5xx); on a hard
// failure that is not a rate-limit/quota signal, retry with the Gemini fallback.
// Reports which provider actually answered so the caller can surface it (header).
export async function chatCompletionResilient(cfgs: AIConfigs, payload: ChatPayload): Promise<ResilientResult> {
  try {
    const resp = await attemptWithRetry(cfgs.primary, payload);
    if (resp.ok || !cfgs.fallback || cfgs.primary.openclaw || resp.status === 429 || resp.status === 402) {
      return { resp, provider: "primary", model: cfgs.primary.model };
    }
    console.error(`[otto] primary AI returned ${resp.status}; falling back to Gemini.`);
    return { resp: await attemptWithRetry(cfgs.fallback, payload), provider: "fallback", model: cfgs.fallback.model };
  } catch (e) {
    if (cfgs.fallback && !cfgs.primary.openclaw) {
      console.error(`[otto] primary AI threw (${(e as Error).message}); falling back to Gemini.`);
      return { resp: await attemptWithRetry(cfgs.fallback, payload), provider: "fallback", model: cfgs.fallback.model };
    }
    throw e;
  }
}
