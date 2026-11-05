import { deliverMetaTemplate, metaPayloadHash, parseMetaDeliveryClaim } from "../_shared/automation-meta-delivery.ts";
import { renderAutomationTemplate } from "../_shared/automation-template.ts";
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.57.2';
import { InvalidCrmAction, type CrmActionInput, type CrmActionOutcome } from './crm-actions.ts';

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function render(value: unknown, vars: Readonly<Record<string, unknown>>): string {
  return renderAutomationTemplate(String(value ?? ""), vars).text;
}
export function templatePayload(config: Readonly<Record<string, unknown>>, recipient: string, vars: Readonly<Record<string, unknown>>) {
  const name = String(config.template_name ?? '');
  const language = String(config.language ?? '');
  if (!/^[a-z0-9_]{1,512}$/.test(name) || !/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(language)) {
    throw new InvalidCrmAction('Escolha um modelo aprovado e o respetivo idioma.');
  }
  const raw = config.components ?? [];
  if (!Array.isArray(raw) || raw.length > 2) throw new InvalidCrmAction('Componentes do modelo inválidos.');
  const seen = new Set<string>();
  const components = raw.map(component => {
    if (!record(component) || (component.type !== 'header' && component.type !== 'body') || seen.has(component.type)
      || !Array.isArray(component.parameters) || component.parameters.length > 30
      || component.parameters.some(value => typeof value !== 'string')) {
      throw new InvalidCrmAction('Configure os parâmetros de texto do cabeçalho e do corpo.');
    }
    seen.add(component.type);
    return { type: component.type, parameters: component.parameters.map(value => ({ type: 'text', text: render(String(value), vars) })) };
  });
  return { messaging_product: 'whatsapp', to: recipient, type: 'template', template: { name, language: { code: language }, ...(components.length ? { components } : {}) } };
}

