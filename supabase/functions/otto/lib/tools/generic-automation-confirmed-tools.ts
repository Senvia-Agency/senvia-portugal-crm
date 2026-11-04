import type { ConfirmationPreview, Tool, ToolContext, ToolResult } from "../types.ts";
import { parseAutomationWorkflowDefinition } from "../../../_shared/automation-workflow-contract.ts";
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
import {
  buildAutomationActivationSnapshot,
  configuredWorkflowPreviewLines,
} from "../generic-automation-activation-preview.ts";
import { buildConfiguredWorkflowPreview } from "../generic-automation-workflow-preview.ts";
import {
  CONCURRENCY_PARAMETERS,
  FLOW_ID_PARAMETERS,
  automationConcurrencyArgsSchema,
  automationFlowIdArgsSchema,
  confirmedAutomationActivationArgsSchema,
  parseAutomationArgs,
  type AutomationConcurrencyArgs,
} from "../generic-automation-tool-contracts.ts";

const ALL_NATIVE_TRIGGERS: ReadonlySet<(typeof NATIVE_AUTOMATION_TRIGGERS)[number]> = new Set(NATIVE_AUTOMATION_TRIGGERS);
export const PREPARE_CONFIGURED_MANUAL_RUN = "prepare_configured_workflow_manual_run";
const FLOW_NOT_ACTIVATABLE: ToolResult = {
  error: "A automação já não está em rascunho ou pausada.",
  reason_code: "flow_not_activatable",
  _instruction: "A ativação NÃO foi executada. Volta a consultar o fluxo.",
};
const CATCHUP_ESTIMATE_UNAVAILABLE: ToolResult = {
  error: "Ainda não foi possível calcular quantos registos já estão elegíveis para este fluxo.",
  reason_code: "catchup_estimate_unavailable",
  _instruction: "A ativação NÃO foi executada. Mantém o fluxo em rascunho até existir uma estimativa real e apresenta esta limitação ao utilizador.",
};
const CONFIGURED_ACTIVATION_REJECTED: ToolResult = {
  error: "A prévia de ativação expirou, mudou ou já foi utilizada.",
  reason_code: "configured_activation_rejected",
  _instruction: "A ativação NÃO foi executada. Confirma que o administrador tem MFA ativo, volta a consultar o fluxo e cria uma nova prévia.",
};
const CONFIGURED_MANUAL_FLOW_UNAVAILABLE: ToolResult = {
  error: "O fluxo não é uma automação manual ativa e configurável.",
  reason_code: "configured_manual_flow_unavailable",
  _instruction: "A execução NÃO foi preparada. Consulta novamente o fluxo e confirma que usa o gatilho manual autenticado e está ativo.",
};
const CONFIGURED_MANUAL_CONFIRMATION_UNAVAILABLE: ToolResult = {
  error: "Não foi possível preparar a confirmação da execução manual.",
  reason_code: "configured_manual_confirmation_unavailable",
  _instruction: "A automação NÃO foi executada. Confirma que o administrador tem MFA ativo e tenta preparar uma nova confirmação.",
};
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ConfiguredActivationPreviewProof = {
  readonly previewId: string;
  readonly expiresAt: string;
};

type CandidateResult =
  | { readonly ok: true; readonly flow: NativeAutomationFlow }
  | { readonly ok: false; readonly result: ToolResult };

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function configuredManualPreparation(value: unknown): Readonly<{
  confirmationId: string;
  expiresAt: string;
}> | null {
  if (!isRecord(value)
    || typeof value.confirmation_id !== "string"
    || !UUID_PATTERN.test(value.confirmation_id)
    || typeof value.expires_at !== "string"
    || !Number.isFinite(Date.parse(value.expires_at))) return null;
  return { confirmationId: value.confirmation_id, expiresAt: value.expires_at };
}

