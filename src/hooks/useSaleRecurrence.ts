import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  normalizeRecurringFiscalConfig,
  recurringFiscalConfigError,
  type RecurringFiscalConfig,
} from '@/types/recurring-fiscal';

export type ServiceStatus = 'pending' | 'active' | 'paused' | 'inactive' | 'cancelled';
export type BillingStatus = 'not_started' | 'current' | 'past_due' | 'uncollectible';
export type CycleStatus = 'pending' | 'paid' | 'failed' | 'void';
export type FiscalCycleStatus =
  | 'not_scheduled'
  | 'pending'
  | 'processing'
  | 'partial'
  | 'completed'
  | 'retry'
  | 'failed'
  | 'manual_review';
export type FiscalEmailStatus =
  | 'not_requested'
  | 'pending'
  | 'processing'
  | 'partial'
  | 'sent'
  | 'delivered'
  | 'bounced'
  | 'blocked'
  | 'retry'
  | 'failed'
  | 'suppressed';

export interface RecurrenceFiscalDocument {
  id: string;
  processing_status: string | null;
  reference: string | null;
  document_type: string | null;
  pdf_path: string | null;
  provider_document_type_code: string | null;
  provider_series: string | null;
  provider_document_number: string | null;
  provider_atcud: string | null;
  email_status: FiscalEmailStatus | null;
  email_last_error: string | null;
}

export interface RecurrenceCycle {
  id: string;
  period_start: string;
  period_end: string;
  due_date: string;
  amount: number;
  status: CycleStatus;
  stripe_invoice_id: string | null;
  paid_at: string | null;
  failure_reason: string | null;
  fiscal_status: FiscalCycleStatus;
  fiscal_email_status: FiscalEmailStatus;
  fiscal_last_error: string | null;
  fiscal_attempts: number;
  fiscal_next_retry_at: string | null;
  fiscal_primary_invoice_id: string | null;
  fiscal_document: RecurrenceFiscalDocument | null;
  fiscal_documents: RecurrenceFiscalDocument[];
}

export interface SaleRecurrenceDetail extends RecurringFiscalConfig {
  id: string;
  sale_id: string;
  organization_id: string;
  amount: number;
  anchor_date: string;
  service_status: ServiceStatus;
  billing_status: BillingStatus;
  billing_provider: 'manual' | 'stripe';
  next_cycle_date: string | null;
  last_cycle_date: string | null;
  stripe_subscription_id: string | null;
  stripe_checkout_session_id: string | null;
  client_email: string | null;
  fiscal_auto_start_after: string | null;
  /** The sale itself (its first month) is issued automatically like the cycles. */
  fiscal_include_sale: boolean;
  fiscal_sale_last_error: string | null;
  /** The sale's own documents: its FT or FR and the receipts of its payments. */
  sale_documents: RecurrenceFiscalDocument[];
  cycles: RecurrenceCycle[];
}

type UnknownRow = Record<string, unknown>;

const RECURRENCE_BASE_FIELDS =
  'id, sale_id, organization_id, amount, anchor_date, service_status, billing_status, billing_provider, next_cycle_date, last_cycle_date, stripe_subscription_id, stripe_checkout_session_id';
const RECURRENCE_FISCAL_FIELDS =
  `${RECURRENCE_BASE_FIELDS}, fiscal_mode, fiscal_document_policy, fiscal_auto_email, fiscal_email_config, fiscal_auto_start_after`;
const RECURRENCE_FIRST_MONTH_FIELDS =
  `${RECURRENCE_FISCAL_FIELDS}, fiscal_include_sale, fiscal_sale_last_error`;
const FISCAL_DOCUMENT_FIELDS =
  'id, recurring_cycle_id, processing_status, reference, document_type, pdf_path, provider_document_type_code, provider_series, provider_document_number, provider_atcud, email_status, email_last_error';
