export type WhatsAppAutomationConfig = {
  readonly channel_id?: string;
  readonly message?: string;
};

export function whatsappAutomationIssue(_config: WhatsAppAutomationConfig): string | null {
  if (!_config.channel_id?.trim()) return 'Escolhe a caixa de WhatsApp que envia esta mensagem.';
  if (!_config.message?.trim()) return 'Escreve a mensagem de WhatsApp desta automação.';
  return null;
}
