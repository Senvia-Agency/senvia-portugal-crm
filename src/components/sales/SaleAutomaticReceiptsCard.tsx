import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Receipt } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useUpdateSale } from "@/hooks/useSales";
import { choiceFromValue, effectiveSaleSetting, valueFromChoice, type SaleFiscalChoice } from "@/lib/fiscal-automation";
import type { Sale } from "@/types/sales";

const EMAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

/**
 * This sale's automatic receipt: follows the client's default unless the sale chooses otherwise.
 * Changes apply to payments marked as paid from now on.
 */
export function SaleAutomaticReceiptsCard({ sale, disabled = false }: {
  sale: Pick<Sale, "id" | "client_id" | "fiscal_auto_receipts" | "fiscal_auto_email" | "fiscal_email_recipient" | "invoice_reference">;
  disabled?: boolean;
}) {
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
  const [recipient, setRecipient] = useState(sale.fiscal_email_recipient ?? "");
  useEffect(() => { setRecipient(sale.fiscal_email_recipient ?? ""); }, [sale.fiscal_email_recipient]);

  if (client.error) return null;
  const clientReceipts = client.data?.fiscal_auto_receipts === true;
  const clientEmail = client.data?.fiscal_auto_email === true;
  const receipts = effectiveSaleSetting(sale.fiscal_auto_receipts, clientReceipts);
  const email = receipts && effectiveSaleSetting(sale.fiscal_auto_email, clientEmail);
  const to = sale.fiscal_email_recipient || client.data?.email || null;
  const save = (updates: Partial<Pick<Sale, "fiscal_auto_receipts" | "fiscal_auto_email" | "fiscal_email_recipient">>) =>
    updateSale.mutate({ saleId: sale.id, updates });
  const onOff = (value: boolean) => (value ? "ligado" : "desligado");

  return (
    <Card>
      <CardHeader className="pb-2 p-4">
        <CardTitle className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
          <Receipt className="h-4 w-4" />
          Recibo automático
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 pt-0 space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Emitir ao marcar como pago</Label>
            <Select value={choiceFromValue(sale.fiscal_auto_receipts)} disabled={disabled || updateSale.isPending}
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
            <Select value={choiceFromValue(sale.fiscal_auto_email)} disabled={disabled || !receipts || updateSale.isPending}
              onValueChange={(choice) => save({ fiscal_auto_email: valueFromChoice(choice as SaleFiscalChoice) })}>
              <SelectTrigger aria-label="Enviar o recibo por email"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="follow">Como no cliente ({onOff(clientEmail)})</SelectItem>
                <SelectItem value="on">Enviar nesta venda</SelectItem>
                <SelectItem value="off">Não enviar nesta venda</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        {email && (
          <div className="space-y-1.5">
            <Label htmlFor={`sale-receipt-recipient-${sale.id}`} className="text-xs">Enviar para</Label>
            <Input id={`sale-receipt-recipient-${sale.id}`} type="email" value={recipient} disabled={disabled || updateSale.isPending}
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
          {receipts
            ? `Ao marcar um pagamento como pago, o recibo é emitido sobre a Fatura${sale.invoice_reference ? ` ${sale.invoice_reference}` : " da venda"}${email ? ` e enviado para ${to ?? "o email do cliente"}` : ""}.`
            : "Os recibos desta venda emitem-se à mão (Emitir Recibo)."}
        </p>
      </CardContent>
    </Card>
  );
}
