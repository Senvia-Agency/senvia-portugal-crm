/**
 * Consolidated invoice operations.
 *
 * All invoice-related mutations (issue, cancel, email, sync) live here.
 * The individual hook files (useIssueInvoice, useCancelInvoice, etc.)
 * re-export from this module for backwards-compatible imports.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { toast as sonnerToast } from "sonner";

async function fiscalFunctionError(error: { message?: string; context?: unknown }, fallback: string): Promise<Error> {
  const payload = error.context instanceof Response
    ? await error.context.json().catch(() => null)
    : null;
  return new Error(typeof payload?.error === 'string' ? payload.error : error.message || fallback);
}

// ─── Issue Invoice ──────────────────────────────────────────────

export interface IssueInvoiceParams {
  saleId: string;
  organizationId: string;
  observations?: string;
}

export function useIssueInvoice() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ saleId, organizationId, observations }: IssueInvoiceParams) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Sessão expirada");

      const res = await supabase.functions.invoke("issue-invoice", {
        body: { sale_id: saleId, organization_id: organizationId, observations: observations || undefined },
      });

      if (res.error) throw await fiscalFunctionError(res.error, "Erro ao emitir fatura");
      if (res.data?.error) throw new Error(res.data.error);
      return res.data;
    },
    onSuccess: (data) => {
      sonnerToast.success(`Fatura emitida: ${data.invoice_reference}`);
      queryClient.invalidateQueries({ queryKey: ["sales"] });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
    },
    onError: (error: Error) => {
      sonnerToast.error(error.message || "Erro ao emitir fatura");
    },
  });
}

// ─── Issue Invoice Receipt ──────────────────────────────────────

export interface IssueInvoiceReceiptParams {
  saleId: string;
  organizationId: string;
  observations?: string;
}

export function useIssueInvoiceReceipt() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ saleId, organizationId, observations }: IssueInvoiceReceiptParams) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Sessão expirada");

      const res = await supabase.functions.invoke("issue-invoice-receipt", {
        body: { sale_id: saleId, organization_id: organizationId, observations: observations || undefined },
      });

      if (res.error) throw await fiscalFunctionError(res.error, "Erro ao emitir fatura-recibo");
      if (res.data?.error) throw new Error(res.data.error);
      return res.data;
    },
    onSuccess: (data) => {
      sonnerToast.success(`Fatura-Recibo emitida: ${data.invoice_reference}`);
      queryClient.invalidateQueries({ queryKey: ["sales"] });
      queryClient.invalidateQueries({ queryKey: ["sale-payments"] });
    },
    onError: (error: Error) => {
      sonnerToast.error(error.message || "Erro ao emitir fatura-recibo");
    },
  });
}

// ─── Cancel Invoice ─────────────────────────────────────────────

export interface CancelInvoiceParams {
  paymentId?: string;
  saleId?: string;
  organizationId: string;
  reason: string;
  invoicexpressId: number;
  documentType: "invoice" | "invoice_receipt" | "receipt" | "credit_note";
}

export function useCancelInvoice() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ paymentId, saleId, organizationId, reason, invoicexpressId, documentType }: CancelInvoiceParams) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Não autenticado");

      const response = await supabase.functions.invoke("cancel-invoice", {
        body: {
          payment_id: paymentId || null,
          sale_id: saleId || null,
          organization_id: organizationId,
          reason,
          invoicexpress_id: invoicexpressId,
          document_type: documentType,
        },
      });

      if (response.error) throw response.error;
      if (response.data?.error) throw new Error(response.data.error);
      return response.data;
    },
    onSuccess: () => {
      sonnerToast.success("Documento anulado com sucesso");
      queryClient.invalidateQueries({ queryKey: ["sale-payments"] });
      queryClient.invalidateQueries({ queryKey: ["sales"] });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
    },
    onError: (error: Error) => {
      sonnerToast.error(`Erro ao anular: ${error.message}`);
    },
  });
}

// ─── Send Invoice Email ─────────────────────────────────────────

export interface SendInvoiceEmailParams {
  documentId: number;
  invoiceId?: string | null;
  documentType: "invoice" | "invoice_receipt" | "receipt" | "credit_note";
  organizationId: string;
  email: string;
}

export function useSendInvoiceEmail() {
  return useMutation({
    mutationFn: async (params: SendInvoiceEmailParams) => {
      const { data, error } = await supabase.functions.invoke("send-invoice-email", {
        body: {
          invoice_id: params.invoiceId || undefined,
          document_id: params.documentId,
          document_type: params.documentType,
          organization_id: params.organizationId,
          email: params.email,
        },
      });

      if (error) throw await fiscalFunctionError(error, "Erro ao enviar documento fiscal");
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      sonnerToast.success("Documento enviado por email através da Brevo");
    },
    onError: (error: Error) => {
      sonnerToast.error("Erro ao enviar email", { description: error.message });
    },
  });
}

// ─── Sync InvoiceXpress Items ───────────────────────────────────

export function useSyncInvoiceXpressItems() {
  const queryClient = useQueryClient();
  const { organization } = useAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Não autenticado');

      const response = await supabase.functions.invoke('sync-invoicexpress-items', {
        body: { organization_id: organization!.id },
      });

      if (response.error) throw new Error(response.error.message);
      return response.data as { created: number; updated: number; total: number };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      toast({
        title: 'Sincronização concluída',
        description: `${data.created} criados, ${data.updated} atualizados (${data.total} itens no InvoiceXpress)`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Erro na sincronização',
        description: error.message || 'Não foi possível sincronizar com o InvoiceXpress.',
        variant: 'destructive',
      });
    },
  });
}
