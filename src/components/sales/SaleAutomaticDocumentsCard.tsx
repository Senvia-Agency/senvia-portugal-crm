import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, FileText, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useUpdateSale } from "@/hooks/useSales";
import { choiceFromValue, effectiveSaleSetting, valueFromChoice, type SaleFiscalChoice } from "@/lib/fiscal-automation";
import { cn } from "@/lib/utils";
import type { Sale } from "@/types/sales";

const EMAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

type SaleFiscalFields = "fiscal_auto_invoices" | "fiscal_auto_receipts" | "fiscal_auto_email" | "fiscal_email_recipient";

/**
 * This sale's automatic documents: its Fatura (decided when the sale is created, from the
 * client's default), a receipt per payment marked as paid and the email, which follow the
 * client unless the sale chooses otherwise.
 */
export function SaleAutomaticDocumentsCard({ sale, disabled = false }: {
  sale: Pick<Sale, "id" | "client_id" | "invoice_reference" | "fiscal_invoice_last_error" | SaleFiscalFields>;
  disabled?: boolean;
}) {
  const queryClient = useQueryClient();
  const updateSale = useUpdateSale();
  const client = useQuery({
    queryKey: ["client-fiscal-defaults", sale.client_id],
    enabled: !!sale.client_id,
    queryFn: async () => {
      const { data, error } = await supabase.from("crm_clients")
        .select("email, fiscal_auto_receipts, fiscal_auto_email").eq("id", sale.client_id!).single();
      if (error) throw error;
      return data;
    },
  });
  const retryInvoice = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase.rpc as unknown as (
        name: string,
        args: Record<string, unknown>,
      ) => Promise<{ error: { message?: string } | null }>)("retry_automatic_sale_invoice", { p_sale_id: sale.id });
      if (error) throw new Error(error.message || "Não foi possível repetir a emissão");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sales"] });
      toast.success("Nova tentativa na próxima passagem (até 5 minutos)");
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const [recipient, setRecipient] = useState(sale.fiscal_email_recipient ?? "");
  useEffect(() => { setRecipient(sale.fiscal_email_recipient ?? ""); }, [sale.fiscal_email_recipient]);

  if (client.error) return null;
  const clientReceipts = client.data?.fiscal_auto_receipts === true;
  const clientEmail = client.data?.fiscal_auto_email === true;
  const invoice = sale.fiscal_auto_invoices === true;
  const receipts = effectiveSaleSetting(sale.fiscal_auto_receipts, clientReceipts);
  const email = (invoice || receipts) && effectiveSaleSetting(sale.fiscal_auto_email, clientEmail);
  const to = sale.fiscal_email_recipient || client.data?.email || null;
  const busy = disabled || updateSale.isPending;
  const save = (updates: Partial<Pick<Sale, SaleFiscalFields>>) => updateSale.mutate({ saleId: sale.id, updates });
  const onOff = (value: boolean) => (value ? "ligado" : "desligado");
  const documents = [invoice && !sale.invoice_reference ? "a Fatura" : null, receipts ? "um Recibo por pagamento" : null]
    .filter(Boolean).join(" e ");

  return (
    <Card>
      <CardHeader className="pb-2 p-4">
        <CardTitle className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
          <FileText className="h-4 w-4" />
          Documentos automáticos
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 pt-0 space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Fatura</Label>
            {sale.invoice_reference ? (
              <p className="flex h-10 items-center text-sm">{sale.invoice_reference} emitida</p>
            ) : (
              <Select value={invoice ? "on" : "off"} disabled={busy}
                onValueChange={(choice) => save({ fiscal_auto_invoices: choice === "on" })}>
                <SelectTrigger aria-label="Emitir a Fatura automaticamente"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="on">Emitir automaticamente</SelectItem>
                  <SelectItem value="off">Emitir à mão</SelectItem>
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Recibo ao marcar como pago</Label>
            <Select value={choiceFromValue(sale.fiscal_auto_receipts)} disabled={busy}
              onValueChange={(choice) => save({ fiscal_auto_receipts: valueFromChoice(choice as SaleFiscalChoice) })}>
              <SelectTrigger aria-label="Emitir recibo ao marcar como pago"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="follow">Como no cliente ({onOff(clientReceipts)})</SelectItem>
                <SelectItem value="on">Ligado nesta venda</SelectItem>
                <SelectItem value="off">Desligado nesta venda</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Enviar por email</Label>
            <Select value={choiceFromValue(sale.fiscal_auto_email)} disabled={busy || !(invoice || receipts)}
              onValueChange={(choice) => save({ fiscal_auto_email: valueFromChoice(choice as SaleFiscalChoice) })}>
              <SelectTrigger aria-label="Enviar os documentos por email"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="follow">Como no cliente ({onOff(clientEmail)})</SelectItem>
                <SelectItem value="on">Enviar nesta venda</SelectItem>
                <SelectItem value="off">Não enviar nesta venda</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        {sale.fiscal_invoice_last_error && !sale.invoice_reference && (
          <div className="flex flex-wrap items-start gap-2 rounded-md bg-destructive/5 px-2.5 py-2 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 flex-1 break-words">Fatura automática parada: {sale.fiscal_invoice_last_error}</span>
            <Button type="button" variant="outline" size="sm" className="h-7 gap-1.5 text-xs"
              onClick={() => retryInvoice.mutate()} disabled={retryInvoice.isPending || disabled}>
              <RotateCcw className={cn("h-3.5 w-3.5", retryInvoice.isPending && "animate-spin")} />
              Tentar novamente
            </Button>
          </div>
        )}
        {email && (
          <div className="space-y-1.5">
            <Label htmlFor={`sale-documents-recipient-${sale.id}`} className="text-xs">Enviar para</Label>
            <Input id={`sale-documents-recipient-${sale.id}`} type="email" value={recipient} disabled={busy}
              placeholder={client.data?.email || "Email do cliente"}
              onChange={(event) => setRecipient(event.target.value)}
              onBlur={() => {
                const next = recipient.trim().toLowerCase();
                if (next === (sale.fiscal_email_recipient ?? "")) return;
                if (next && !EMAIL.test(next)) { setRecipient(sale.fiscal_email_recipient ?? ""); return; }
                save({ fiscal_email_recipient: next || null });
              }} />
            <p className="text-[11px] text-muted-foreground">Vazio = email do cliente.</p>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          {documents
            ? `Automático: ${documents}${email ? `, enviados para ${to ?? "o email do cliente"}` : ""}.`
            : "Os documentos desta venda emitem-se à mão."}
        </p>
      </CardContent>
    </Card>
  );
}
