export interface EmailTemplate {
  id: string;
  organization_id: string;
  name: string;
  subject: string;
  html_content: string;
  /** Legacy free-text category. Read only to label templates not yet migrated. */
  category: EmailTemplateCategory;
  /** The organization's own category. Null means uncategorised. */
  category_id?: string | null;
  variables: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by?: string;
  automation_enabled?: boolean;
  automation_trigger_type?: string | null;
  automation_trigger_config?: Record<string, string> | null;
  automation_delay_minutes?: number;
}

/**
 * A category an organization created for itself. This replaced the fixed list
 * below, which nobody could add to — and which rows had already outgrown, with
 * a "trial" value written straight into the column.
 */
export interface EmailTemplateCategoryRow {
  id: string;
  organization_id: string;
  name: string;
  color: string | null;
  is_active: boolean | null;
  created_at: string;
  updated_at: string;
}

/**
 * The old fixed list. Still here only to label the legacy `category` text
 * column on templates that predate the migration; nothing new should use it.
 */
export type EmailTemplateCategory = 'general' | 'proposal' | 'welcome' | 'followup' | 'promotion';

export const TEMPLATE_CATEGORIES: Record<EmailTemplateCategory, string> = {
  general: 'Geral',
  proposal: 'Propostas',
  welcome: 'Boas-vindas',
  followup: 'Follow-up',
  promotion: 'Promoção',
};

export const TEMPLATE_VARIABLES_CLIENT = [
  { key: '{{nome}}', label: 'Nome do contacto' },
  { key: '{{email}}', label: 'Email do contacto' },
  { key: '{{telefone}}', label: 'Telefone' },
  { key: '{{empresa}}', label: 'Nome da empresa' },
] as const;

export const TEMPLATE_VARIABLES_ORG = [
  { key: '{{organizacao}}', label: 'Nome da organização' },
  { key: '{{vendedor}}', label: 'Nome do comercial' },
  { key: '{{vendedor_email}}', label: 'Email do comercial' },
  { key: '{{vendedor_telefone}}', label: 'Telefone do comercial' },
  { key: '{{data}}', label: 'Data atual' },
  { key: '{{data_ativacao}}', label: 'Data de ativação' },
  { key: '{{data_venda}}', label: 'Data da venda' },
  { key: '{{assinatura}}', label: 'Assinatura do comercial' },
] as const;

export const TEMPLATE_VARIABLES_RENEWAL = [
  { key: '{{codigo_venda}}', label: 'Código da venda' },
  { key: '{{produto_servico}}', label: 'Serviço/produto recorrente' },
  { key: '{{valor_recorrente}}', label: 'Valor recorrente da venda' },
  { key: '{{valor_pagamento}}', label: 'Valor do pagamento associado' },
  { key: '{{data_renovacao}}', label: 'Data da renovação' },
  { key: '{{dias_para_renovacao}}', label: 'Dias até à renovação' },
] as const;

export const TEMPLATE_VARIABLES = [
  ...TEMPLATE_VARIABLES_CLIENT,
  ...TEMPLATE_VARIABLES_ORG,
  ...TEMPLATE_VARIABLES_RENEWAL,
];

// Campaign types
export type CampaignStatus = 'draft' | 'sending' | 'sent' | 'failed' | 'scheduled';

export type CampaignChannel = 'email' | 'sms' | 'whatsapp';

export const CAMPAIGN_STATUS_LABELS: Record<CampaignStatus, string> = {
  draft: 'Rascunho',
  sending: 'A enviar',
  sent: 'Enviada',
  failed: 'Falhada',
  scheduled: 'Agendada',
};

export const CAMPAIGN_STATUS_STYLES: Record<CampaignStatus, { bg: string; text: string }> = {
  draft: { bg: 'hsl(var(--muted))', text: 'hsl(var(--muted-foreground))' },
  sending: { bg: 'hsl(45 93% 90%)', text: 'hsl(45 93% 30%)' },
  sent: { bg: 'hsl(142 76% 90%)', text: 'hsl(142 76% 30%)' },
  failed: { bg: 'hsl(0 84% 90%)', text: 'hsl(0 84% 30%)' },
  scheduled: { bg: 'hsl(210 80% 90%)', text: 'hsl(210 80% 30%)' },
};

export interface EmailCampaign {
  id: string;
  organization_id: string;
  name: string;
  template_id: string | null;
  subject: string | null;
  html_content: string | null;
  status: CampaignStatus;
  total_recipients: number;
  sent_count: number;
  failed_count: number;
  scheduled_at: string | null;
  sent_at: string | null;
  settings: Record<string, boolean>;
  settings_data: Record<string, string>;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  // joined
  template?: EmailTemplate;
}

export type EmailSendStatus = 'sent' | 'delivered' | 'opened' | 'clicked' | 'bounced' | 'spam' | 'blocked' | 'unsubscribed' | 'failed';

export const EMAIL_SEND_STATUS_LABELS: Record<EmailSendStatus, string> = {
  sent: 'Enviado',
  delivered: 'Entregue',
  opened: 'Aberto',
  clicked: 'Clicado',
  bounced: 'Bounce',
  spam: 'Spam',
  blocked: 'Bloqueado',
  unsubscribed: 'Dessubscrito',
  failed: 'Falhado',
};

export const EMAIL_SEND_STATUS_STYLES: Record<EmailSendStatus, { bg: string; text: string }> = {
  sent: { bg: 'hsl(var(--muted))', text: 'hsl(var(--muted-foreground))' },
  delivered: { bg: 'hsl(142 76% 90%)', text: 'hsl(142 76% 30%)' },
  opened: { bg: 'hsl(210 80% 90%)', text: 'hsl(210 80% 30%)' },
  clicked: { bg: 'hsl(270 70% 90%)', text: 'hsl(270 70% 30%)' },
  bounced: { bg: 'hsl(45 93% 90%)', text: 'hsl(45 93% 30%)' },
  spam: { bg: 'hsl(0 84% 90%)', text: 'hsl(0 84% 30%)' },
  blocked: { bg: 'hsl(220 10% 90%)', text: 'hsl(220 10% 40%)' },
  unsubscribed: { bg: 'hsl(30 80% 90%)', text: 'hsl(30 80% 30%)' },
  failed: { bg: 'hsl(0 84% 90%)', text: 'hsl(0 84% 30%)' },
};

export interface MarketingContact {
  id: string;
  organization_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  source: string | null;
  tags: string[];
  subscribed: boolean;
  created_at: string;
  updated_at: string;
}

export interface EmailSendWithTracking {
  id: string;
  organization_id: string;
  template_id: string | null;
  campaign_id: string | null;
  client_id: string | null;
  recipient_email: string;
  recipient_name: string | null;
  subject: string;
  status: string;
  error_message: string | null;
  sent_at: string | null;
  sent_by: string | null;
  created_at: string;
  opened_at: string | null;
  clicked_at: string | null;
  brevo_message_id: string | null;
}
