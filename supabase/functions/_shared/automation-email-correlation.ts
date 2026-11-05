export class AutomationEmailCorrelationError extends Error {
  readonly status: 400 | 403 | 404;
  constructor(message: string, status: 400 | 403 | 404) { super(message); this.status = status; }
}
export interface AutomationEmailCorrelationRequest {
  readonly organizationId: string;
  readonly automationRunId?: unknown;
  readonly automationNodeId?: unknown;
  readonly recipientCount: number;
}
export interface AutomationEmailRun {
  readonly organization_id: string;
  readonly status: string;
}
export async function resolveAutomationEmailCorrelation(
  request: AutomationEmailCorrelationRequest,
  isInternal: boolean,
  loadRun: (id: string) => Promise<AutomationEmailRun | null>,
): Promise<{ automation_run_id: string; automation_node_id: string } | null> {
  if (request.automationRunId === undefined && request.automationNodeId === undefined) return null;
  if (!isInternal) throw new AutomationEmailCorrelationError('A ligação a uma execução só pode ser definida pelo motor.', 403);
  if (typeof request.automationRunId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(request.automationRunId)
    || typeof request.automationNodeId !== 'string' || request.automationNodeId.trim().length === 0 || request.automationNodeId.length > 200
    || request.recipientCount !== 1) {
    throw new AutomationEmailCorrelationError('Ligação de execução inválida para este envio.', 400);
  }
  const run = await loadRun(request.automationRunId);
  if (!run || run.organization_id !== request.organizationId) throw new AutomationEmailCorrelationError('Execução não encontrada nesta organização.', 404);
  if (run.status !== 'running') throw new AutomationEmailCorrelationError('A execução já não está a enviar este email.', 403);
  return { automation_run_id: request.automationRunId, automation_node_id: request.automationNodeId };
}
