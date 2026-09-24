export type KeyInvoiceSeriesKind = 'invoice' | 'invoice_receipt' | 'receipt' | 'credit_note';

export interface KeyInvoiceSeriesEntry {
  series: string;
  provider_document_type_code: string;
}

export type KeyInvoiceSeriesConfig = Record<KeyInvoiceSeriesKind, KeyInvoiceSeriesEntry>;

export const EMPTY_KEYINVOICE_SERIES_CONFIG: KeyInvoiceSeriesConfig = {
  invoice: { series: '', provider_document_type_code: '' },
  invoice_receipt: { series: '', provider_document_type_code: '' },
  receipt: { series: '', provider_document_type_code: '' },
  credit_note: { series: '', provider_document_type_code: '' },
};

export function normalizeKeyInvoiceSeriesConfig(value: unknown): KeyInvoiceSeriesConfig {
  const config = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const readEntry = (kind: KeyInvoiceSeriesKind): KeyInvoiceSeriesEntry => {
    const raw = config[kind];
    const entry = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    return {
      series: typeof entry.series === 'string' ? entry.series : '',
      provider_document_type_code:
        typeof entry.provider_document_type_code === 'string'
          ? entry.provider_document_type_code
          : EMPTY_KEYINVOICE_SERIES_CONFIG[kind].provider_document_type_code,
    };
  };

  return {
    invoice: readEntry('invoice'),
    invoice_receipt: readEntry('invoice_receipt'),
    receipt: readEntry('receipt'),
    credit_note: readEntry('credit_note'),
  };
}
