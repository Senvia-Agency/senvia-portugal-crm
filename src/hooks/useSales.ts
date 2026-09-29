import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useTeamFilter } from "@/hooks/useTeamFilter";
import { toast } from "sonner";
import { invalidateSaleFinance } from '@/lib/sale-finance-cache';
import {
  TELECOM_TO_SALE_STATUS,
} from "@/types/sales";
import type {
  BillingProvider,
  BillingStatus,
  CycleStatus,
  ActivePaidTrafficSaleRecord,
  SaleBillingSummary,
  SaleCycleSummary,
  SaleProductReference,
  SaleRecurrenceSummary,
  SaleStatus,
  SaleWithDetails,
  PaymentMethod,
  PaymentStatus,
  ProposalType,
  ModeloServico,
  NegotiationType,
  ServiceStatus,
  TelecomStatus,
} from "@/types/sales";
import type { Tables } from "@/integrations/supabase/types";

export function useSales() {
  const { organization } = useAuth();
  const { effectiveUserIds } = useTeamFilter();

  return useQuery({
    queryKey: ["sales", organization?.id, effectiveUserIds],
    queryFn: async (): Promise<SaleWithDetails[]> => {
      if (!organization?.id) return [];

      const { data, error } = await supabase
        .from("sales")
        .select(`
          *,
          lead:leads(name, email, phone, assigned_to),
          proposal:proposals(id, code, proposal_date),
          client:crm_clients(id, name, code, email, phone, company, nif, company_nif, billing_target, address_line1, address_line2, city, postal_code, country, company_address_same_as_client, company_address_line1, company_address_line2, company_city, company_postal_code, company_country)
        `)
        .eq("organization_id", organization.id)
        .order("created_at", { ascending: false });

      if (error) throw error;

      const result = (data as unknown as SaleWithDetails[]) || [];
      const saleIds = result.map((sale) => sale.id);
      const recurrenceResponse = await supabase
        .from("sale_recurrences")
        .select("*")
        .eq("organization_id", organization.id);
      if (recurrenceResponse.error) throw recurrenceResponse.error;

      const recurrenceRows = recurrenceResponse.data ?? [];
      const recurrenceIds = recurrenceRows.map((recurrence) => recurrence.id);
      const cycleResponse = recurrenceIds.length
        ? await supabase
            .from("sale_recurring_cycles")
            .select("*")
            .eq("organization_id", organization.id)
            .in("recurrence_id", recurrenceIds)
        : { data: [], error: null };
      if (cycleResponse.error) throw cycleResponse.error;

      const itemResponse = saleIds.length
        ? await supabase
            .from("sale_items")
            .select("sale_id, product_id")
            .in("sale_id", saleIds)
        : { data: [], error: null };
      if (itemResponse.error) throw itemResponse.error;

      const productIds = Array.from(
        new Set((itemResponse.data ?? []).map((item) => item.product_id).filter((id): id is string => id !== null)),
      );
      const productResponse = productIds.length
        ? await supabase
            .from("products")
            .select("id, name, is_recurring")
            .eq("organization_id", organization.id)
            .in("id", productIds)
        : { data: [], error: null };
      if (productResponse.error) throw productResponse.error;

      const recurrencesBySaleId = new Map(recurrenceRows.map((recurrence) => [recurrence.sale_id, recurrence]));
      const cyclesByRecurrenceId = new Map<string, Tables<"sale_recurring_cycles">["Row"][]>();
      for (const cycle of cycleResponse.data ?? []) {
        const cycles = cyclesByRecurrenceId.get(cycle.recurrence_id) ?? [];
        cycles.push(cycle);
        cyclesByRecurrenceId.set(cycle.recurrence_id, cycles);
      }
      const productsById = new Map(
        (productResponse.data ?? []).map((product) => [product.id, product]),
      );
      const recurringProductsBySaleId = new Map<string, SaleProductReference[]>();
      for (const item of itemResponse.data ?? []) {
        if (!item.product_id || productsById.get(item.product_id)?.is_recurring !== true) continue;
        const product = productsById.get(item.product_id);
        if (!product) continue;
        const products = recurringProductsBySaleId.get(item.sale_id) ?? [];
        if (!products.some((entry) => entry.id === product.id)) {
          products.push({ id: product.id, name: product.name });
        }
        recurringProductsBySaleId.set(item.sale_id, products);
      }

      const enrichedResult = result.map((sale) => {
        const recurrence = recurrencesBySaleId.get(sale.id);
        const recurringProducts = recurringProductsBySaleId.get(sale.id) ?? [];
        const cycles = recurrence ? cyclesByRecurrenceId.get(recurrence.id) ?? [] : [];
        const recurrenceSummary = recurrence ? toRecurrenceSummary(recurrence, cycles) : null;
        return {
          ...sale,
          recurrence: recurrenceSummary,
          recurring_product_ids: recurringProducts.map((product) => product.id),
          recurring_products: recurringProducts,
          billing_summary: recurrenceSummary ? toBillingSummary(recurrenceSummary, cycles) : null,
        };
      });
      
      // Filter by user IDs (admin/leader/single user)
      if (effectiveUserIds) {
        return enrichedResult.filter(sale => {
          // A reassigned sale belongs to the seller, not to whoever typed it.
          const owner = sale.seller_id || sale.created_by;
          return (owner && effectiveUserIds.includes(owner)) ||
            (sale.lead?.assigned_to && effectiveUserIds.includes(sale.lead.assigned_to));
        });
      }
      
      return enrichedResult;
    },
    enabled: !!organization?.id,
  });
}