const CYCLE_BASE_FIELDS =
  'id, period_start, period_end, due_date, amount, status, stripe_invoice_id, paid_at, failure_reason';
const CYCLE_FISCAL_FIELDS =
  `${CYCLE_BASE_FIELDS}, fiscal_status, fiscal_email_status, fiscal_last_error, fiscal_attempts, fiscal_next_retry_at, fiscal_primary_invoice_id`;

function isMissingFiscalSchema(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return ['42703', 'PGRST200', 'PGRST204'].includes(error.code ?? '')
    || /fiscal_(mode|status|email|document|primary)/i.test(error.message ?? '');
}

function cycleFiscalStatus(value: unknown): FiscalCycleStatus {
  switch (value) {
    case 'pending':
    case 'processing':
    case 'partial':
    case 'completed':
    case 'retry':
    case 'failed':
    case 'manual_review':
      return value;
    default:
      return 'not_scheduled';
  }
}

function cycleEmailStatus(value: unknown): FiscalEmailStatus {
  switch (value) {
    case 'pending':
    case 'processing':
    case 'partial':
    case 'sent':
    case 'delivered':
    case 'bounced':
    case 'blocked':
    case 'retry':
    case 'failed':
    case 'suppressed':
      return value;
    default:
      return 'not_requested';
  }
}

function toFiscalDocument(row: UnknownRow): RecurrenceFiscalDocument | null {
  if (typeof row.id !== 'string') return null;
  const text = (value: unknown) => (typeof value === 'string' ? value : null);
  return {
    id: row.id,
    processing_status: text(row.processing_status),
    reference: text(row.reference),
    document_type: text(row.document_type),
    pdf_path: text(row.pdf_path),
    provider_document_type_code: text(row.provider_document_type_code),
    provider_series: text(row.provider_series),
    provider_document_number: text(row.provider_document_number),
    provider_atcud: text(row.provider_atcud),
    email_status: typeof row.email_status === 'string' ? cycleEmailStatus(row.email_status) : null,
    email_last_error: text(row.email_last_error),
  };
}

// The fiscal ledger columns are newer than the generated types.
const fiscalInvoices = () => supabase.from('invoices') as unknown as {
  select: (columns: string) => {
    in: (column: string, values: unknown[]) => Promise<{ data: UnknownRow[] | null; error: { message?: string } | null }>;
    eq: (column: string, value: unknown) => {
      is: (column: string, value: null) => {
        order: (column: string) => Promise<{ data: UnknownRow[] | null; error: { message?: string } | null }>;
      };
    };
  };
};

