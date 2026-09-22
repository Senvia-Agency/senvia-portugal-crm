import type { ServicosDetails } from './proposals';

export type NegotiationType = 'angariacao' | 'angariacao_indexado' | 'renovacao' | 'sem_volume';
export type SaleStatus = 'in_progress' | 'fulfilled' | 'delivered' | 'cancelled';
export type PaymentMethod = 'mbway' | 'transfer' | 'cash' | 'card' | 'check' | 'other';
export type PaymentStatus = 'pending' | 'partial' | 'paid';
export type ProposalType = 'energia' | 'servicos';
export type ModeloServico = 'transacional' | 'saas';

export type ServiceStatus = 'pending' | 'active' | 'paused' | 'inactive' | 'cancelled';
export type BillingStatus = 'not_started' | 'current' | 'past_due' | 'uncollectible';
export type BillingProvider = 'manual' | 'stripe';
export type CycleStatus = 'pending' | 'paid' | 'failed' | 'void';

export const SERVICE_STATUS_LABELS: Record<ServiceStatus, string> = {
  pending: 'Pendente',
  active: 'Ativo',
  paused: 'Pausado',
  inactive: 'Inativo',
  cancelled: 'Cancelado',
};

export const SERVICE_STATUS_COLORS: Record<ServiceStatus, string> = {
  pending: 'bg-blue-500/20 text-blue-500 border-blue-500/30',
  active: 'bg-green-500/20 text-green-500 border-green-500/30',
  paused: 'bg-amber-500/20 text-amber-500 border-amber-500/30',
  inactive: 'bg-slate-500/20 text-slate-500 border-slate-500/30',
  cancelled: 'bg-red-500/20 text-red-500 border-red-500/30',
};

export const BILLING_STATUS_LABELS: Record<BillingStatus, string> = {
  not_started: 'Por iniciar',
  current: 'Em dia',
  past_due: 'Em atraso',
  uncollectible: 'Incobrável',
};

export const BILLING_STATUS_COLORS: Record<BillingStatus, string> = {
  not_started: 'bg-blue-500/20 text-blue-500 border-blue-500/30',
  current: 'bg-green-500/20 text-green-500 border-green-500/30',
  past_due: 'bg-amber-500/20 text-amber-500 border-amber-500/30',
  uncollectible: 'bg-red-500/20 text-red-500 border-red-500/30',
};

export const BILLING_PROVIDER_LABELS: Record<BillingProvider, string> = {
  manual: 'Manual',
  stripe: 'Stripe',
};

export const SALE_STATUS_LABELS: Record<SaleStatus, string> = {
  in_progress: 'Em Progresso',
  fulfilled: 'Entregue',
  delivered: 'Concluída',
  cancelled: 'Cancelado',
};

export const SALE_STATUS_COLORS: Record<SaleStatus, string> = {
  in_progress: 'bg-blue-500/20 text-blue-500 border-blue-500/30',
  fulfilled: 'bg-purple-500/20 text-purple-500 border-purple-500/30',
  delivered: 'bg-green-500/20 text-green-500 border-green-500/30',
  cancelled: 'bg-red-500/20 text-red-500 border-red-500/30',
};

export const SALE_STATUSES: SaleStatus[] = ['in_progress', 'fulfilled', 'delivered', 'cancelled'];

/**
 * The sale lifecycle in a telecom org — there, this REPLACES SaleStatus in
 * the UI: the user picks one state, not two. The two cancellations differ by
 * money: 'anulado' happens before the install and costs nothing; 'cancelado'
 * happens after it and claws the commission back — see sale_chargebacks.
 */
export type TelecomStatus = 'pendente' | 'em_instalacao' | 'ativo' | 'instalado' | 'anulado' | 'cancelado';

export const TELECOM_STATUS_LABELS: Record<TelecomStatus, string> = {
  pendente: 'Pendente',
  em_instalacao: 'Em instalação',
  ativo: 'Ativo',
  instalado: 'Instalado',
  anulado: 'Anulado',
  cancelado: 'Cancelado',
};

/** Shown under the label where the distinction matters for money. */
export const TELECOM_STATUS_HINTS: Partial<Record<TelecomStatus, string>> = {
  ativo: 'Operacional',
  instalado: 'Fechada',
  anulado: 'Antes da instalação — não gera CB',
  cancelado: 'Após a instalação — gera CB',
};

export const TELECOM_STATUS_COLORS: Record<TelecomStatus, string> = {
  pendente: 'bg-amber-500/20 text-amber-500 border-amber-500/30',
  em_instalacao: 'bg-blue-500/20 text-blue-500 border-blue-500/30',
  ativo: 'bg-green-500/20 text-green-500 border-green-500/30',
  instalado: 'bg-emerald-600/20 text-emerald-600 border-emerald-600/30',
  anulado: 'bg-slate-500/20 text-slate-500 border-slate-500/30',
  cancelado: 'bg-red-500/20 text-red-500 border-red-500/30',
};

