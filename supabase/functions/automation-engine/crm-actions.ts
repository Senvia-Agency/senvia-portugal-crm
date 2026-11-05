import { formatAutomationInvocationError } from "../_shared/automation-invocation-error.ts";
import { renderAutomationTemplate } from "../_shared/automation-template.ts";
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.57.2';

export interface CrmActionRun {
  readonly id: string;
  readonly organization_id: string;
  readonly flow_id: string;
  readonly subject_type: string;
  readonly subject_id: string | null;
  readonly contact_name: string | null;
  readonly contact_email: string | null;
  readonly contact_phone: string | null;
  readonly context: Record<string, unknown>;
}
export interface CrmActionInput {
  readonly node_id?: string;
  readonly type: string;
  readonly config: Readonly<Record<string, unknown>>;
  readonly run: CrmActionRun;
  readonly vars: Readonly<Record<string, unknown>>;
  readonly now?: Date;
}
export type CrmActionOutcome =
  | { readonly kind: 'next'; readonly detail: Record<string, unknown>; readonly context?: Record<string, unknown> }
  | { readonly kind: 'fail'; readonly error: string };

export class InvalidCrmAction extends Error {}
const TABLES: Readonly<Record<string, string>> = { lead: 'leads', client: 'crm_clients', sale: 'sales', proposal: 'proposals' };
const FIELDS: Readonly<Record<string, readonly string[]>> = {
  lead: ['name', 'email', 'phone', 'company_name', 'company_nif', 'notes', 'source', 'status', 'temperature', 'value', 'tipologia'],
  client: ['name', 'email', 'phone', 'company', 'notes', 'source', 'status', 'city', 'country', 'whatsapp'],
  sale: ['notes'],
  proposal: ['notes', 'valid_until'],
};
function render(value: unknown, vars: Readonly<Record<string, unknown>>): string {
  return renderAutomationTemplate(String(value ?? ""), vars).text;
}
export function fieldPatch(entity: string, config: Readonly<Record<string, unknown>>, vars: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const field = String(config.field ?? '');
  if (!FIELDS[entity]?.includes(field)) throw new InvalidCrmAction('Este campo não pode ser alterado por automações.');
  const value = config.value === null ? null : render(config.value, vars);
  if (field === 'value') {
    if (value === null || value.trim() === '' || !Number.isFinite(Number(value))) throw new InvalidCrmAction('O valor tem de ser um número.');
    return { [field]: Number(value) };
  }
  return { [field]: value };
}
export function taskDueAt(config: Readonly<Record<string, unknown>>, now: Date): string {
  const amount = Number(config.due_amount ?? config.due_in_days ?? 1);
  const unit = config.due_amount === undefined ? 'days' : config.due_unit;
  const factors: Readonly<Record<string, number>> = { minutes: 60000, hours: 3600000, days: 86400000 };
  const factor = factors[String(unit)];
  if (!Number.isFinite(amount) || amount < 0 || !factor) throw new InvalidCrmAction('Prazo da tarefa inválido.');
  const date = new Date(now.getTime() + amount * factor);
  if (!Number.isFinite(date.getTime())) throw new InvalidCrmAction('Prazo da tarefa fora do intervalo permitido.');
  return date.toISOString();
}

