export type RecurringFiscalMode = 'manual' | 'automatic';

export type RecurringFiscalDocumentPolicy =
  | 'invoice_then_receipt'
  | 'invoice_receipt_when_paid';

export type RecurringFiscalRecipientMode = 'client' | 'custom';

/** Email delivery settings consumed by the recurring fiscal Brevo worker. */
export interface RecurringFiscalEmailConfig {
  recipient_mode: RecurringFiscalRecipientMode;
  recipient_email: string;
  fallback_email: string;
  sender_name: string;
  sender_email: string;
  reply_to: string;
  subject_template: string;
  body_template: string;
}

export interface RecurringFiscalConfig {
  fiscal_mode: RecurringFiscalMode;
  fiscal_document_policy: RecurringFiscalDocumentPolicy;
  fiscal_auto_email: boolean;
  fiscal_email_config: RecurringFiscalEmailConfig;
}

export const DEFAULT_RECURRING_FISCAL_EMAIL_CONFIG: RecurringFiscalEmailConfig = {
  recipient_mode: 'client',
  recipient_email: '',
  fallback_email: '',
  sender_name: '',
  sender_email: '',
  reply_to: '',
  subject_template: '{{document_type}} {{document_number}}',
  body_template:
    'Olá {{client_name}},\n\nSegue em anexo o documento {{document_type}} {{document_number}}.\n\nCom os melhores cumprimentos.',
};

export const DEFAULT_RECURRING_FISCAL_CONFIG: RecurringFiscalConfig = {
  fiscal_mode: 'manual',
  fiscal_document_policy: 'invoice_then_receipt',
  fiscal_auto_email: false,
  fiscal_email_config: DEFAULT_RECURRING_FISCAL_EMAIL_CONFIG,
};

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function normalizeRecurringFiscalEmailConfig(value: unknown): RecurringFiscalEmailConfig {
  const record = value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {};

  return {
    recipient_mode: record.recipient_mode === 'custom' ? 'custom' : 'client',
    recipient_email: stringValue(record.recipient_email),
    fallback_email: stringValue(record.fallback_email),
    sender_name: stringValue(record.sender_name),
    sender_email: stringValue(record.sender_email),
    reply_to: stringValue(record.reply_to),
    subject_template:
      stringValue(record.subject_template) || DEFAULT_RECURRING_FISCAL_EMAIL_CONFIG.subject_template,
    body_template:
      stringValue(record.body_template) || DEFAULT_RECURRING_FISCAL_EMAIL_CONFIG.body_template,
  };
}

/**
 * Old databases do not expose the fiscal columns. Their safe interpretation
 * is always manual with automatic email disabled; automatic behaviour must
 * never be inferred from legacy recurrence data.
 */
export function normalizeRecurringFiscalConfig(value: unknown): RecurringFiscalConfig {
  const record = value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {};
  const fiscalMode: RecurringFiscalMode = record.fiscal_mode === 'automatic' ? 'automatic' : 'manual';

  return {
    fiscal_mode: fiscalMode,
    fiscal_document_policy:
      record.fiscal_document_policy === 'invoice_receipt_when_paid'
        ? 'invoice_receipt_when_paid'
        : 'invoice_then_receipt',
    fiscal_auto_email: fiscalMode === 'automatic' && record.fiscal_auto_email === true,
    fiscal_email_config: normalizeRecurringFiscalEmailConfig(record.fiscal_email_config),
  };
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function recurringFiscalConfigError(config: RecurringFiscalConfig): string | null {
  if (!config.fiscal_auto_email) return null;
  const email = config.fiscal_email_config;
  if (email.recipient_mode === 'custom' && !email.recipient_email.trim()) {
    return 'Indique o email específico do destinatário.';
  }
  const addresses = [
    ['destinatário', email.recipient_email],
    ['alternativo', email.fallback_email],
    ['remetente', email.sender_email],
    ['Reply-To', email.reply_to],
  ] as const;
  for (const [label, address] of addresses) {
    if (address.trim() && !EMAIL_PATTERN.test(address.trim())) {
      return `O email de ${label} não é válido.`;
    }
  }
  if (!email.subject_template.trim()) return 'O assunto do email é obrigatório.';
  if (!email.body_template.trim()) return 'A mensagem do email é obrigatória.';
  return null;
}
