import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.57.2';

export interface FailurePolicy {
  readonly enabled: boolean;
  readonly threshold_percent: number;
  readonly min_runs: number;
  readonly window_minutes: number;
  readonly daily_summary: boolean;
}
export class InvalidFailurePolicy extends Error {}
export function readFailurePolicy(value: unknown): FailurePolicy | undefined {
  if (value === undefined || value === null || value === false) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) throw new InvalidFailurePolicy('Política de falhas inválida.');
  if (!('enabled' in value) || typeof value.enabled !== 'boolean') throw new InvalidFailurePolicy('Defina se a proteção está ligada.');
  const threshold = 'threshold_percent' in value ? value.threshold_percent : 20;
  const minimum = 'min_runs' in value ? value.min_runs : 10;
  const window = 'window_minutes' in value ? value.window_minutes : 60;
  if (typeof threshold !== 'number' || !Number.isFinite(threshold) || threshold < 1 || threshold > 100
    || typeof minimum !== 'number' || !Number.isInteger(minimum) || minimum < 2 || minimum > 10000
    || typeof window !== 'number' || !Number.isInteger(window) || window < 5 || window > 1440) {
    throw new InvalidFailurePolicy('Use limiar de 1–100%, pelo menos 2 percursos e janela de 5–1440 minutos.');
  }
  return { enabled: value.enabled, threshold_percent: threshold, min_runs: minimum, window_minutes: window,
    daily_summary: 'daily_summary' in value && value.daily_summary === true };
}
export function shouldPauseForFailures(policy: FailurePolicy, total: number, failed: number): boolean {
  return policy.enabled && total >= policy.min_runs && failed > 0 && failed * 100 / total > policy.threshold_percent;
}
export async function applyFailurePolicy(db: SupabaseClient, flow: {
  readonly id: string; readonly organization_id: string;
  readonly trigger_config?: Readonly<Record<string, unknown>> | null;
}): Promise<unknown> {
  const policy = readFailurePolicy(flow.trigger_config?.failure_policy);
  if (!policy?.enabled) return { paused: false, reason: 'disabled' };
  const { data, error } = await db.rpc('apply_automation_failure_policy', {
    p_flow_id: flow.id, p_organization_id: flow.organization_id,
  });
  if (error) throw new InvalidFailurePolicy('Não foi possível verificar a taxa de falhas.');
  return data;
}
export async function retryFailedRuns(db: SupabaseClient, input: {
  readonly flowId: string; readonly organizationId: string; readonly runIds?: readonly string[]; readonly limit?: number;
}, retryOne: (runId: string) => Promise<unknown>): Promise<{ readonly results: readonly { readonly run_id: string; readonly result: unknown }[] }> {
  const limit = input.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || (input.runIds && (input.runIds.length === 0 || input.runIds.length > 100))) {
    throw new InvalidFailurePolicy('Escolha entre 1 e 100 percursos para repetir.');
  }
  let query = db.from('automation_runs').select('id').eq('flow_id', input.flowId)
    .eq('organization_id', input.organizationId).eq('status', 'failed')
    .or('context->>__test.is.null,context->>__test.neq.true').order('started_at', { ascending: false }).limit(limit);
  if (input.runIds) query = query.in('id', [...input.runIds]);
  const { data, error } = await query;
  if (error) throw new InvalidFailurePolicy('Não foi possível consultar os percursos falhados.');
  const results: { run_id: string; result: unknown }[] = [];
  for (const run of data ?? []) results.push({ run_id: run.id, result: await retryOne(run.id) });
  return { results };
}
