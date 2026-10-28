/** KeyInvoice is the provider and has a credential: the only case where receipts can be automatic. */
export function isKeyInvoiceActive(organization: {
  integrations_enabled?: unknown;
  tem_keyinvoice_password?: boolean | null;
  billing_provider?: string | null;
} | null | undefined): boolean {
  return (organization?.integrations_enabled as Record<string, boolean> | null | undefined)?.keyinvoice === true
    && organization?.tem_keyinvoice_password === true
    && organization?.billing_provider === 'keyinvoice';
}

/** "follow" = the sale uses the client's default (NULL in the database). */
export type SaleFiscalChoice = 'follow' | 'on' | 'off';

export const choiceFromValue = (value: boolean | null | undefined): SaleFiscalChoice =>
  value === true ? 'on' : value === false ? 'off' : 'follow';

export const valueFromChoice = (choice: SaleFiscalChoice): boolean | null =>
  choice === 'on' ? true : choice === 'off' ? false : null;

/** The setting that applies to the sale: its own choice, else the client's default. */
export function effectiveSaleSetting(saleValue: boolean | null | undefined, clientValue: boolean | null | undefined): boolean {
  return saleValue ?? clientValue ?? false;
}

export type AutomaticReceiptState = 'queued' | 'processing' | 'retry' | 'issued' | 'review' | 'cancelled';

/** Plain-language state of an automatic receipt job, from public.invoices.processing_status. */
export function automaticReceiptState(processingStatus: string | null | undefined): AutomaticReceiptState {
  switch (processingStatus) {
    case 'pending': return 'queued';
    case 'processing': return 'processing';
    case 'retry': return 'retry';
    case 'issued': return 'issued';
    case 'cancelled':
    case 'void':
    case 'failed': return 'cancelled';
    default: return 'review';
  }
}

export type FirstMonthState = 'waiting_start' | 'waiting_payment' | 'queued' | 'processing' | 'issued' | 'review';

/**
 * Where the first month of a recurring sale (the sale itself) stands: its own FT or FR,
 * or why it has not been issued yet.
 */
export function firstMonthState(input: {
  lastError: string | null | undefined;
  policy: 'invoice_then_receipt' | 'invoice_receipt_when_paid';
  anchorDate: string;
  today: string;
  documents: ReadonlyArray<{ document_type: string | null; processing_status: string | null }>;
}): FirstMonthState {
  const primary = input.documents.find((document) =>
    (document.document_type === 'invoice' || document.document_type === 'invoice_receipt')
    && document.processing_status !== 'void'
    && document.processing_status !== 'cancelled');
  if (primary?.processing_status === 'issued') return 'issued';
  if (input.lastError) return 'review';
  if (primary) {
    return primary.processing_status === 'processing' || primary.processing_status === 'pending'
      ? 'processing'
      : 'review';
  }
  if (input.anchorDate > input.today) return 'waiting_start';
  return input.policy === 'invoice_receipt_when_paid' ? 'waiting_payment' : 'queued';
}
