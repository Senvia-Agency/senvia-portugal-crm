import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.57.2';
import type { CrmActionRun } from './crm-actions.ts';

export type AutomationEmailRecipient =
  | { readonly kind: 'recipient'; readonly email: string; readonly name: string; readonly clientId?: string; readonly internal: boolean }
  | { readonly kind: 'fail'; readonly error: string };
const OWNER_TABLES: Readonly<Record<string, string>> = { lead: 'leads', client: 'crm_clients', contact: 'meta_conversations', conversation: 'meta_conversations' };
const emailValid = (value: unknown): value is string => typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

export async function resolveAutomationEmailRecipient(
  db: SupabaseClient, run: CrmActionRun, config: Readonly<Record<string, unknown>>,
): Promise<AutomationEmailRecipient> {
  const mode = config.recipient_mode ?? 'contact';
  if (mode === 'contact') {
    if (!emailValid(run.contact_email)) return { kind: 'fail', error: 'Contacto sem email válido.' };
    return { kind: 'recipient', email: run.contact_email, name: run.contact_name ?? run.contact_email,
      ...(run.subject_type === 'client' && run.subject_id ? { clientId: run.subject_id } : {}), internal: false };
  }
  if (mode !== 'owner' && mode !== 'user') return { kind: 'fail', error: 'Destinatário do email inválido.' };
  if (config.wait_event && config.wait_event !== 'none') return { kind: 'fail', error: 'Notificações internas não podem aguardar interação de contacto.' };
  let userId = mode === 'user' && typeof config.recipient_user_id === 'string' ? config.recipient_user_id : null;
  if (mode === 'owner') {
    let subjectType = run.subject_type;
    let subjectId = (subjectType === 'contact' || subjectType === 'conversation') && typeof run.context.conversa_id === 'string' ? run.context.conversa_id : run.subject_id;
    if (subjectType === 'sale' || subjectType === 'proposal') {
      const { data, error } = await db.from(subjectType === 'sale' ? 'sales' : 'proposals')
        .select('lead_id,client_id').eq('id', subjectId).eq('organization_id', run.organization_id).maybeSingle();
      if (error || !data) return { kind: 'fail', error: 'Registo não encontrado nesta organização.' };
      subjectType = data.lead_id ? 'lead' : 'client';
      subjectId = data.lead_id ?? data.client_id;
    }
    const table = OWNER_TABLES[subjectType];
    if (!table || !subjectId) return { kind: 'fail', error: 'Este registo não tem um responsável consultável.' };
    const { data, error } = await db.from(table).select('assigned_to')
      .eq('id', subjectId).eq('organization_id', run.organization_id).maybeSingle();
    if (error || !data) return { kind: 'fail', error: 'Registo não encontrado nesta organização.' };
    userId = typeof data.assigned_to === 'string' ? data.assigned_to : null;
  }
  if (!userId) return { kind: 'fail', error: mode === 'owner' ? 'Registo sem responsável atribuído.' : 'Escolha o membro destinatário.' };
  const { data: member, error: memberError } = await db.from('organization_members').select('user_id')
    .eq('organization_id', run.organization_id).eq('user_id', userId).eq('is_active', true).maybeSingle();
  if (memberError || !member) return { kind: 'fail', error: 'Destinatário não é membro ativo desta organização.' };
  const { data: profile, error: profileError } = await db.from('profiles').select('email,full_name').eq('id', userId).maybeSingle();
  if (profileError || !emailValid(profile?.email)) return { kind: 'fail', error: 'Membro destinatário sem email válido.' };
  return { kind: 'recipient', email: profile.email, name: profile.full_name || profile.email, internal: true };
}
