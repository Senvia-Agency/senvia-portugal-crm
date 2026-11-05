import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { deliverAutomationEmail, parseEmailDeliveryClaim } from './automation-email-delivery.ts';

export interface ProposalDeliveryInput {
  readonly organizationId: string;
  readonly runId: string;
  readonly nodeId: string;
  readonly recipientEmail: string;
  readonly recipientName: string;
  readonly subject: string;
  readonly templateId: string;
}
export async function deliverProposalAutomationEmail(
  db: SupabaseClient,
  input: ProposalDeliveryInput,
  send: (key: string) => Promise<{ status: number; messageId?: string }>,
) {
  return deliverAutomationEmail({
    claim: async () => {
      const { data, error } = await db.rpc('claim_automation_email_delivery', {
        p_organization_id: input.organizationId, p_run_id: input.runId, p_node_id: input.nodeId, p_recipient_email: input.recipientEmail,
      });
      if (error) throw error;
      return parseEmailDeliveryClaim(data);
    },
    send,
    saveLedger: async messageId => {
      const { data, error } = await db.from('email_sends').insert({
        organization_id: input.organizationId, automation_run_id: input.runId, automation_node_id: input.nodeId,
        recipient_email: input.recipientEmail, recipient_name: input.recipientName, subject: input.subject,
        template_id: input.templateId, brevo_message_id: messageId, status: 'sent', sent_at: new Date().toISOString(),
      }).select('id').single();
      if (error) throw error;
      return data?.id ?? null;
    },
    finalize: async (claim, status, emailSendId, message) => {
      const { error } = await db.rpc('finalize_automation_email_delivery', {
        p_delivery_id: claim.delivery_id, p_claim_token: claim.claim_token, p_status: status,
        p_email_send_id: emailSendId, p_error: message,
      });
      if (error) throw error;
    },
  });
}
