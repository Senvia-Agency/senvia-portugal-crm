import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface CreateCreditNoteParams {
  organizationId: string;
  saleId?: string;
  paymentId?: string;
  originalDocumentId: number;
  invoiceId?: string;
  originalDocumentType: "invoice" | "invoice_receipt" | "receipt" | "credit_note";
  reason: string;
  items?: Array<{
    name: string;
    description?: string;
    unit_price: number;
    quantity: number;
    tax?: { name: string; value: number };
  }>;
}

export function useCreateCreditNote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: CreateCreditNoteParams) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Sessão expirada");

      const res = await supabase.functions.invoke("create-credit-note", {
        body: {
          organization_id: params.organizationId,
          sale_id: params.saleId || null,
          payment_id: params.paymentId || null,
          original_document_id: params.originalDocumentId,
          invoice_id: params.invoiceId || null,
          original_document_type: params.originalDocumentType,
          reason: params.reason,
          items: params.items || null,
        },
      });

      if (res.error) {
        const context = res.error.context;
        const payload = context instanceof Response ? await context.json().catch(() => null) : null;
        throw new Error(payload?.error || res.error.message || "Erro ao criar nota de crédito");
      }
      if (res.data?.error) throw new Error(res.data.error);
      return res.data;
    },
    onSuccess: (data) => {
      toast.success(`Nota de crédito emitida: ${data.credit_note_reference}`);
      queryClient.invalidateQueries({ queryKey: ["sales"] });
      queryClient.invalidateQueries({ queryKey: ["sale-payments"] });
      queryClient.invalidateQueries({ queryKey: ["all-payments"] });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["credit-notes"] });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Erro ao criar nota de crédito");
    },
  });
}
