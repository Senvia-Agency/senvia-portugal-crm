export type EmailDeliveryClaim = Readonly<{
  decision: 'send' | 'sent' | 'blocked';
  delivery_id: string;
  claim_token: string;
  idempotency_key: string;
  email_send_id: string | null;
  status: string;
}>;
export type EmailDeliveryResult = Readonly<{
  status: 'sent' | 'failed' | 'uncertain' | 'processing';
  email_send_id?: string;
  error?: string;
  retryable?: boolean;
}>;
export interface EmailDeliveryDependencies {
  readonly claim: () => Promise<EmailDeliveryClaim>;
  readonly send: (idempotencyKey: string) => Promise<{ status: number; messageId?: string }>;
  readonly saveLedger: (messageId: string) => Promise<string | null>;
  readonly finalize: (claim: EmailDeliveryClaim, status: 'sent' | 'failed_retryable' | 'uncertain', emailSendId: string | null, message: string | null) => Promise<void>;
}
export class InvalidEmailDeliveryClaim extends Error {}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function parseEmailDeliveryClaim(value: unknown): EmailDeliveryClaim {
  if (!isRecord(value) || !['send','sent','blocked'].includes(String(value.decision))
    || typeof value.delivery_id !== 'string' || typeof value.claim_token !== 'string'
    || typeof value.idempotency_key !== 'string' || typeof value.status !== 'string'
    || (value.email_send_id !== null && typeof value.email_send_id !== 'string')) {
    throw new InvalidEmailDeliveryClaim('Não foi possível reservar o envio de email.');
  }
  const decision = value.decision;
  if (decision !== 'send' && decision !== 'sent' && decision !== 'blocked') throw new InvalidEmailDeliveryClaim('Reserva inválida.');
  return { decision, delivery_id:value.delivery_id,claim_token:value.claim_token,idempotency_key:value.idempotency_key,email_send_id:value.email_send_id,status:value.status };
}

export async function deliverAutomationEmail(deps: EmailDeliveryDependencies): Promise<EmailDeliveryResult> {
  const claim = await deps.claim();
  if (claim.decision === 'sent') return { status:'sent', email_send_id:claim.email_send_id ?? undefined };
  if (claim.decision === 'blocked') return {
    status:claim.status === 'processing' ? 'processing' : 'uncertain', retryable:false,
    error:'Envio já iniciado ou por confirmar. Requer revisão manual antes de repetir.',
  };
  let accepted = false;
  try {
    const reply = await deps.send(claim.idempotency_key);
    if (reply.status === 408 || reply.status === 429 || (reply.status >= 500 && reply.status <= 599)) {
      await deps.finalize(claim,'failed_retryable',null,`Fornecedor rejeitou o pedido (HTTP ${reply.status}).`);
      return { status:'failed',retryable:true,error:`Fornecedor rejeitou o pedido (HTTP ${reply.status}).` };
    }
    if (reply.status < 200 || reply.status >= 300 || !reply.messageId) {
      await deps.finalize(claim,'uncertain',null,`Resposta do fornecedor requer revisão (HTTP ${reply.status}).`);
      return { status:'uncertain',retryable:false,error:'Resposta do fornecedor requer revisão manual antes de repetir.' };
    }
    accepted = true;
    const emailSendId = await deps.saveLedger(reply.messageId);
    if (!emailSendId) throw new Error('Email aceite sem confirmação do registo local.');
    await deps.finalize(claim,'sent',emailSendId,null);
    return { status:'sent',email_send_id:emailSendId };
  } catch (error) {
    const message = accepted ? 'Email aceite; confirmação local em falta. Requer revisão manual.'
      : 'Resultado do envio desconhecido. Requer revisão manual antes de repetir.';
    try { await deps.finalize(claim,'uncertain',null,message); }
    catch {
      return { status:'uncertain',retryable:false,error:message + ' O bloqueio de envio foi mantido.' };
    }
    return { status:'uncertain',retryable:false,error:message };
  }
}