/** Detalhe da recorrência de uma venda, com o histórico de ciclos. */
export function useSaleRecurrence(saleId: string | null | undefined) {
  return useQuery({
    queryKey: ['sale-recurrence', saleId],
    queryFn: async (): Promise<SaleRecurrenceDetail | null> => {
      if (!saleId) return null;

      const fetchRecurrence = async (fields: string) => {
        const result = await supabase
          .from('sale_recurrences')
          .select(fields)
          .eq('sale_id', saleId)
          // Uma venda pode ter recorrências encerradas no histórico; a que
          // interessa é a mais recente.
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        return {
          data: result.data as unknown as UnknownRow | null,
          error: result.error as { code?: string; message?: string } | null,
        };
      };

      // Newest columns first; an older database falls back field set by field set.
      let recurrenceResult = await fetchRecurrence(RECURRENCE_FIRST_MONTH_FIELDS);
      if (recurrenceResult.error && isMissingFiscalSchema(recurrenceResult.error)) {
        recurrenceResult = await fetchRecurrence(RECURRENCE_FISCAL_FIELDS);
      }
      if (recurrenceResult.error && isMissingFiscalSchema(recurrenceResult.error)) {
        recurrenceResult = await fetchRecurrence(RECURRENCE_BASE_FIELDS);
      }
      if (recurrenceResult.error) throw recurrenceResult.error;
      const recurrence = recurrenceResult.data;
      if (!recurrence) return null;

      const fetchCycles = async (fields: string) => {
        const result = await supabase
          .from('sale_recurring_cycles')
          .select(fields)
          .eq('recurrence_id', String(recurrence.id))
          .order('period_start', { ascending: false });
        return {
          data: result.data as unknown as UnknownRow[] | null,
          error: result.error as { code?: string; message?: string } | null,
        };
      };

      let cyclesResult = await fetchCycles(CYCLE_FISCAL_FIELDS);
      if (cyclesResult.error && isMissingFiscalSchema(cyclesResult.error)) {
        cyclesResult = await fetchCycles(CYCLE_BASE_FIELDS);
      }
      if (cyclesResult.error) throw cyclesResult.error;

      const rawCycles = cyclesResult.data ?? [];
      const invoicesById = new Map<string, RecurrenceFiscalDocument>();
      const invoicesByCycleId = new Map<string, RecurrenceFiscalDocument[]>();
      const supportsFiscalLedger = Object.prototype.hasOwnProperty.call(
        recurrence as unknown as object,
        'fiscal_mode',
      );

      if (supportsFiscalLedger && rawCycles.length > 0) {
        const { data: invoices, error: invoicesError } = await fiscalInvoices()
          .select(FISCAL_DOCUMENT_FIELDS)
          .in('recurring_cycle_id', rawCycles.map((cycle) => cycle.id));
        if (invoicesError) {
          // A salesperson may be allowed to view the sale but not fiscal
          // documents. Keep the recurrence usable; the issuing RPC still
          // enforces the stricter finance permission on every mutation.
          console.warn('Recurring fiscal documents are not available:', invoicesError.message);
        }

        for (const rawInvoice of (invoices ?? []) as unknown as UnknownRow[]) {
          const document = toFiscalDocument(rawInvoice);
          if (!document) continue;
          invoicesById.set(document.id, document);
          if (typeof rawInvoice.recurring_cycle_id === 'string') {
            const cycleDocuments = invoicesByCycleId.get(rawInvoice.recurring_cycle_id) ?? [];
            cycleDocuments.push(document);
            invoicesByCycleId.set(rawInvoice.recurring_cycle_id, cycleDocuments);
          }
        }
      }

      const includesSale = recurrence.fiscal_include_sale === true;
      let saleDocuments: RecurrenceFiscalDocument[] = [];
      if (includesSale) {
        const { data: documents, error: documentsError } = await fiscalInvoices()
          .select(FISCAL_DOCUMENT_FIELDS)
          .eq('sale_id', saleId)
          .is('recurring_cycle_id', null)
          .order('created_at');
        if (documentsError) {
          console.warn('Sale fiscal documents are not available:', documentsError.message);
        }
        saleDocuments = ((documents ?? []) as UnknownRow[])
          .map(toFiscalDocument)
          .filter((document): document is RecurrenceFiscalDocument => document !== null);
      }

      const { data: sale } = await supabase
        .from('sales')
        .select('client:crm_clients(email)')
        .eq('id', saleId)
        .maybeSingle();

      const fiscalConfig = normalizeRecurringFiscalConfig(recurrence);
      const normalizedCycles = rawCycles.map((cycle): RecurrenceCycle => {
        const primaryInvoiceId = typeof cycle.fiscal_primary_invoice_id === 'string'
          ? cycle.fiscal_primary_invoice_id
          : null;
        return {
          ...(cycle as unknown as Omit<RecurrenceCycle, 'fiscal_status' | 'fiscal_email_status' | 'fiscal_last_error' | 'fiscal_attempts' | 'fiscal_next_retry_at' | 'fiscal_primary_invoice_id' | 'fiscal_document' | 'fiscal_documents'>),
          fiscal_status: cycleFiscalStatus(cycle.fiscal_status),
          fiscal_email_status: cycleEmailStatus(cycle.fiscal_email_status),
          fiscal_last_error: typeof cycle.fiscal_last_error === 'string' ? cycle.fiscal_last_error : null,
          fiscal_attempts: typeof cycle.fiscal_attempts === 'number' ? cycle.fiscal_attempts : 0,
          fiscal_next_retry_at:
            typeof cycle.fiscal_next_retry_at === 'string' ? cycle.fiscal_next_retry_at : null,
          fiscal_primary_invoice_id: primaryInvoiceId,
          fiscal_document: primaryInvoiceId ? invoicesById.get(primaryInvoiceId) ?? null : null,
          fiscal_documents: typeof cycle.id === 'string' ? invoicesByCycleId.get(cycle.id) ?? [] : [],
        };
      });

      return {
        ...(recurrence as unknown as Omit<SaleRecurrenceDetail, 'cycles'>),
        ...fiscalConfig,
        client_email: (sale?.client as { email?: string | null } | null)?.email ?? null,
        fiscal_include_sale: includesSale,
        fiscal_sale_last_error: typeof recurrence.fiscal_sale_last_error === 'string'
          ? recurrence.fiscal_sale_last_error
          : null,
        sale_documents: saleDocuments,
        cycles: normalizedCycles,
      };
    },
    enabled: !!saleId,
  });
}