export async function executeInboxAction(db: SupabaseClient, input: CrmActionInput, transport: typeof fetch = fetch): Promise<CrmActionOutcome | null> {
  if (!['assign_conversation', 'close_conversation', 'send_meta_template'].includes(input.type)) return null;
  const { run, config, type } = input;
  try {
    const conversationId = typeof run.context.conversa_id === 'string' ? run.context.conversa_id
      : run.subject_type === 'contact' ? run.subject_id : null;
    if (!conversationId) throw new InvalidCrmAction('Este percurso não está associado a uma conversa.');
    const { data: conversation, error: readError } = await db.from('meta_conversations')
      .select('id,organization_id,channel_id,contact_ref').eq('id', conversationId).eq('organization_id', run.organization_id).maybeSingle();
    if (readError || !conversation) throw new InvalidCrmAction('Conversa não encontrada nesta organização.');
    if (config.channel_id && config.channel_id !== conversation.channel_id) throw new InvalidCrmAction('A conversa pertence a outra caixa.');
    const { data: channel, error: channelError } = await db.from('messaging_channels')
      .select('id,provider,channel_type,metadata,archived_at,status').eq('id', conversation.channel_id).eq('organization_id', run.organization_id).maybeSingle();
    if (channelError || !channel || channel.archived_at) throw new InvalidCrmAction('A caixa da conversa está indisponível.');
    if (type === 'assign_conversation') {
      const userId = String(config.user_id ?? '');
      if (!userId) throw new InvalidCrmAction('Escolha o responsável pela conversa.');
      const { data: member, error: memberError } = await db.from('organization_members').select('user_id')
        .eq('organization_id', run.organization_id).eq('user_id', userId).eq('is_active', true).maybeSingle();
      if (memberError || !member) throw new InvalidCrmAction('O responsável não é membro ativo desta organização.');
      const { error } = await db.from('meta_conversations').update({ assigned_to: userId }).eq('id', conversation.id).eq('organization_id', run.organization_id);
      if (error) throw new InvalidCrmAction('Não foi possível atribuir a conversa.');
      return { kind: 'next', detail: { conversa: conversation.id, atribuido_a: userId } };
    }
    if (type === 'close_conversation') {
      if (config.status !== undefined && config.status !== 'closed') throw new InvalidCrmAction('Esta ação só permite fechar a conversa.');
      const { error } = await db.from('meta_conversations').update({ status: 'closed' }).eq('id', conversation.id).eq('organization_id', run.organization_id);
      if (error) throw new InvalidCrmAction('Não foi possível fechar a conversa.');
      return { kind: 'next', detail: { conversa: conversation.id, estado: 'closed' } };
    }
    if (channel.channel_type !== 'whatsapp' || channel.provider === 'evolution' || !record(channel.metadata)
      || typeof channel.metadata.phone_number_id !== 'string' || !/^\d+$/.test(channel.metadata.phone_number_id)) {
      throw new InvalidCrmAction('Os modelos aprovados exigem uma caixa oficial do WhatsApp.');
    }
    if (channel.status === 'disconnected' || channel.status === 'error') throw new InvalidCrmAction('A caixa oficial está desligada.');
    const { data: suppressed, error: suppressionError } = await db.rpc('automation_contact_is_suppressed', {
      p_org_id: run.organization_id, p_phone: conversation.contact_ref, p_email: run.contact_email,
    });
    if (suppressionError) throw new InvalidCrmAction('Não foi possível confirmar as preferências do contacto.');
    if (suppressed === true) throw new InvalidCrmAction('O contacto pediu para não receber automações.');
    const payload = templatePayload(config, conversation.contact_ref, input.vars);
    const { data: approved, error: templateError } = await db.from('whatsapp_templates').select('id')
      .eq('channel_id', channel.id).eq('name', payload.template.name).eq('language', payload.template.language.code).eq('status', 'APPROVED').maybeSingle();
    if (templateError || !approved) throw new InvalidCrmAction('O modelo não está aprovado nesta caixa. Sincronize os modelos.');
    const { data: secret, error: secretError } = await db.from('messaging_channel_secrets').select('page_access_token').eq('channel_id', channel.id).maybeSingle();
    if (secretError || !secret?.page_access_token) throw new InvalidCrmAction('A caixa oficial não tem credenciais válidas.');
    if (!input.node_id) throw new InvalidCrmAction('O envio Meta exige uma visita persistida no percurso.');
    const payloadHash = await metaPayloadHash(payload);
    const delivery = await deliverMetaTemplate({
      claim: async () => {
        const { data, error } = await db.rpc('claim_automation_meta_delivery', {
          p_org_id: run.organization_id, p_run_id: run.id, p_visit_key: input.node_id,
          p_channel_id: channel.id, p_conversation_id: conversation.id,
          p_recipient: conversation.contact_ref, p_payload_hash: payloadHash,
        });
        if (error) throw new InvalidCrmAction('Não foi possível reservar o envio Meta nesta organização.');
        return parseMetaDeliveryClaim(data);
      },
      send: async () => {
        const response = await transport(`https://graph.facebook.com/v21.0/${channel.metadata.phone_number_id}/messages`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret.page_access_token}` },
          body: JSON.stringify(payload), signal: AbortSignal.timeout(30_000),
        });
        if (!response.ok) return { status: response.status };
        const result: unknown = await response.json();
        const first = record(result) && Array.isArray(result.messages) ? result.messages[0] : null;
        return { status: response.status, messageId: record(first) && typeof first.id === 'string' ? first.id : undefined };
      },
      settle: async (claim, status, messageId) => {
        const { data, error } = await db.rpc('settle_automation_meta_delivery', {
          p_id: claim.id, p_claim_token: claim.claim_token, p_status: status, p_message_id: messageId,
        });
        if (error || !record(data) || (data.sent_at !== null && typeof data.sent_at !== 'string')) {
          throw new InvalidCrmAction('Não foi possível confirmar o registo durável do envio Meta.');
        }
        return { sent_at: data.sent_at };
      },
      repairHistory: async (messageId, sentAt) => {
        const { data: existing, error: readError } = await db.from('meta_messages').select('id')
          .eq('organization_id', run.organization_id).eq('conversation_id', conversation.id).eq('external_id', messageId).maybeSingle();
        if (readError) throw new InvalidCrmAction('Não foi possível consultar o histórico do envio confirmado.');
        const content = `[modelo: ${payload.template.name}]`;
        if (!existing) {
          const { error: storeError } = await db.from('meta_messages').insert({ organization_id: run.organization_id,
            conversation_id: conversation.id, external_id: messageId, direction: 'outgoing', content,
            attachments: [], sent_by: null, sent_at: sentAt, delivery_status: 'sent' });
          if (storeError && storeError.code !== '23505') throw new InvalidCrmAction('Histórico do envio confirmado por recuperar.');
        }
        const { error: updateError } = await db.from('meta_conversations').update({ last_message: content, last_message_at: sentAt })
          .eq('id', conversation.id).eq('organization_id', run.organization_id)
          .or(`last_message_at.is.null,last_message_at.lte.${sentAt}`);
        if (updateError) throw new InvalidCrmAction('Resumo da conversa por recuperar.');
      },
    });
    if (delivery.status !== 'sent') return { kind: 'fail', error: delivery.error ?? 'Envio Meta por confirmar; requer revisão manual.' };
    return { kind: 'next', detail: { conversa: conversation.id, message_id: delivery.message_id, modelo: payload.template.name } };
  } catch (error) {
    if (error instanceof InvalidCrmAction) return { kind: 'fail', error: error.message };
    throw error;
  }
}
