import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.57.2';
import type { CrmActionRun } from './crm-actions.ts';

export class InvalidActionTarget extends Error {}
type Entity = 'lead' | 'client' | 'sale' | 'proposal';
interface Target { readonly type: Entity; readonly id: string }
const tables: Readonly<Record<Entity, string>> = { lead: 'leads', client: 'crm_clients', sale: 'sales', proposal: 'proposals' };
function isEntity(value: unknown): value is Entity { return typeof value === 'string' && Object.hasOwn(tables, value); }
function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function text(value: unknown): string | null { return typeof value === 'string' && value.trim() ? value : null; }
function targetFor(run: CrmActionRun, originalSubject: boolean): Target | null {
  const configured = run.context.__action_target;
  if (!originalSubject && configured !== undefined) {
    const target = record(configured);
    if (!target || !['lead', 'client', 'sale'].includes(String(target.type)) || !isEntity(target.type) || !text(target.id)) {
      throw new InvalidActionTarget('O registo escolhido pelo passo anterior é inválido.');
    }
    return { type: target.type, id: String(target.id) };
  }
  return isEntity(run.subject_type) && run.subject_id ? { type: run.subject_type, id: run.subject_id } : null;
}
async function load(db: SupabaseClient, org: string, target: Target): Promise<Record<string, unknown>> {
  const { data, error } = await db.from(tables[target.type]).select('*').eq('id', target.id).eq('organization_id', org).maybeSingle();
  const value = record(data);
  if (error || !value) throw new InvalidActionTarget('O registo desta ação não está disponível nesta organização.');
  return value;
}
/** The returned view is local to one step. Enrollment, reentry and goals retain the original subject. */
export async function resolveActionTarget<R extends CrmActionRun>(db: SupabaseClient, run: R, originalSubject = false): Promise<R> {
  const target = targetFor(run, originalSubject);
  if (!target) return run;
  const current = await load(db, run.organization_id, target);
  let contact = current;
  if (target.type === 'sale' || target.type === 'proposal') {
    const clientId = text(current.client_id);
    const leadId = text(current.lead_id);
    contact = clientId || leadId ? await load(db, run.organization_id, { type: clientId ? 'client' : 'lead', id: clientId ?? String(leadId) }) : {};
  }
  const name = text(contact.name ?? contact.nome);
  const email = text(contact.email);
  const phone = text(contact.phone ?? contact.telefone);
  const context = { ...run.context, ...current, nome: name ?? '', email: email ?? '', telefone: phone ?? '',
    company_name: contact.company_name ?? contact.company ?? null, company_nif: contact.company_nif ?? contact.nif ?? null };
  return { ...run, subject_type: target.type, subject_id: target.id, contact_name: name, contact_email: email, contact_phone: phone, context };
}
