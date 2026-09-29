import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface InvoiceDetailsParams {
  documentId?: number | null;
  invoiceId?: string | null;
  documentType: "invoice" | "invoice_receipt" | "receipt" | "credit_note";
  organizationId: string;
}

interface SyncInvoiceParams extends InvoiceDetailsParams {
  documentId: number;
  saleId: string;
  paymentId?: string;
}

export interface InvoiceOwner {
  name: string;
  fiscal_id: string;
  address: string | null;
  postal_code: string | null;
  city: string | null;
  country: string | null;
  email: string | null;
  phone: string | null;
}

export interface InvoiceClient {
  id: number;
  name: string;
  fiscal_id: string;
  country: string;
  address: string | null;
  postal_code: string | null;
  city: string | null;
  email: string | null;
  phone: string | null;
}

export interface InvoiceTaxSummary {
  name: string;
  rate: number;
  incidence: number;
  value: number;
}

export interface InvoiceDetailsData {
  id: number;
  status: string;
  sequence_number: string;
  atcud: string;
  date: string;
  due_date: string;
  permalink: string;
  sum: number;
  discount: number;
  before_taxes: number;
  taxes: number;
  total: number;
  retention: number;
  currency: string;
  tax_exemption: string | null;
  observations: string | null;
  mb_reference: string | null;
  cancel_reason: string | null;
  qr_code_url: string | null;
  owner: InvoiceOwner | null;
  client: InvoiceClient | null;
  items: Array<{
    name: string;
    description: string;
    unit_price: string;
    quantity: string;
    tax: { id: number; name: string; value: number };
    discount: number;
    subtotal: number;
    tax_amount: number;
    total: number;
  }>;
  tax_summary: InvoiceTaxSummary[];
  pdf_url?: string | null;
  pdf_signed_url?: string | null;
  source?: string | null;
  bank_info?: any;
}

export function useInvoiceDetails(
  { documentId, invoiceId, documentType, organizationId }: InvoiceDetailsParams,
  enabled = true,
  initialDetails?: Partial<InvoiceDetailsData>,
) {
  return useQuery({
    queryKey: ["invoice-details", organizationId, invoiceId || documentId, documentType],
    queryFn: async () => {
      const res = await supabase.functions.invoke("get-invoice-details", {
        body: {
          ...(invoiceId ? { invoice_id: invoiceId } : { document_id: documentId }),
          document_type: documentType,
          organization_id: organizationId,
          include_pdf: false,
        },
      });

      if (res.error) throw new Error(res.error.message || "Erro ao obter detalhes");
      if (res.data?.error) throw new Error(res.data.error);
      return res.data as InvoiceDetailsData;
    },
    enabled: enabled && !!(invoiceId || documentId) && !!organizationId,
    placeholderData: initialDetails ? {
      id: initialDetails.id ?? Number(documentId ?? 0),
      status: initialDetails.status ?? 'final',
      sequence_number: initialDetails.sequence_number ?? '',
      atcud: initialDetails.atcud ?? '',
      date: initialDetails.date ?? '',
      due_date: initialDetails.due_date ?? '',
      permalink: initialDetails.permalink ?? '',
      sum: initialDetails.sum ?? initialDetails.total ?? 0,
      discount: initialDetails.discount ?? 0,
      before_taxes: initialDetails.before_taxes ?? initialDetails.total ?? 0,
      taxes: initialDetails.taxes ?? 0,
      total: initialDetails.total ?? 0,
      retention: initialDetails.retention ?? 0,
      currency: initialDetails.currency ?? 'EUR',
      tax_exemption: initialDetails.tax_exemption ?? null,
      observations: initialDetails.observations ?? null,
      mb_reference: initialDetails.mb_reference ?? null,
      cancel_reason: initialDetails.cancel_reason ?? null,
      qr_code_url: initialDetails.qr_code_url ?? null,
      owner: initialDetails.owner ?? null,
      client: initialDetails.client ?? null,
      items: initialDetails.items ?? [],
      tax_summary: initialDetails.tax_summary ?? [],
      pdf_url: initialDetails.pdf_url ?? null,
      pdf_signed_url: initialDetails.pdf_signed_url ?? null,
      source: initialDetails.source ?? null,
      bank_info: initialDetails.bank_info,
    } : undefined,
    staleTime: 60_000,
    gcTime: 10 * 60_000,
  });
}

export function useSyncInvoice() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ documentId, documentType, organizationId, saleId, paymentId }: SyncInvoiceParams) => {
      const res = await supabase.functions.invoke("get-invoice-details", {
        body: {
          document_id: documentId,
          document_type: documentType,
          organization_id: organizationId,
          sync: true,
          include_pdf: true,
          sale_id: saleId,
          payment_id: paymentId,
        },
      });

      if (res.error) throw new Error(res.error.message || "Erro ao sincronizar");
      if (res.data?.error) throw new Error(res.data.error);
      return res.data as InvoiceDetailsData;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["invoice-details", variables.organizationId] });
      queryClient.invalidateQueries({ queryKey: ["sale-payments", variables.saleId] });
      queryClient.invalidateQueries({ queryKey: ["sales"] });
      toast.success("Dados sincronizados com sucesso");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Erro ao sincronizar documento");
    },
  });
}
