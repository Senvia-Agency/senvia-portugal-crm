function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function textAt(value: unknown, path: readonly string[]): string | null {
  let current = value;
  for (const key of path) {
    if (!isRecord(current)) return null;
    current = current[key];
  }
  return typeof current === 'string' && current.trim() ? current.trim() : null;
}

export function invoiceClientName(invoice: unknown): string | null {
  return textAt(invoice, ['client_name'])
    ?? textAt(invoice, ['fiscal_snapshot', 'client', 'name'])
    ?? textAt(invoice, ['raw_data', 'snapshot', 'client', 'name']);
}

interface RelatedInvoice {
  readonly id: string;
  readonly reference: string | null;
  readonly related_invoice_id: string | null;
  readonly credit_note_reference?: string | null;
}

export function invoiceRelatedReferences(invoices: readonly RelatedInvoice[]): ReadonlyMap<string, string> {
  const byId = new Map(invoices.map(invoice => [invoice.id, invoice]));
  const references = new Map<string, Set<string>>();
  const add = (id: string, reference: string | null | undefined) => {
    if (!reference) return;
    const values = references.get(id) ?? new Set<string>();
    values.add(reference);
    references.set(id, values);
  };
  for (const invoice of invoices) {
    add(invoice.id, invoice.credit_note_reference);
    if (!invoice.related_invoice_id) continue;
    const original = byId.get(invoice.related_invoice_id);
    if (!original) continue;
    add(invoice.id, original.reference);
    add(original.id, invoice.reference);
  }
  return new Map([...references].map(([id, values]) => [id, [...values].join(', ')]));
}