export async function fetchActivePaidTrafficSales(
  organizationId: string,
  productId: string,
): Promise<ActivePaidTrafficSaleRecord[]> {
  const recurrenceResponse = await supabase
    .from("sale_recurrences")
    .select("id, sale_id, organization_id, amount, service_status, billing_status, billing_provider")
    .eq("organization_id", organizationId)
    .eq("service_status", "active");
  if (recurrenceResponse.error) throw recurrenceResponse.error;

  const recurrences = recurrenceResponse.data ?? [];
  const saleIds = recurrences.map((recurrence) => recurrence.sale_id);
  if (saleIds.length === 0) return [];

  const itemResponse = await supabase
    .from("sale_items")
    .select("sale_id, product_id")
    .in("sale_id", saleIds)
    .eq("product_id", productId);
  if (itemResponse.error) throw itemResponse.error;

  const matchingSaleIds = new Set((itemResponse.data ?? []).map((item) => item.sale_id));
  return recurrences
    .filter((recurrence) => matchingSaleIds.has(recurrence.sale_id))
    .map((recurrence) => ({
      sale_id: recurrence.sale_id,
      organization_id: recurrence.organization_id,
      recurrence_id: recurrence.id,
      amount: recurrence.amount,
      service_status: parseServiceStatus(recurrence.service_status),
      billing_status: parseBillingStatus(recurrence.billing_status),
      billing_provider: parseBillingProvider(recurrence.billing_provider),
      product_ids: [productId],
    }));
}

const SERVICE_STATUS_VALUES = ["pending", "active", "paused", "inactive", "cancelled"] as const;
const BILLING_STATUS_VALUES = ["not_started", "current", "past_due", "uncollectible"] as const;
const BILLING_PROVIDER_VALUES = ["manual", "stripe"] as const;
const CYCLE_STATUS_VALUES = ["pending", "paid", "failed", "void"] as const;

function parseServiceStatus(value: string): ServiceStatus {
  return SERVICE_STATUS_VALUES.find((status) => status === value) ?? "pending";
}

function parseBillingStatus(value: string): BillingStatus {
  return BILLING_STATUS_VALUES.find((status) => status === value) ?? "not_started";
}

function parseBillingProvider(value: string): BillingProvider {
  return BILLING_PROVIDER_VALUES.find((provider) => provider === value) ?? "manual";
}

function parseCycleStatus(value: string): CycleStatus {
  return CYCLE_STATUS_VALUES.find((status) => status === value) ?? "pending";
}

function toRecurrenceSummary(
  recurrence: Tables<"sale_recurrences">["Row"],
  cycles: Tables<"sale_recurring_cycles">["Row"][],
): SaleRecurrenceSummary {
  const currentCycle = cycles.reduce<Tables<"sale_recurring_cycles">["Row"] | null>(
    (latest, cycle) => (!latest || cycle.period_start > latest.period_start ? cycle : latest),
    null,
  );

  return {
    id: recurrence.id,
    amount: recurrence.amount,
    service_status: parseServiceStatus(recurrence.service_status),
    billing_status: parseBillingStatus(recurrence.billing_status),
    billing_provider: parseBillingProvider(recurrence.billing_provider),
    next_cycle_date: recurrence.next_cycle_date,
    last_cycle_date: recurrence.last_cycle_date,
    current_cycle: currentCycle ? toCycleSummary(currentCycle) : null,
  };
}