async function recordConfiguredActivationPreview(
  ctx: ToolContext,
  flow: NativeAutomationFlow,
  snapshot: Extract<Awaited<ReturnType<typeof buildAutomationActivationSnapshot>>, { readonly ok: true }>,
): Promise<ConfiguredActivationPreviewProof | null> {
  const preview = snapshot.configuredWorkflowPreview;
  if (!preview) return null;
  const { data, error } = await ctx.supabaseAdmin.rpc(
    "record_configured_workflow_activation_preview",
    {
      p_flow_id: flow.id,
      p_previewed_by: ctx.userId,
      p_snapshot_digest: snapshot.digest,
      p_scanned_records: preview.scannedRecords,
      p_eligible_records: preview.eligibleRecords,
      p_eligible_stages: preview.eligibleStages,
      p_stage_counts: preview.stages,
      p_observed_local_date: preview.observedLocalDate,
      p_time_zone: preview.timeZone,
    },
  );
  const rows: unknown = data;
  if (error || !Array.isArray(rows) || rows.length !== 1 || !isRecord(rows[0])) return null;
  const row = rows[0];
  return typeof row.preview_id === "string"
      && UUID_PATTERN.test(row.preview_id)
      && typeof row.expires_at === "string"
    ? { previewId: row.preview_id, expiresAt: row.expires_at }
    : null;
}

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
  const proof = snapshot.configuredWorkflowPreview
    ? await recordConfiguredActivationPreview(ctx, candidate.flow, snapshot)
    : null;
  if (snapshot.configuredWorkflowPreview && !proof) return null;
  return {
    title: "Ativar automação",
    summary: snapshot.summary,
    destination: `/automacoes/${candidate.flow.id}`,
    preparedArgs: {
      ...input,
      activation_snapshot_digest: snapshot.digest,
      ...(proof ? { activation_preview_id: proof.previewId } : {}),
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
      if (!snapshot.ok) {
        return snapshot.reasonCode === "catchup_estimate_unavailable"
          ? CATCHUP_ESTIMATE_UNAVAILABLE
          : AUTOMATION_CONFLICT;
      }
      if (snapshot.digest !== input.activation_snapshot_digest) return AUTOMATION_CONFLICT;
      if (candidate.flow.trigger_type === "configured_workflow") {
        if (!snapshot.configuredWorkflowPreview || !input.activation_preview_id) {
          return CONFIGURED_ACTIVATION_REJECTED;
        }
        const { data, error } = await ctx.supabaseUser.rpc(
          "activate_configured_workflow_from_preview",
          {
            p_preview_id: input.activation_preview_id,
            p_snapshot_digest: snapshot.digest,
          },
        );
        const rows: unknown = data;
        if (error || !Array.isArray(rows) || rows.length !== 1) {
          return CONFIGURED_ACTIVATION_REJECTED;
        }
        const flow = parseAutomationFlowRow(rows[0]);
        if (!flow
          || flow.organization_id !== ctx.orgId
          || flow.id !== candidate.flow.id
          || flow.status !== "active"
          || flow.version !== candidate.flow.version + 1) {
          return AUTOMATION_DATABASE_ERROR;
        }
        return {
          operation: "activated",
          flow,
          resource: automationResource(flow.id),
          invalidateQueryKeys: [["automation-flows"], ["automation-flow", flow.id]],
        };
      }
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
    name: PREPARE_CONFIGURED_MANUAL_RUN,
    module: "automations",
    description: "Preparar uma execução única de uma automação configurável com gatilho manual. Devolve uma confirmação de cinco minutos e não executa por si só.",
    parameters: FLOW_ID_PARAMETERS,
    permission: { module: "automations", subarea: "flows", action: "manage" },
    adminOnly: true,
    isWrite: true,
    confirmation: { kind: "immediate" },
    execute: async (args, ctx) => {
      const input = parseAutomationArgs(automationFlowIdArgsSchema, args);
      if (!input) return automationInvalidArguments();
      const loaded = await loadAutomationFlow(ctx, input.flow_id);
      if (!loaded.ok) return loaded.result;
      const state = nativeFlowState(loaded.flow);
      if (!state.native
        || state.flow.status !== "active"
        || state.flow.trigger_type !== "configured_workflow") {
        return CONFIGURED_MANUAL_FLOW_UNAVAILABLE;
      }
      const definition = parseAutomationWorkflowDefinition(state.flow.entryNode.config.workflow);
      if (!definition.ok || definition.value.trigger.kind !== "authenticated_manual") {
        return CONFIGURED_MANUAL_FLOW_UNAVAILABLE;
      }
      const estimate = await buildConfiguredWorkflowPreview(ctx, state.flow, definition.value);
      if (!estimate.ok) return CATCHUP_ESTIMATE_UNAVAILABLE;
      const { data, error } = await ctx.supabaseUser.functions.invoke("automation-engine", {
        body: { action: "prepare_configured_manual", flow_id: state.flow.id },
      });
      if (error) return CONFIGURED_MANUAL_CONFIRMATION_UNAVAILABLE;
      const prepared = configuredManualPreparation(data);
      if (!prepared) return CONFIGURED_MANUAL_CONFIRMATION_UNAVAILABLE;
      const summary = [
        `Executar “${state.flow.name}” uma vez.`,
        ...configuredWorkflowPreviewLines(estimate),
        ...(estimate.recordsWithImmediateActions > 0
          ? ["Depois da confirmação, algumas ações imediatas podem começar."]
          : []),
        ...(estimate.recordsWithDeferredActions > 0
          ? ["As restantes ações só poderão começar depois das esperas configuradas e de nova revalidação."]
          : []),
        ...(estimate.eligibleStages === 0
          ? ["Neste momento, a prévia não encontrou ações elegíveis."]
          : []),
        "O motor volta a consultar cada registo antes de iniciar a respetiva ação.",
      ].join("\n");
      return {
        confirmation_id: prepared.confirmationId,
        expires_at: prepared.expiresAt,
        flow: { id: state.flow.id, name: state.flow.name, version: state.flow.version },
        preview: {
          scanned_records: estimate.scannedRecords,
          eligible_records: estimate.eligibleRecords,
          eligible_stages: estimate.eligibleStages,
          stages: estimate.stages,
        },
        _action_preview: {
          confirmationId: prepared.confirmationId,
          expiresAt: prepared.expiresAt,
          title: "Executar automação manual",
          summary,
          destination: `/automacoes/${state.flow.id}`,
        },
        _instruction: "Mostra a prévia e aguarda o botão de confirmação. Não afirmes que a automação foi executada antes do resultado confirmado.",
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
