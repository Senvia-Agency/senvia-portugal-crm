import type { ConfirmationPreview, Tool, ToolContext, ToolResult } from "../types.ts";
import { NATIVE_AUTOMATION_TRIGGERS } from "../generic-automation-schema.ts";
import {
  AUTOMATION_CONFLICT,
  AUTOMATION_DATABASE_ERROR,
  AUTOMATION_DETAIL_COLUMNS,
  AUTOMATION_PROTECTED,
  automationInvalidArguments,
  automationResource,
  automationValidationFailure,
  loadAutomationFlow,
  matchesExpectedFlow,
  nativeFlowState,
  parseAutomationFlowRow,
  type NativeAutomationFlow,
} from "../generic-automation-store.ts";
import { validateNativeAutomationGraph } from "../generic-automation-validation.ts";
import { validateAutomationReferences } from "../generic-automation-references.ts";
import { buildAutomationActivationSnapshot } from "../generic-automation-activation-preview.ts";
import {
  CONCURRENCY_PARAMETERS,
  automationConcurrencyArgsSchema,
  confirmedAutomationActivationArgsSchema,
  parseAutomationArgs,
  type AutomationConcurrencyArgs,
} from "../generic-automation-tool-contracts.ts";

const ALL_NATIVE_TRIGGERS: ReadonlySet<(typeof NATIVE_AUTOMATION_TRIGGERS)[number]> = new Set(NATIVE_AUTOMATION_TRIGGERS);
const FLOW_NOT_ACTIVATABLE: ToolResult = {
  error: "A automação já não está em rascunho ou pausada.",
  reason_code: "flow_not_activatable",
  _instruction: "A ativação NÃO foi executada. Volta a consultar o fluxo.",
};

type CandidateResult =
  | { readonly ok: true; readonly flow: NativeAutomationFlow }
  | { readonly ok: false; readonly result: ToolResult };

async function loadCandidate(
  input: AutomationConcurrencyArgs,
  ctx: ToolContext,
): Promise<CandidateResult> {
  const loaded = await loadAutomationFlow(ctx, input.flow_id);
  if (!loaded.ok) return loaded;
  if (!matchesExpectedFlow(loaded.flow, { version: input.expected_version, updatedAt: input.expected_updated_at })) {
    return { ok: false, result: AUTOMATION_CONFLICT };
  }
  const state = nativeFlowState(loaded.flow);
  return state.native
    ? { ok: true, flow: state.flow }
    : { ok: false, result: AUTOMATION_PROTECTED };
}

async function activationCandidate(
  input: AutomationConcurrencyArgs,
  ctx: ToolContext,
): Promise<CandidateResult> {
  const candidate = await loadCandidate(input, ctx);
  if (!candidate.ok) return candidate;
  if (candidate.flow.status !== "draft" && candidate.flow.status !== "paused") {
    return { ok: false, result: FLOW_NOT_ACTIVATABLE };
  }
  const validation = validateNativeAutomationGraph(candidate.flow.graph, {
    entryNodeId: candidate.flow.entry_node_id,
    allowedEntryTriggers: ALL_NATIVE_TRIGGERS,
    requireComplete: true,
  });
  if (!validation.ok) return { ok: false, result: automationValidationFailure(validation.issues) };
  const referenceFailure = await validateAutomationReferences(ctx, validation.graph, candidate.flow.folder_id);
  return referenceFailure
    ? { ok: false, result: referenceFailure }
    : candidate;
}

async function activationPreview(
  args: Readonly<Record<string, unknown>>,
  ctx: ToolContext,
): Promise<ConfirmationPreview | null> {
  const input = parseAutomationArgs(automationConcurrencyArgsSchema, args);
  if (!input) return null;
  const candidate = await activationCandidate(input, ctx);
  if (!candidate.ok) return null;
  const snapshot = await buildAutomationActivationSnapshot(ctx, candidate.flow);
  if (!snapshot.ok) return null;
  return {
    title: "Ativar automação",
    summary: snapshot.summary,
    destination: `/automacoes/${candidate.flow.id}`,
    preparedArgs: {
      ...input,
      activation_snapshot_digest: snapshot.digest,
    },
  };
}

