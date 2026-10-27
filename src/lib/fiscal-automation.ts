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
