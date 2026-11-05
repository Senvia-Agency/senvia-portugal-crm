import { formatAutomationInvocationError } from "../_shared/automation-invocation-error.ts";
import { renderAutomationTemplate } from "../_shared/automation-template.ts";
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.57.2';
import { InvalidCrmAction, type CrmActionInput, type CrmActionOutcome } from './crm-actions.ts';

function render(value: unknown, vars: Readonly<Record<string, unknown>>): string {
  return renderAutomationTemplate(String(value ?? ""), vars).text;
}
export function eventTimes(config: Readonly<Record<string, unknown>>, vars: Readonly<Record<string, unknown>>) {
  const start = new Date(render(config.start_time, vars));
  const end = config.end_time ? new Date(render(config.end_time, vars)) : null;
  if (!Number.isFinite(start.getTime()) || (end && (!Number.isFinite(end.getTime()) || end <= start))) {
    throw new InvalidCrmAction('Indique início e fim válidos para o evento.');
  }
  return { start_time: start.toISOString(), end_time: end?.toISOString() ?? null };
}
export function targetFlowId(config: Readonly<Record<string, unknown>>, currentFlow: string): string {
  const id = String(config.flow_id ?? '');
  if (!id || id === currentFlow) throw new InvalidCrmAction('Escolha outra automação.');
  return id;
}
export async function executeBusinessAction(db: SupabaseClient, input: CrmActionInput): Promise<CrmActionOutcome | null> {
  const { type, run, config, vars } = input;
  try {
    switch (type) {
      case 'create_lead':
      case 'mark_lead_lost':
      case 'complete_record_tasks': {
        if (!input.node_id) throw new InvalidCrmAction('O passo precisa de um identificador persistido.');
        const payload = Object.fromEntries(Object.entries(config).map(([key, value]) => [key, typeof value === 'string' ? render(value, vars) : value]));
        if (type === 'create_lead') validateNewLead(payload);
        const { data, error } = await db.rpc('automation_apply_record_action', {
          p_org_id: run.organization_id, p_run_id: run.id, p_node_id: input.node_id, p_action: type, p_payload: payload,
        });
        if (error || !data) throw new InvalidCrmAction(`Ação CRM falhou: ${error?.message ?? 'sem resultado'}`);
        return { kind: 'next', detail: data, context: { ...run.context, ...(type === 'create_lead' ? { lead_id: data.lead_id, __action_target: { type: 'lead', id: data.lead_id } } : {}) } };
      }
      case 'publish_feed': {
        if (!input.node_id) throw new InvalidCrmAction('A publicação exige um passo persistido.');
        const title = render(config.title, vars).trim();
        const body = render(config.message, vars).trim();
        if (!body || [...body].length > 4000 || [...title].length > 120) {
          throw new InvalidCrmAction('Use uma mensagem de 1 a 4000 caracteres e título até 120 caracteres.');
        }
        const { data, error } = await db.rpc('publish_automation_feed_post', {
          p_org_id: run.organization_id, p_run_id: run.id, p_node_id: input.node_id, p_title: title || null, p_body: body,
        });
        if (error || !data?.post_id) throw new InvalidCrmAction('Não foi possível publicar no Feed da organização.');
        return { kind: 'next', detail: { post_id: data.post_id } };
      }

      case 'convert_to_client': {
        if (run.subject_type !== 'lead' || !run.subject_id) throw new InvalidCrmAction('A conversão exige uma lead persistida.');
        const { data, error } = await db.rpc('automation_convert_lead', { p_org_id: run.organization_id, p_lead_id: run.subject_id });
        if (error || !data) throw new InvalidCrmAction(`Converter lead falhou: ${error?.message ?? 'cliente não criado'}`);
        return { kind: 'next', detail: { cliente_id: data }, context: { ...run.context, cliente_id: data, __action_target: { type: 'client', id: data } } };
      }
      case 'change_sale_status':
        throw new InvalidCrmAction('A mudança de estado da venda exige o fluxo de aprovação comercial e financeira.');
      case 'create_event': {
        const userId = String(config.user_id ?? '');
        const title = render(config.title, vars).trim();
        if (!userId || !title) throw new InvalidCrmAction('Escolha responsável e título para o evento.');
        const { data: member, error: memberError } = await db.from('organization_members').select('user_id')
          .eq('organization_id', run.organization_id).eq('user_id', userId).eq('is_active', true).maybeSingle();
        if (memberError || !member) throw new InvalidCrmAction('Responsável do evento não pertence à organização.');
        const times = eventTimes(config, vars);
        const meetingLink = render(config.meeting_link, vars).trim();
        if (meetingLink && !/^https?:\/\//i.test(meetingLink)) throw new InvalidCrmAction('A ligação da reunião deve começar por https:// ou http://.');
        const { data, error } = await db.from('calendar_events').insert({
          organization_id: run.organization_id, user_id: userId, title, ...times,
          description: render(config.description, vars) || null, event_type: 'meeting',
          meeting_link: meetingLink || null,
          lead_id: run.subject_type === 'lead' ? run.subject_id : null,
          client_id: run.subject_type === 'client' ? run.subject_id : null,
        }).select('id').single();
        if (error || !data) throw new InvalidCrmAction(`Criar evento falhou: ${error?.message ?? 'evento não criado'}`);
        return { kind: 'next', detail: { evento_id: data.id, ...times } };
      }
      case 'end_other_flow': {
        const flowId = targetFlowId(config, run.flow_id);
        if (!run.subject_id) throw new InvalidCrmAction('É necessário um registo persistido para terminar outra automação.');
        const { data: flow, error: flowError } = await db.from('automation_flows').select('id').eq('id', flowId).eq('organization_id', run.organization_id).maybeSingle();
        if (flowError || !flow) throw new InvalidCrmAction('Automação não encontrada nesta organização.');
        const { data, error } = await db.from('automation_runs').update({ status: 'cancelled', completed_at: new Date().toISOString(), current_node_id: null, wake_at: null })
          .eq('flow_id', flowId).eq('organization_id', run.organization_id).eq('subject_id', run.subject_id)
          .eq('subject_type', run.subject_type).in('status', ['running', 'waiting', 'awaiting_reply']).select('id');
        if (error) throw new InvalidCrmAction(`Terminar automação falhou: ${error.message}`);
        return { kind: 'next', detail: { fluxo: flowId, cancelados: data?.length ?? 0 } };
      }
      case 'execute_flow': {
        const flowId = targetFlowId(config, run.flow_id);
        const chain = Array.isArray(run.context.__flow_chain) ? run.context.__flow_chain.filter((id): id is string => typeof id === 'string') : [];
        if (chain.length >= 8 || chain.includes(flowId)) throw new InvalidCrmAction('Esta chamada criaria um ciclo entre automações.');
        if (!run.subject_id) throw new InvalidCrmAction('É necessário um registo persistido para iniciar outra automação.');
        const { data: flow, error: flowError } = await db.from('automation_flows').select('id,trigger_type').eq('id', flowId)
          .eq('organization_id', run.organization_id).eq('status', 'active').maybeSingle();
        if (flowError || !flow) throw new InvalidCrmAction('Automação ativa não encontrada nesta organização.');
        const record = Object.fromEntries(Object.entries(run.context).filter(([key]) => !key.startsWith('__')));
        const { data, error } = await db.functions.invoke('automation-engine', { body: {
          action: 'enroll', organization_id: run.organization_id, flow_id: flow.id, trigger_type: flow.trigger_type,
          flow_chain: [...chain, run.flow_id],
          subject_type: run.subject_type, record: { ...record, id: run.subject_id,
            name: run.contact_name, email: run.contact_email, phone: run.contact_phone },
        } });
        if (error) throw new InvalidCrmAction(formatAutomationInvocationError(error, "Iniciar automação falhou"));
        return enrollmentOutcome(flowId, data);
      }
      case 'send_proposal_email': return await sendProposal(db, input);
      default: return null;
    }
  } catch (error) {
    if (error instanceof InvalidCrmAction) return { kind: 'fail', error: error.message };
    throw error;
  }
}

async function sendProposal(db: SupabaseClient, input: CrmActionInput): Promise<CrmActionOutcome> {
  const { run } = input;
  if (run.subject_type !== 'proposal' || !run.subject_id) throw new InvalidCrmAction('Escolha um percurso de proposta para enviar a proposta.');
  const { data: proposal, error } = await db.from('proposals').select('id,code,proposal_date,total_value,client_id,lead_id,notes')
    .eq('organization_id', run.organization_id).eq('id', run.subject_id).maybeSingle();
  if (error || !proposal) throw new InvalidCrmAction('Proposta não encontrada nesta organização.');
  const table = proposal.client_id ? 'crm_clients' : 'leads';
  const contactId = proposal.client_id ?? proposal.lead_id;
  if (!contactId) throw new InvalidCrmAction('A proposta não tem um cliente ou lead associado.');
  const { data: contact, error: contactError } = await db.from(table).select('name,email').eq('id', contactId)
    .eq('organization_id', run.organization_id).maybeSingle();
  if (contactError || !contact?.email) throw new InvalidCrmAction('O destinatário da proposta não tem email nesta organização.');
  const { data: organization, error: orgError } = await db.from('organizations').select('name').eq('id', run.organization_id).maybeSingle();
  if (orgError || !organization) throw new InvalidCrmAction('Organização não encontrada.');
  const value = Number(proposal.total_value);
  if (!Number.isFinite(value)) throw new InvalidCrmAction('A proposta não tem um valor válido.');
  if (!input.node_id) throw new InvalidCrmAction('O envio exige um passo persistido.');
  const { data: lines, error: linesError } = await db.from('proposal_products')
    .select('product_id,quantity,unit_price,total').eq('proposal_id', proposal.id).order('created_at');
  if (linesError || !lines?.length) throw new InvalidCrmAction('A proposta não tem linhas de produtos confirmadas para enviar.');
  const { data: catalog, error: catalogError } = await db.from('products').select('id,name')
    .eq('organization_id', run.organization_id).in('id', lines.map(line => line.product_id));
  if (catalogError || !catalog) throw new InvalidCrmAction('Não foi possível consultar os produtos da organização.');
  const products = proposalEmailProducts(lines, catalog);
  const code = String(proposal.code ?? proposal.id);
  const { data, error: sendError } = await db.functions.invoke('send-proposal-email', { body: {
    organizationId: run.organization_id, to: contact.email, clientName: contact.name,
    proposalCode: code, proposalDate: proposal.proposal_date ?? '', totalValue: value,
    products, automationRunId: run.id, automationNodeId: input.node_id,
    notes: proposal.notes ?? '', orgName: organization.name,
  } });
  if (sendError) throw new InvalidCrmAction(formatAutomationInvocationError(sendError, 'Enviar proposta falhou'));
  if (data?.success !== true) throw new InvalidCrmAction(`Enviar proposta falhou: ${typeof data?.error === 'string' ? data.error : 'serviço de email rejeitou o pedido'}`);
  return { kind: 'next', detail: { proposta_id: proposal.id, message_id: data.messageId ?? null } };
}

export function validateNewLead(payload: Readonly<Record<string, unknown>>): void {
  if (!String(payload.name ?? '').trim()) throw new InvalidCrmAction('Indique o nome da nova lead.');
  if (!String(payload.email ?? '').trim() && !String(payload.phone ?? '').trim()) throw new InvalidCrmAction('Indique email ou telefone da nova lead.');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function enrollmentOutcome(flowId: string, response: unknown): CrmActionOutcome {
  if (!isRecord(response)) throw new InvalidCrmAction('Iniciar automação falhou: resposta inválida do motor.');
  if (response.error) throw new InvalidCrmAction(`Iniciar automação falhou: ${String(response.error)}`);
  const results = Array.isArray(response.results) ? response.results.filter(isRecord) : [];
  const failures = results.filter(result => result.error).map(result => String(result.error));
  if (failures.length) throw new InvalidCrmAction(`Iniciar automação falhou: ${failures.join('; ')}`);
  const enrolled = response.enrolled;
  if (typeof enrolled !== 'number' || !Number.isInteger(enrolled) || enrolled < 0) {
    throw new InvalidCrmAction('Iniciar automação falhou: contagem de inscrições inválida.');
  }
  if (enrolled > 0) return { kind: 'next', detail: { fluxo: flowId, inscritos: enrolled } };
  const reasons = results.filter(result => typeof result.skipped === 'string').map(result => String(result.skipped));
  if (typeof response.message === 'string' && response.message.trim()) reasons.push(response.message);
  if (!reasons.length) throw new InvalidCrmAction('Iniciar automação falhou: nenhum percurso inscrito e nenhum motivo informado.');
  return { kind: 'next', detail: { fluxo: flowId, inscritos: 0, ignorado: reasons.join('; ') } };
}

interface ProposalEmailLine { readonly product_id: string; readonly quantity: number; readonly unit_price: number; readonly total: number }
export function proposalEmailProducts(lines: readonly ProposalEmailLine[], catalog: readonly { readonly id: string; readonly name: string }[]) {
  return lines.map(line => {
    const product = catalog.find(item => item.id === line.product_id);
    if (!product?.name || !Number.isFinite(line.quantity) || line.quantity <= 0 || !Number.isFinite(line.unit_price) || !Number.isFinite(line.total)) {
      throw new InvalidCrmAction('Linha de proposta inválida ou produto fora da organização.');
    }
    return { name: product.name, quantity: line.quantity, unitPrice: line.unit_price, total: line.total };
  });
}
