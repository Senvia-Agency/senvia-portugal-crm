import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

interface Recipient {
  email: string;
  name: string;
  clientId?: string;
  variables?: Record<string, string>;
}

interface SendTemplateRequest {
  templateId?: string;
  recipients: Recipient[];
  campaignId?: string;
  settings?: Record<string, boolean>;
  settingsData?: Record<string, string>;
  subject?: string;
  htmlContent?: string;
  requiredTriggerType?: string;
}

interface SendTemplateResponse {
  success: boolean;
  summary: {
    total: number;
    sent: number;
    failed: number;
  };
  results: Array<{
    email: string;
    status: string;
    error?: string;
  }>;
}

export function useSendTemplateEmail() {
  const { organization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ templateId, recipients, campaignId, settings, settingsData, subject, htmlContent, requiredTriggerType }: SendTemplateRequest): Promise<SendTemplateResponse> => {
      if (!organization?.id) throw new Error('Sem organização');

      const { data, error } = await supabase.functions.invoke('send-template-email', {
        body: {
          organizationId: organization.id,
          templateId: templateId || undefined,
          recipients,
          campaignId,
          settings,
          settingsData,
          subject,
          htmlContent,
          requiredTriggerType,
        },
      });

      if (error) throw error;
      return data as SendTemplateResponse;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['email-sends'] });
      
      if (data.summary.failed === 0) {
        toast.success(`Email enviado para ${data.summary.sent} destinatário(s)`);
      } else if (data.summary.sent > 0) {
        toast.warning(`${data.summary.sent} enviado(s), ${data.summary.failed} falhou/falharam`);
      } else {
        toast.error('Falha ao enviar emails');
      }
    },
    onError: (error) => {
      console.error('Error sending template:', error);
      toast.error('Erro ao enviar email');
    },
  });
}