export const TELECOM_STATUSES: TelecomStatus[] = ['pendente', 'em_instalacao', 'ativo', 'instalado', 'anulado', 'cancelado'];

/**
 * The generic status each telecom state maps to. In a telecom org the user
 * only ever picks the telecom state; `sales.status` is written behind it from
 * this map, because invoicing, commission closing, the finance screens and
 * every existing filter still read that column.
 */
export const TELECOM_TO_SALE_STATUS: Record<TelecomStatus, SaleStatus> = {
  pendente: 'in_progress',
  em_instalacao: 'in_progress',
  // An active line is operational, but it is not the terminal state. Only
  // "instalado" closes the sale.
  ativo: 'fulfilled',
  instalado: 'delivered',
  anulado: 'cancelled',
  cancelado: 'cancelled',
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  mbway: 'MB Way',
  transfer: 'Transferência',
  cash: 'Dinheiro',
  card: 'Cartão',
  check: 'Cheque',
  other: 'Outro',
};

export const PAYMENT_METHODS: PaymentMethod[] = ['mbway', 'transfer', 'cash', 'card', 'check', 'other'];

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  pending: 'Pendente',
  partial: 'Parcial',
  paid: 'Pago',
};

export const PAYMENT_STATUS_COLORS: Record<PaymentStatus, string> = {
  pending: 'bg-amber-500/20 text-amber-500 border-amber-500/30',
  partial: 'bg-blue-500/20 text-blue-500 border-blue-500/30',
  paid: 'bg-green-500/20 text-green-500 border-green-500/30',
};

// Payment record types (for sale_payments table)
export type PaymentRecordStatus = 'pending' | 'paid';

export interface SalePayment {
  id: string;
  organization_id: string;
  sale_id: string;
  amount: number;
  payment_date: string;
  payment_method: PaymentMethod | null;
  invoice_reference: string | null;
  invoice_file_url: string | null;
  invoicexpress_id?: number | null;
  qr_code_url?: string | null;
  status: PaymentRecordStatus;
  notes: string | null;
  /** Subscription cycle this payment covers (Stripe bills in advance, so this is
   *  frequently a different calendar month than payment_date). Null for
   *  non-Stripe / manual payments. */
  billing_period_start?: string | null;
  billing_period_end?: string | null;
  created_at: string;
  updated_at: string;
}

export const PAYMENT_RECORD_STATUS_LABELS: Record<PaymentRecordStatus, string> = {
  pending: 'Agendado',
  paid: 'Pago',
};

export const PAYMENT_RECORD_STATUS_COLORS: Record<PaymentRecordStatus, string> = {
  pending: 'bg-amber-500/20 text-amber-500 border-amber-500/30',
  paid: 'bg-green-500/20 text-green-500 border-green-500/30',
};

export const PAYMENT_STATUSES: PaymentStatus[] = ['pending', 'partial', 'paid'];

export type RecurringStatus = 'active' | 'cancelled' | 'paused' | 'pending';

export const RECURRING_STATUS_LABELS: Record<RecurringStatus, string> = {
  active: 'Ativo',
  cancelled: 'Cancelado',
  paused: 'Pausado',
  pending: 'Pendente',
};

export const RECURRING_STATUS_COLORS: Record<RecurringStatus, string> = {
  active: 'bg-green-500/20 text-green-500 border-green-500/30',
  cancelled: 'bg-red-500/20 text-red-500 border-red-500/30',
  paused: 'bg-amber-500/20 text-amber-500 border-amber-500/30',
  pending: 'bg-blue-500/20 text-blue-500 border-blue-500/30',
};

export interface Sale {
  id: string;
  organization_id: string;
  code: string;
  proposal_id: string | null;
  lead_id: string | null;
  client_id: string | null;
  status: SaleStatus;
  total_value: number;
  operational_units?: number | null;
  subtotal: number;
  discount: number;
  payment_method: PaymentMethod | null;
  payment_status: PaymentStatus;
  due_date: string | null;
  paid_date: string | null;
  invoice_reference: string | null;
  sale_date: string;
  notes: string | null;
  created_by: string | null;
  // Who made the sale and is paid for it. NULL falls back to created_by, so an
  // admin can enter a sale on behalf of a salesperson without taking the money.
  seller_id: string | null;
  created_at: string;
  updated_at: string;
  
  // Campos do tipo de proposta
  proposal_type: ProposalType | null;
  
