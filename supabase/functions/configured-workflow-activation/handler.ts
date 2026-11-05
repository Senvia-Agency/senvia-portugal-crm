import {
  ACTIVATION_CORS_HEADERS,
  type ActivationEndpointDependencies,
  activationRequestSchema,
  type EndpointFailure,
  type FlowSummary,
} from "./contract.ts";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...ACTIVATION_CORS_HEADERS,
      "Cache-Control": "no-store",
      "Content-Type": "application/json",
    },
  });
}

function failure(reason: EndpointFailure): Response {
  const status = reason === "unauthorized"
    ? 401
    : reason === "mfa_required" || reason === "admin_required" ||
        reason === "module_disabled"
    ? 403
    : reason === "flow_not_found"
    ? 404
    : reason === "activation_rejected"
    ? 409
    : reason === "graph_invalid" || reason === "preview_unavailable"
    ? 422
    : 503;
  const message = reason === "mfa_required"
    ? "É necessária autenticação de dois fatores."
    : reason === "admin_required"
    ? "Apenas administradores com acesso total podem ativar."
    : reason === "module_disabled"
    ? "O módulo de automações está desativado."
    : reason === "flow_not_found"
    ? "Automação não encontrada."
    : reason === "activation_rejected"
    ? "A prévia expirou, mudou ou já foi utilizada."
    : reason === "graph_invalid"
    ? "O grafo da automação não é válido."
    : reason === "preview_unavailable"
    ? "Não foi possível calcular uma prévia completa."
    : reason === "unauthorized"
    ? "Sessão inválida."
    : "Serviço temporariamente indisponível.";
  return response({ error: message, reason_code: reason }, status);
}

function safeFlow(flow: FlowSummary): Readonly<Record<string, unknown>> {
  return {
    id: flow.id,
    name: flow.name,
    status: flow.status,
    version: flow.version,
    updated_at: flow.updatedAt,
  };
}

export async function handleConfiguredWorkflowActivation<
  ActorToken,
  CandidateToken,
>(
  request: Request,
  dependencies: ActivationEndpointDependencies<ActorToken, CandidateToken>,
): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: ACTIVATION_CORS_HEADERS });
  }
  if (request.method !== "POST") {
    return response({
      error: "Método não permitido.",
      reason_code: "method_not_allowed",
    }, 405);
  }

  const authenticated = await dependencies.authenticate(request);
  if (!authenticated.ok) return failure(authenticated.reason);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return response({
      error: "Pedido inválido.",
      reason_code: "invalid_request",
    }, 400);
  }
  const parsed = activationRequestSchema.safeParse(body);
  if (!parsed.success) {
    return response({
      error: "Pedido inválido.",
      reason_code: "invalid_request",
    }, 400);
  }

  const loaded = await dependencies.loadCandidate(
    request,
    authenticated.token,
    parsed.data.flow_id,
  );
  if (!loaded.ok) return failure(loaded.reason);
  if (!loaded.access.automationsEnabled) {
    return response({
      error: "O módulo de automações está desativado.",
      reason_code: "module_disabled",
    }, 403);
  }
  if (!loaded.access.isAdmin || loaded.access.dataScope !== "all") {
    return response({
      error: "Apenas administradores com acesso total podem ativar.",
      reason_code: "admin_required",
    }, 403);
  }
  if (loaded.flow.triggerType !== "configured_workflow") {
    return failure("graph_invalid");
  }
  if (loaded.flow.status !== "draft" && loaded.flow.status !== "paused") {
    return response({
      error: "A automação já não pode ser ativada.",
      reason_code: "flow_not_activatable",
    }, 409);
  }

  if (parsed.data.action === "activate") {
    const current = await dependencies.prepareSnapshot(loaded.token);
    if (!current.ok) return failure(current.reason);
    if (current.snapshot.digest !== parsed.data.snapshot_digest) {
      return failure("activation_rejected");
    }
    const activated = await dependencies.activate(
      authenticated.token,
      parsed.data.preview_id,
      parsed.data.snapshot_digest,
    );
    if (!activated.ok) return failure(activated.reason);
    if (activated.flow.status !== "active") {
      return failure("database_unavailable");
    }
    return response({ action: "activated", flow: safeFlow(activated.flow) });
  }

  if (
    loaded.flow.version !== parsed.data.expected_version ||
    loaded.flow.updatedAt !== parsed.data.expected_updated_at
  ) {
    return response({
      error: "A automação mudou desde a última leitura.",
      reason_code: "flow_stale",
    }, 409);
  }

  const prepared = await dependencies.prepareSnapshot(loaded.token);
  if (!prepared.ok) return failure(prepared.reason);
  const proof = await dependencies.recordProof(loaded.token, prepared.snapshot);
  if (!proof.ok) return failure(proof.reason);
  return response({
    action: "prepared",
    flow: safeFlow(loaded.flow),
    preview: {
      scanned_records: prepared.snapshot.scannedRecords,
      eligible_records: prepared.snapshot.eligibleRecords,
      eligible_stages: prepared.snapshot.eligibleStages,
      observed_local_date: prepared.snapshot.observedLocalDate,
      time_zone: prepared.snapshot.timeZone,
      stages: prepared.snapshot.stages.map((stage) => ({
        stage_id: stage.stageId,
        node_id: stage.nodeId,
        eligible_records: stage.eligibleRecords,
      })),
    },
    confirmation: {
      preview_id: proof.previewId,
      snapshot_digest: prepared.snapshot.digest,
      expires_at: proof.expiresAt,
    },
  });
}
