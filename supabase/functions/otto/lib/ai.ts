// AI provider client. Model + endpoint are configurable via env vars so the
// deploy can switch models without code changes. Defaults reproduce the legacy
// otto-chat behaviour exactly (Gemini 2.5 Flash via the OpenAI-compat gateway).
//
//   OTTO_MODEL     — model id            (default: "gemini-2.5-flash")
//   OTTO_API_BASE  — chat completions URL (default: Gemini OpenAI-compat endpoint)
//   OTTO_API_KEY   — provider key         (default: falls back to GEMINI_API_KEY)
//
// Resilience: if the primary config (OTTO_*) is set but misconfigured/unreachable,
// we can fall back to the proven Gemini defaults (GEMINI_API_KEY + default
// endpoint/model). OpenClaw configs are intentionally excluded from this fallback:
// Otto must stay on the OpenClaw agent instead of silently drifting back to Gemini.
const DEFAULT_BASE =
  "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const DEFAULT_MODEL = "gemini-2.5-flash";

export interface AIConfig {
  model: string;
  baseUrl: string;
  apiKey: string;
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
  if (/\/(chat\/)?completions(\?|#|$)/.test(url)) return url;
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
  };

  // A distinct Gemini fallback only makes sense when an OTTO_* override is in play,
  // we still have a Gemini key to fall back to, and the requested primary is not
  // the OpenClaw Otto agent.
  const usingOverride = !!(ottoKey || ottoBase || ottoModel);
  const isOpenClawPrimary =
    primary.model.startsWith("openclaw/") ||
    primary.baseUrl.includes("gw.senvia.pt");
  const fallback: AIConfig | null = (usingOverride && geminiKey && !isOpenClawPrimary)
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

  return await fetch(cfg.baseUrl, {
    method: "POST",
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

// Try the primary config; on a hard failure (network throw, or non-ok that is not
// a rate-limit/quota signal) retry once with the Gemini fallback. Reports which
// provider actually answered so the caller can surface it (diagnostics header).
export async function chatCompletionResilient(cfgs: AIConfigs, payload: ChatPayload): Promise<ResilientResult> {
  try {
    const resp = await chatCompletion(cfgs.primary, payload);
    if (resp.ok || !cfgs.fallback || resp.status === 429 || resp.status === 402) {
      return { resp, provider: "primary", model: cfgs.primary.model };
    }
    console.error(`[otto] primary AI returned ${resp.status}; falling back to Gemini.`);
    return { resp: await chatCompletion(cfgs.fallback, payload), provider: "fallback", model: cfgs.fallback.model };
  } catch (e) {
    if (cfgs.fallback) {
      console.error(`[otto] primary AI threw (${(e as Error).message}); falling back to Gemini.`);
      return { resp: await chatCompletion(cfgs.fallback, payload), provider: "fallback", model: cfgs.fallback.model };
    }
    throw e;
  }
}