  // Campos Energia
  consumo_anual: number | null;
  margem: number | null;
  dbl: number | null;
  anos_contrato: number | null;
  
  // Campos Serviços
  modelo_servico: ModeloServico | null;
  kwp: number | null;
  
  // Comum
  // What the operator pays in gross for this sale.
  comissao: number | null;
  // What is left for the organization once the seller took his own rate.
  // Frozen alongside the commission splits.
  org_commission: number | null;

  // Tipo de Negociação e Serviços/Produtos
  negotiation_type: NegotiationType | null;
  servicos_produtos: string[] | null;
  // Per-product snapshot taken when the sale was made: price, quantity, extra
  // cards and the operator at that moment. Frozen on purpose — a product can be
  // moved to another operator later without rewriting past sales.
  servicos_details: ServicosDetails | null;
  
  // Campos de Recorrência
  has_recurring: boolean;
  recurring_value: number;
  recurring_status: RecurringStatus | null;
  next_renewal_date: string | null;
  last_renewal_date: string | null;

  recurrence?: SaleRecurrenceSummary | null;
  recurring_product_ids?: readonly string[];
  recurring_products?: readonly SaleProductReference[];
  billing_summary?: SaleBillingSummary | null;

  // Data de Ativação
  activation_date?: string | null;

  // Telecom-only lifecycle, independent of `status` (see TelecomStatus).
  telecom_status?: TelecomStatus | null;
  // When the install is booked for. Optional — sales without one are counted
  // as "sem data" instead of falling into a month.
  scheduled_install_date?: string | null;
  // End of the booked install window ("das 9h às 12h") — the date above is
  // its start. Null when only a start time was agreed.
  scheduled_install_end?: string | null;
  // End of the contract loyalty period (telecom). The renewal alerts —
  // push and email to the org's admins — run off this date.
  fidelizacao_end?: string | null;
  // Units (cards/lines) on this sale, summed from servicos_details by trigger.
  total_cartoes?: number | null;
  // Whether the required paperwork for THIS sale has been handed in — per
  // sale, not per client, since the same client can sign several contracts
  // over time, each needing its own paperwork.
  documents_checked?: boolean;
  contract_signed?: boolean;

  // Numero Proposta EDP
  edp_proposal_number?: string | null;

  // InvoiceXpress
  invoicexpress_id: number | null;
  invoicexpress_type: string | null;
  qr_code_url?: string | null;
  invoice_pdf_url?: string | null;
  credit_note_id?: number | null;
  credit_note_reference?: string | null;
}

export interface SaleProductReference {
  readonly id: string;
  readonly name: string;
}

export interface SaleRecurrenceSummary {
  readonly id: string;
  readonly amount: number;
  readonly service_status: ServiceStatus;
  readonly billing_status: BillingStatus;
  readonly billing_provider: BillingProvider;
  readonly next_cycle_date: string | null;
  readonly last_cycle_date: string | null;
  readonly current_cycle: SaleCycleSummary | null;
}

export interface SaleCycleSummary {
  readonly id: string;
  readonly period_start: string;
  readonly period_end: string;
  readonly due_date: string;
  readonly amount: number;
  readonly status: CycleStatus;
}

export interface SaleBillingSummary {
  readonly status: BillingStatus;
  readonly provider: BillingProvider;
  readonly current_cycle_status: CycleStatus | null;
  readonly outstanding_amount: number;
  readonly paid_amount: number;
}

export interface ActivePaidTrafficSaleRecord {
  readonly sale_id: string;
  readonly organization_id: string;
  readonly recurrence_id: string;
  readonly amount: number;
  readonly service_status: ServiceStatus;
  readonly billing_status: BillingStatus;
  readonly billing_provider: BillingProvider;
  readonly product_ids: readonly string[];
}

export interface SaleWithDetails extends Sale {
  lead?: {
    name: string;
    email: string;
    phone: string;
    assigned_to?: string | null;
  } | null;
  proposal?: {
    id: string;
    code?: string;
    proposal_date: string;
  } | null;
  client?: {
    id: string;
    name: string;
    code?: string;
    email?: string | null;
    phone?: string | null;
    company?: string | null;
    nif?: string | null;
    address_line1?: string | null;
    address_line2?: string | null;
    city?: string | null;
    postal_code?: string | null;
    country?: string | null;
  } | null;
}

export interface SaleItem {
  id: string;
  sale_id: string;
  product_id: string | null;
  name: string;
  quantity: number;
  unit_price: number;
  total: number;
  first_due_date: string | null;
  created_at: string;
}

export interface SaleItemWithProduct extends SaleItem {
  product?: {
    name: string;
    price: number | null;
    is_recurring?: boolean;
  } | null;
}
