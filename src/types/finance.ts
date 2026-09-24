import { PaymentMethod, PaymentRecordStatus, RecurringStatus } from './sales';

export interface PaymentWithSale {
  id: string;
  organization_id: string;
  sale_id: string;
  amount: number;
  payment_date: string;
  payment_method: PaymentMethod | null;
  invoice_reference: string | null;
  invoice_file_url: string | null;
  invoicexpress_id: number | null;
  credit_note_id: number | null;
  credit_note_reference: string | null;
  status: PaymentRecordStatus;
  reversal_status?: string | null;
  reversed_amount?: number | null;
  notes: string | null;
  /** Start of the subscription cycle this payment covers (Stripe invoices bill in advance,
   *  so this is frequently a different calendar month than payment_date). Null for
   *  non-Stripe / manual payments. */
  billing_period_start?: string | null;
  billing_period_end?: string | null;
  created_at: string;
  updated_at: string;
  sale: {
    id: string;
    code: string;
    total_value: number;
    gross_value?: number | null;
    invoice_reference: string | null;
    invoicexpress_id: number | null;
    invoicexpress_type: string | null;
    credit_note_id: number | null;
    credit_note_reference: string | null;
    invoice_pdf_url: string | null;
    client_org_id?: string | null;
    recurring_status?: RecurringStatus | null;
    next_renewal_date?: string | null;
    sale_date?: string | null;
    has_recurring?: boolean;
    recurring_value?: number;
  };
  client_name: string | null;
  lead_name: string | null;
  client_email?: string | null;
  client_nif?: string | null;
}

export interface CreditNoteItem {
  id: string;
  type: 'sale' | 'payment';
  credit_note_id: number;
  credit_note_reference: string;
  original_document_reference: string | null;
  date: string;
  sale_code: string;
  sale_id: string;
  client_name: string | null;
  amount: number;
  organization_id: string;
  pdf_url: string | null;
}

export interface CashflowPoint {
  date: string;
  received: number;
  scheduled: number;
  expenses: number;
  overdue: number;
}

export interface FinanceStats {
  totalBilled: number;
  /** Telecom only: operator gross on every non-cancelled sale sold in the period. */
  totalCommission: number;
  /** Telecom only: gross still waiting on an install (pendente + em instalação), by sale date. */
  telecomToInstall: number;
  telecomToInstallCount: number;
  /** Telecom only: gross already earned (ativo), by activation date. */
  telecomInstalled: number;
  telecomInstalledCount: number;
  totalReceived: number;
  totalPending: number;
  dueSoon: number;
  dueSoonCount: number;
  dueSoonPayments: PaymentWithSale[];
  cashflowTrend: CashflowPoint[];
  totalExpenses: number;
  balance: number;
  totalOverdue: number;
  overdueCount: number;
}