async function deletePreview(
  args: Readonly<Record<string, unknown>>,
  ctx: ToolContext,
): Promise<ConfirmationPreview | null> {
  const input = parseAutomationArgs(automationConcurrencyArgsSchema, args);
  if (!input) return null;
  const candidate = await loadCandidate(input, ctx);
  if (!candidate.ok) return null;
  return {
    title: "Eliminar automação",
    summary: [
      `Eliminar definitivamente “${candidate.flow.name}” (${candidate.flow.status}).`,
      `Versão confirmada: ${candidate.flow.version}.`,
      "A eliminação remove o desenho e o histórico associado e não pode ser anulada.",
    ].join("\n"),
    destination: `/automacoes/${candidate.flow.id}`,
  };
}

export const genericAutomationConfirmedTools = [
  {
    name: "activate_automation_flow",
    module: "automations",
    description: "Preparar e, após confirmação explícita, ativar um grafo nativo válido com controlo de concorrência.",
    parameters: CONCURRENCY_PARAMETERS,
    permission: { module: "automations", subarea: "flows", action: "manage" },
    isWrite: true,
    confirmation: { kind: "confirmation_required", preview: activationPreview },
    execute: async (args, ctx) => {
      const input = parseAutomationArgs(confirmedAutomationActivationArgsSchema, args);
      if (!input) return automationInvalidArguments();
      const candidate = await activationCandidate(input, ctx);
      if (!candidate.ok) return candidate.result;
      const snapshot = await buildAutomationActivationSnapshot(ctx, candidate.flow);
      if (!snapshot.ok || snapshot.digest !== input.activation_snapshot_digest) return AUTOMATION_CONFLICT;
      const { data, error } = await ctx.supabaseAdmin.from("automation_flows")
        .update({ status: "active", version: candidate.flow.version + 1 })
        .eq("id", candidate.flow.id).eq("organization_id", ctx.orgId)
        .eq("status", candidate.flow.status).eq("version", input.expected_version)
        .eq("updated_at", input.expected_updated_at)
        .select(AUTOMATION_DETAIL_COLUMNS).maybeSingle();
      if (error) return AUTOMATION_DATABASE_ERROR;
      if (data === null) return AUTOMATION_CONFLICT;
      const flow = parseAutomationFlowRow(data);
      if (!flow || flow.organization_id !== ctx.orgId || flow.status !== "active" || flow.version !== candidate.flow.version + 1) {
        return AUTOMATION_DATABASE_ERROR;
      }
      return {
        operation: "activated",
        flow,
        resource: automationResource(flow.id),
        invalidateQueryKeys: [["automation-flows"], ["automation-flow", flow.id]],
      };
    },
  },
  {
    name: "delete_automation_flow",
    module: "automations",
    description: "Preparar e, após confirmação explícita, eliminar um grafo nativo da organização com controlo de concorrência.",
    parameters: CONCURRENCY_PARAMETERS,
    permission: { module: "automations", subarea: "flows", action: "delete" },
    isWrite: true,
    confirmation: { kind: "confirmation_required", preview: deletePreview },
    execute: async (args, ctx) => {
      const input = parseAutomationArgs(automationConcurrencyArgsSchema, args);
      if (!input) return automationInvalidArguments();
      const candidate = await loadCandidate(input, ctx);
      if (!candidate.ok) return candidate.result;
      const { data, error } = await ctx.supabaseAdmin.from("automation_flows").delete()
        .eq("id", candidate.flow.id).eq("organization_id", ctx.orgId)
        .eq("status", candidate.flow.status).eq("version", input.expected_version)
        .eq("updated_at", input.expected_updated_at)
        .select("id,name,status,version,updated_at").maybeSingle();
      if (error) return AUTOMATION_DATABASE_ERROR;
      if (data === null) return AUTOMATION_CONFLICT;
      return {
        operation: "deleted",
        deleted_flow: data,
        resource: { type: "automation_flow", id: candidate.flow.id, route: "/automacoes" },
        invalidateQueryKeys: [["automation-flows"], ["automation-flow", candidate.flow.id]],
      };
    },
  },
] satisfies readonly Tool[];