export async function executeCrmAction(db: SupabaseClient, input: CrmActionInput): Promise<CrmActionOutcome | null> {
  const { type, config, run, vars } = input;
  try {
    switch (type) {
      case 'update_field': {
        const table = TABLES[run.subject_type];
        if (!table || !run.subject_id) throw new InvalidCrmAction('Este percurso não tem um registo editável.');
        const patch = fieldPatch(run.subject_type, config, vars);
        const { data, error } = await db.from(table).update(patch).eq('id', run.subject_id).eq('organization_id', run.organization_id).select('id').maybeSingle();
        if (error) throw new InvalidCrmAction(`Atualizar campo falhou: ${error.message}`);
        if (!data) throw new InvalidCrmAction('Registo não encontrado nesta organização.');
        return { kind: 'next', detail: { campos: Object.keys(patch) }, context: { ...run.context, ...patch } };
      }
      case 'remove_from_list': {
        if (!config.list_id || !run.contact_email) throw new InvalidCrmAction('Escolha uma lista e um contacto com email.');
        const { data: list, error: listError } = await db.from('client_lists').select('id').eq('id', config.list_id).eq('organization_id', run.organization_id).maybeSingle();
        if (listError || !list) throw new InvalidCrmAction('Lista não encontrada nesta organização.');
        const { data: contact, error: contactError } = await db.from('marketing_contacts').select('id').eq('email', run.contact_email).eq('organization_id', run.organization_id).maybeSingle();
        if (contactError) throw new InvalidCrmAction(`Consultar contacto falhou: ${contactError.message}`);
        if (!contact) return { kind: 'next', detail: { ignorado: 'contacto não pertence à lista' } };
        const { error } = await db.from('marketing_list_members').delete().eq('list_id', list.id).eq('contact_id', contact.id);
        if (error) throw new InvalidCrmAction(`Remover da lista falhou: ${error.message}`);
        return { kind: 'next', detail: { lista: list.id, removido: true } };
      }
      case 'assign_user': {
        if (config.assignment_mode === undefined || config.assignment_mode === 'fixed') {
          if ((run.subject_type !== 'lead' && run.subject_type !== 'client') || !run.subject_id) {
            throw new InvalidCrmAction('A atribuição exige uma lead ou cliente persistido.');
          }
          const userId = typeof config.user_id === 'string' ? config.user_id.trim() : '';
          if (!userId) throw new InvalidCrmAction('Escolha o responsável.');
          const { data: member, error: memberError } = await db.from('organization_members').select('user_id')
            .eq('organization_id', run.organization_id).eq('user_id', userId).eq('is_active', true).maybeSingle();
          if (memberError || !member) throw new InvalidCrmAction('Responsável não é membro ativo desta organização.');
          const table = run.subject_type === 'lead' ? 'leads' : 'crm_clients';
          const { data: updated, error } = await db.from(table).update({ assigned_to: userId })
            .eq('id', run.subject_id).eq('organization_id', run.organization_id).select('id').maybeSingle();
          if (error) throw new InvalidCrmAction(`Atribuição falhou: ${error.message}`);
          if (!updated) throw new InvalidCrmAction('Registo não encontrado nesta organização.');
          return { kind: 'next', detail: { atribuido_a: userId, modo: 'fixed' }, context: { ...run.context, assigned_to: userId } };
        }
        if (config.assignment_mode !== 'round_robin' && config.assignment_mode !== 'least_loaded') {
          throw new InvalidCrmAction('Modo de atribuição inválido.');
        }
        const { data, error } = await db.rpc('automation_assign_subject', {
          p_org_id: run.organization_id, p_subject_type: run.subject_type, p_subject_id: run.subject_id,
          p_mode: config.assignment_mode, p_user_ids: config.user_ids ?? null,
        });
        if (error || !data) throw new InvalidCrmAction(`Distribuição falhou: ${error?.message ?? 'sem membros disponíveis'}`);
        return { kind: 'next', detail: { atribuido_a: data, modo: config.assignment_mode }, context: { ...run.context, assigned_to: data } };
      }
      case 'notify_user': {
        const userId = String(config.user_id ?? '');
        if (!userId) throw new InvalidCrmAction('Escolha o destinatário da notificação.');
        const { data: member, error: memberError } = await db.from('organization_members').select('user_id').eq('organization_id', run.organization_id).eq('user_id', userId).eq('is_active', true).maybeSingle();
        if (memberError || !member) throw new InvalidCrmAction('Destinatário não é membro ativo da organização.');
        const title = render(config.title, vars).trim();
        if (!title) throw new InvalidCrmAction('Notificação sem título.');
        const { data, error } = await db.functions.invoke('send-push-notification', { body: {
          organization_id: run.organization_id, user_ids: [userId], title,
          body: render(config.message, vars), url: `/automacoes/${encodeURIComponent(run.flow_id)}`, tag: `automation-${run.id}`,
        } });
        if (error) throw new InvalidCrmAction(formatAutomationInvocationError(error, 'Notificação falhou'));
        if (data?.success !== true) throw new InvalidCrmAction('Notificação falhou: resposta inesperada');
        return { kind: 'next', detail: { notificado: userId, enviados: data.sent ?? 0 } };
      }
      case 'create_task': {
        const priority = config.priority === undefined ? 'normal' : config.priority;
        if (priority !== 'low' && priority !== 'normal' && priority !== 'high') throw new InvalidCrmAction('Escolha uma prioridade válida para a tarefa.');
        const title = render(config.title, vars).trim();
        if (!title) throw new InvalidCrmAction('Tarefa sem título.');
        const userId = typeof config.user_id === 'string' && config.user_id ? config.user_id : null;
        if (userId) {
          const { data: member, error } = await db.from('organization_members').select('user_id').eq('organization_id', run.organization_id).eq('user_id', userId).eq('is_active', true).maybeSingle();
          if (error || !member) throw new InvalidCrmAction('Responsável não é membro ativo da organização.');
        }
        const dueAt = taskDueAt(config, input.now ?? new Date());
        const base = { organization_id: run.organization_id, automation_origin_run_id: run.id, title, description: render(config.description, vars) || null,
          due_at: dueAt, priority, contact_name: run.contact_name, contact_phone: run.contact_phone, assigned_to: userId };
        const { error } = await db.from('inbox_tasks').insert({ ...base,
          lead_id: run.subject_type === 'lead' ? run.subject_id : null,
          client_id: run.subject_type === 'client' ? run.subject_id : null });
        if (error?.code === '23503') {
          const { error: fallbackError } = await db.from('inbox_tasks').insert(base);
          if (fallbackError) throw new InvalidCrmAction(`Criar tarefa falhou: ${fallbackError.message}`);
        } else if (error) throw new InvalidCrmAction(`Criar tarefa falhou: ${error.message}`);
        return { kind: 'next', detail: { tarefa: title, prazo: dueAt, prioridade: priority } };
      }
      default: return null;
    }
  } catch (error) {
    if (error instanceof InvalidCrmAction) return { kind: 'fail', error: error.message };
    throw error;
  }
}