function toCycleSummary(cycle: Tables<"sale_recurring_cycles">["Row"]): SaleCycleSummary {
  return {
    id: cycle.id,
    period_start: cycle.period_start,
    period_end: cycle.period_end,
    due_date: cycle.due_date,
    amount: cycle.amount,
    status: parseCycleStatus(cycle.status),
  };
}

function toBillingSummary(
  recurrence: SaleRecurrenceSummary,
  cycles: Tables<"sale_recurring_cycles">["Row"][],
): SaleBillingSummary {
  let outstandingAmount = 0;
  let paidAmount = 0;
  for (const cycle of cycles) {
    const amount = cycle.amount;
    const status = parseCycleStatus(cycle.status);
    if (status === "paid") paidAmount += amount;
    if (status === "pending" || status === "failed") outstandingAmount += amount;
  }

  return {
    status: recurrence.billing_status,
    provider: recurrence.billing_provider,
    current_cycle_status: recurrence.current_cycle?.status ?? null,
    outstanding_amount: outstandingAmount,
    paid_amount: paidAmount,
  };
}

export function useCreateSale() {
  const queryClient = useQueryClient();
  const { organization, user } = useAuth();

  return useMutation({
    mutationFn: async (data: {
      proposal_id?: string;
      lead_id?: string;
      client_id?: string;
      billing_target?: 'client' | 'company';
      status?: SaleStatus;
      total_value: number;
      gross_value?: number;
      subtotal?: number;
      discount?: number;
      payment_method?: PaymentMethod;
      payment_status?: PaymentStatus;
      due_date?: string;
      invoice_reference?: string;
      sale_date?: string;
      seller_id?: string | null;
      notes?: string;
      // Campos específicos de proposta
      proposal_type?: ProposalType;
      consumo_anual?: number;
      margem?: number;
      dbl?: number;
      anos_contrato?: number;
      fidelizacao_end?: string | null;
      modelo_servico?: ModeloServico;
      kwp?: number;
      comissao?: number;
      negotiation_type?: NegotiationType;
      servicos_produtos?: string[];
      servicos_details?: Record<string, any>;
      edp_proposal_number?: string;
      client_org_id?: string;
      // Campos de recorrência
      has_recurring?: boolean;
      recurring_value?: number;
      recurring_status?: 'active' | 'cancelled' | 'paused' | 'pending' | 'pending';
      next_renewal_date?: string;
      activation_date?: string;
      // Telecom-only lifecycle (see types/sales.ts). Were being silently
      // dropped here — the explicit insert() below never read them — so a
      // newly created telecom sale lost its estado/data de instalação until
      // someone opened EditSaleModal and re-saved (that one already spreads
      // `updates` straight into .update(), so it was never affected).
      telecom_status?: TelecomStatus;
      scheduled_install_date?: string;
      scheduled_install_end?: string;
      documents_checked?: boolean;
      contract_signed?: boolean;
    }) => {
      if (!organization?.id) throw new Error("Sem organização");

      const { data: sale, error } = await supabase
        .from("sales")
        .insert({
          organization_id: organization.id,
          proposal_id: data.proposal_id || null,
          lead_id: data.lead_id || null,
          client_id: data.client_id || null,
          billing_target: data.billing_target || null,
          total_value: data.total_value,
          gross_value: data.gross_value ?? null,
          subtotal: data.subtotal || data.total_value,
          discount: data.discount || 0,
          payment_method: data.payment_method || null,
          payment_status: data.payment_status || "pending",
          due_date: data.due_date || null,
          invoice_reference: data.invoice_reference || null,
          sale_date: data.sale_date || new Date().toISOString().split('T')[0],
          notes: data.notes || null,
          created_by: user?.id || null,
          // Who the commission is paid to. NULL means the creator, so a sale
          // entered by the salesperson himself needs nothing set.
          seller_id: data.seller_id ?? null,
          status: data.telecom_status
            ? TELECOM_TO_SALE_STATUS[data.telecom_status]
            : (data.status || "in_progress"),
          // Campos específicos de proposta
          proposal_type: data.proposal_type || null,
          consumo_anual: data.consumo_anual || null,
          margem: data.margem || null,
          dbl: data.dbl || null,
          anos_contrato: data.anos_contrato || null,
          fidelizacao_end: data.fidelizacao_end || null,
          modelo_servico: data.modelo_servico || null,
          kwp: data.kwp || null,
          comissao: data.comissao || null,
          negotiation_type: data.negotiation_type || null,
          servicos_produtos: data.servicos_produtos || null,
          servicos_details: data.servicos_details || null,
          edp_proposal_number: data.edp_proposal_number || null,
          client_org_id: (data as any).client_org_id || null,
          // Campos de recorrência
          has_recurring: data.has_recurring || false,
          recurring_value: data.recurring_value || 0,
          recurring_status: data.recurring_status || 'active',
          next_renewal_date: data.next_renewal_date || null,
          activation_date: data.activation_date || null,
          telecom_status: data.telecom_status || null,
          scheduled_install_date: data.scheduled_install_date || null,
          scheduled_install_end: data.scheduled_install_end || null,
          documents_checked: data.documents_checked ?? false,
          contract_signed: data.contract_signed ?? false,
        })
        .select()
        .single();

      if (error) throw error;

      // Se activation_date preenchida, criar registo no histórico
      if (data.activation_date && sale?.id) {
        await (supabase as any)
          .from('sale_activation_history')
          .insert({
            sale_id: sale.id,
            organization_id: organization.id,
            activation_date: data.activation_date,
            changed_by: user?.id || null,
            notes: `Definida na criação da venda (estado: ${data.status || 'pending'})`,
          });
      }

      return sale;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sales"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
      queryClient.invalidateQueries({ queryKey: ["recurring-sales"] });
      queryClient.invalidateQueries({ queryKey: ["commissions-live"] });
      toast.success("Venda criada com sucesso!");
      void invalidateSaleFinance(queryClient);
    },
    onError: () => {
      toast.error("Erro ao criar venda");
    },
  });
}