export async function configureSaleRecurrenceFiscal(
  recurrenceId: string,
  config: RecurringFiscalConfig,
) {
  const validationError = recurringFiscalConfigError(config);
  if (validationError) throw new Error(validationError);
  const { data, error } = await (supabase.rpc as unknown as (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message?: string; code?: string } | null }>)(
    'configure_sale_recurrence_fiscal',
    {
      p_recurrence_id: recurrenceId,
      p_fiscal_mode: config.fiscal_mode,
      p_document_policy: config.fiscal_document_policy,
      p_auto_email: config.fiscal_auto_email,
      p_email_config: config.fiscal_email_config,
    },
  );
  if (error) {
    const message = error.message || 'Não foi possível guardar a configuração fiscal';
    if (message.includes('Configure the KeyInvoice')) {
      const kind = /KeyInvoice (invoice_receipt|invoice|receipt|credit_note) series/.exec(message)?.[1];
      const label = {
        invoice_receipt: 'Fatura-recibo (FR)',
        invoice: 'Fatura (FT)',
        receipt: 'Recibo (RC)',
        credit_note: 'Nota de crédito (NC)',
      }[kind ?? ''] ?? 'documento fiscal';
      throw new Error(`Configura a série de ${label} em Definições → Financeiro → Fiscal antes de ativar a emissão automática.`);
    }
    if (message.includes('KeyInvoice must be the active fiscal provider')) {
      throw new Error('O KeyInvoice tem de ser o fornecedor fiscal ativo.');
    }
    throw new Error(message);
  }
  return data;
}

export async function ensureSaleRecurrenceFromLegacy(saleId: string): Promise<string> {
  const { data, error } = await (supabase.rpc as unknown as (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message?: string } | null }>)(
    'ensure_sale_recurrence_from_legacy',
    { p_sale_id: saleId },
  );
  if (error) throw new Error(error.message || 'Não foi possível preparar a recorrência');
  const row = Array.isArray(data) ? data[0] : data;
  const id = row && typeof row === 'object' && typeof (row as { id?: unknown }).id === 'string'
    ? (row as { id: string }).id
    : null;
  if (!id) throw new Error('A recorrência ainda não está disponível');
  return id;
}

/**
 * While the sale is being created with automatic issuance, its first month (the sale
 * itself) is issued like the cycles. Returns false when the sale no longer qualifies.
 */
export async function includeSaleInRecurringFiscal(recurrenceId: string): Promise<boolean> {
  const { data, error } = await (supabase.rpc as unknown as (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message?: string } | null }>)(
    'include_sale_in_recurring_fiscal',
    { p_recurrence_id: recurrenceId },
  );
  if (error) throw new Error(error.message || 'Não foi possível incluir o 1.º mês na emissão automática');
  return data === true;
}

