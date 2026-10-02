// Central tool registry. Collects every tool, decides which are exposed to the
// model for a given user (role + profile permissions), and runs a tool by name
// with a defense-in-depth permission re-check plus audit logging for writes.
import type { Tool, ToolContext, ToolResult } from "../types.ts";
import { readTools } from "./read.ts";
import { writeTools } from "./write.ts";
import { operationalTools } from "./operational.ts";
import { onboardingTools } from "./onboarding-tools.ts";
import { supportTools } from "./support.ts";
import { logAction } from "../audit.ts";

export const ALL_TOOLS: Tool[] = [
  ...readTools,
  ...writeTools,
  ...operationalTools,
  ...onboardingTools,
  ...supportTools,
];

const TOOL_BY_NAME: Record<string, Tool> = Object.fromEntries(ALL_TOOLS.map((t) => [t.name, t]));

// Can this user use this tool? Admins bypass everything except nothing — they
// get all tools. Non-admins are blocked from adminOnly tools and gated by their
// profile's module_permissions for tools that declare a `permission`.
export function canUseTool(tool: Tool, ctx: { isAdmin: boolean; permissions: Record<string, any> | null }): boolean {
  if (tool.adminOnly && !ctx.isAdmin) return false;
  if (ctx.isAdmin) return true;
  if (!tool.permission) return true; // open tools (support, onboarding status)
  const { module, subarea, action } = tool.permission;
  const perms = ctx.permissions;
  if (!perms) return false;
  const mod = perms[module];
  if (!mod?.subareas) return false;
  const sub = mod.subareas[subarea];
  if (!sub) return false;
  return sub[action] === true;
}

// OpenAI-format tool definitions for the tools this user may call.
export function getToolsForModel(ctx: { isAdmin: boolean; permissions: Record<string, any> | null }): any[] {
  return ALL_TOOLS.filter((t) => canUseTool(t, ctx)).map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

// Execute a tool call. Returns a JSON string (what the model expects as the tool
// message content).
export async function runTool(name: string, args: Record<string, any>, ctx: ToolContext): Promise<string> {
  const tool = TOOL_BY_NAME[name];
  if (!tool) return JSON.stringify({ error: `Ferramenta desconhecida: ${name}` });

  // Defense in depth: re-check permission at execution time, not just at exposure.
  if (!canUseTool(tool, ctx)) {
    return JSON.stringify({
      error: "Sem permissão",
      _instruction: "O utilizador não tem permissão para esta ação. Informa-o educadamente e sugere contactar o administrador.",
    });
  }

  let result: ToolResult;
  try {
    result = await tool.execute(args, ctx);
  } catch (e) {
    console.error(`Tool ${name} error:`, e);
    result = { error: `Erro ao executar ${name}`, _instruction: "ERRO INTERNO na ferramenta. Informa o utilizador que houve um erro técnico. NÃO INVENTES DADOS." };
  }

  if (tool.isWrite) {
    await logAction(ctx, name, args, result);
  }
  return JSON.stringify(result);
}