export function useUpdateSaleStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ saleId, status }: { saleId: string; status: SaleStatus }) => {
      const { error } = await supabase
        .from("sales")
        .update({ status })
        .eq("id", saleId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sales"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
      queryClient.invalidateQueries({ queryKey: ["commissions-live"] });
      toast.success("Estado atualizado!");
      void invalidateSaleFinance(queryClient);
    },
    onError: () => {
      toast.error("Erro ao atualizar estado");
    },
  });
}

export function useUpdateSale() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ 
      saleId, 
      updates 
    }: { 
      saleId: string; 
      updates: { 
        status?: SaleStatus; 
        notes?: string; 
        total_value?: number;
        gross_value?: number | null;
        payment_method?: PaymentMethod | null;
        payment_status?: PaymentStatus;
        due_date?: string | null;
        paid_date?: string | null;
        invoice_reference?: string | null;
        discount?: number;
        subtotal?: number;
        client_id?: string | null;
        billing_target?: 'client' | 'company' | null;
        sale_date?: string;
        seller_id?: string | null;
        proposal_type?: ProposalType | null;
        consumo_anual?: number | null;
        margem?: number | null;
        dbl?: number | null;
        anos_contrato?: number | null;
        modelo_servico?: ModeloServico | null;
        kwp?: number | null;
        comissao?: number | null;
        negotiation_type?: string | null;
        servicos_produtos?: string[] | null;
        servicos_details?: Record<string, any> | null;
        edp_proposal_number?: string | null;
        // Campos de recorrência
        has_recurring?: boolean;
        recurring_value?: number;
        next_renewal_date?: string | null;
        recurring_status?: 'active' | 'cancelled' |'pending' |  'paused' | null;
        // Data de ativação
        activation_date?: string | null;
        // Telecom-only lifecycle
        telecom_status?: TelecomStatus | null;
        scheduled_install_date?: string | null;
        scheduled_install_end?: string | null;
        documents_checked?: boolean | null;
        contract_signed?: boolean | null;
      }
    }) => {
      const normalizedUpdates = updates.telecom_status
        ? { ...updates, status: TELECOM_TO_SALE_STATUS[updates.telecom_status] }
        : updates;
      const { error } = await supabase
        .from("sales")
        .update(normalizedUpdates)
        .eq("id", saleId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sales"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
      queryClient.invalidateQueries({ queryKey: ["recurring-sales"] });
      queryClient.invalidateQueries({ queryKey: ["commissions-live"] });
      void invalidateSaleFinance(queryClient);
    },
    onError: () => {
      toast.error("Erro ao atualizar venda");
    },
  });
}

export function useDeleteSale() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (saleId: string) => {
      const { error } = await supabase.from("sales").delete().eq("id", saleId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sales"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
      queryClient.invalidateQueries({ queryKey: ["commissions-live"] });
      toast.success("Venda eliminada!");
      void invalidateSaleFinance(queryClient);
    },
    onError: () => {
      toast.error("Erro ao eliminar venda");
    },
  });
}