export function useRetryRecurringSaleDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (recurrenceId: string) => {
      const { error } = await (supabase.rpc as unknown as (
        name: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: unknown; error: { message?: string } | null }>)(
        'retry_recurring_sale_document',
        { p_recurrence_id: recurrenceId },
      );
      if (error) throw new Error(error.message || 'Não foi possível repetir a emissão');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sale-recurrence'] });
      toast.success('Nova tentativa na próxima passagem (até 5 minutos)');
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useConfigureSaleRecurrenceFiscal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ recurrenceId, config }: { recurrenceId: string; config: RecurringFiscalConfig }) =>
      configureSaleRecurrenceFiscal(recurrenceId, config),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sale-recurrence'] });
      queryClient.invalidateQueries({ queryKey: ['recurring-sales'] });
      toast.success('Faturação recorrente atualizada');
    },
    onError: (error: Error) => {
      toast.error(
        error.message.includes('configure_sale_recurrence_fiscal')
          ? 'O motor fiscal ainda não está disponível nesta base de dados'
          : error.message,
      );
    },
  });
}

export function useRetryRecurringFiscalCycle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (cycleId: string) => {
      const { error } = await (supabase.rpc as unknown as (
        name: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: unknown; error: { message?: string } | null }>)(
        'retry_recurring_fiscal_cycle',
        { p_cycle_id: cycleId },
      );
      if (error) throw new Error(error.message || 'Não foi possível repetir o processamento');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sale-recurrence'] });
      toast.success('Nova tentativa agendada');
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

interface CheckoutResponse {
  checkoutUrl?: string;
  expiresAt?: string | null;
  error?: string;
}

/**
 * Gera (ou regenera) o link de Checkout da recorrência.
 *
 * Regenerar não cria outra recorrência — substitui apenas a sessão guardada.
 */
export function useSaleCheckout() {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (recurrenceId: string): Promise<string> => {
      const { data, error } = await supabase.functions.invoke<CheckoutResponse>(
        'stripe-sale-checkout',
        { body: { recurrenceId } },
      );
      if (error) throw new Error(data?.error ?? error.message);
      if (data?.error) throw new Error(data.error);
      if (!data?.checkoutUrl) throw new Error('O Stripe não devolveu um link de pagamento');
      return data.checkoutUrl;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sale-recurrence'] });
      queryClient.invalidateQueries({ queryKey: ['sales'] });
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Não foi possível gerar o link de pagamento');
    },
  });

  return {
    createCheckout: mutation.mutateAsync,
    isCreating: mutation.isPending,
  };
}

export function useCancelSaleRecurrence() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (recurrenceId: string) => {
      const { error } = await supabase.rpc('transition_sale_recurrence', {
        p_recurrence_id: recurrenceId,
        p_action: 'cancel',
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sale-recurrence'] });
      queryClient.invalidateQueries({ queryKey: ['recurring-sales'] });
      queryClient.invalidateQueries({ queryKey: ['sales'] });
      toast.success('Serviço recorrente cancelado');
    },
    onError: (error: Error) => toast.error(error.message || 'Não foi possível cancelar a recorrência'),
  });
}

export function useReactivateSaleRecurrence() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ saleId, nextCycleDate }: { saleId: string; nextCycleDate: string }) => {
      const { error } = await supabase.rpc('reactivate_sale_recurrence', {
        p_sale_id: saleId,
        p_next_cycle_date: nextCycleDate,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sale-recurrence'] });
      queryClient.invalidateQueries({ queryKey: ['recurring-sales'] });
      queryClient.invalidateQueries({ queryKey: ['sales'] });
      toast.success('Serviço recorrente reativado');
    },
    onError: (error: Error) => toast.error(error.message || 'Não foi possível reativar a recorrência'),
  });
}
