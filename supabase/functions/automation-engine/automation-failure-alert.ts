import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.57.2';
import { executeCrmAction, type CrmActionRun, type CrmActionOutcome } from './crm-actions.ts';

export interface AlertFlow {
  readonly id: string;
  readonly organization_id: string;
  readonly created_by?: string | null;
  readonly trigger_config?: Readonly<Record<string, unknown>> | null;
}
export type FailureAlertPlan =
  | { readonly enabled: false; readonly reason: string }
  | { readonly enabled: true; readonly userId: string; readonly link: string };

export function failureAlertPlan(run: CrmActionRun, flow: AlertFlow): FailureAlertPlan {
  if (run.context.__test === true) return { enabled: false, reason: 'test_run' };
  if (flow.trigger_config?.failure_alert_enabled !== true) return { enabled: false, reason: 'disabled' };
  if (flow.organization_id !== run.organization_id || flow.id !== run.flow_id) return { enabled: false, reason: 'scope_mismatch' };
  if (!flow.created_by) return { enabled: false, reason: 'owner_missing' };
  return { enabled: true, userId: flow.created_by,
    link: `/automacoes/${encodeURIComponent(flow.id)}?run=${encodeURIComponent(run.id)}` };
}

export async function alertAutomationFailure(
  db: SupabaseClient,
  run: CrmActionRun,
  flow: AlertFlow,
  _error: unknown,
): Promise<{ readonly skipped?: string; readonly notification?: CrmActionOutcome | null; readonly task?: CrmActionOutcome | null }> {
  const plan = failureAlertPlan(run, flow);
  if (!plan.enabled) return { skipped: plan.reason };
  // Provider errors may contain tokens or request payloads; alerts only link to the protected execution.
  const message = `Uma automação precisa de atenção. Consulte a execução: ${plan.link}`;
  const [notificationResult, taskResult] = await Promise.allSettled([
    executeCrmAction(db, {
    type: 'notify_user', run, vars: {},
    config: { user_id: plan.userId, title: 'Falha numa automação', message },
    }),
    executeCrmAction(db, {
    type: 'create_task', run, vars: {},
    config: { user_id: plan.userId, title: 'Verificar falha na automação', description: message,
      due_amount: 1, due_unit: 'hours' },
    }),
  ]);
  const notification = notificationResult.status === 'fulfilled' ? notificationResult.value : { kind: 'fail' as const, error: 'Não foi possível enviar o aviso da falha.' };
  const task = taskResult.status === 'fulfilled' ? taskResult.value : { kind: 'fail' as const, error: 'Não foi possível criar a tarefa da falha.' };
  return { notification, task };
}
