import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";

export interface ClientAutomaticReceipts {
  receipts: boolean;
  email: boolean;
}

/**
 * The client's default for all their sales: a KeyInvoice receipt is issued as soon as a
 * payment is marked as paid, and optionally emailed. A sale can still choose otherwise.
 */
export function ClientAutomaticReceiptsCard({ value, onChange, idPrefix }: {
  value: ClientAutomaticReceipts;
  onChange: (value: ClientAutomaticReceipts) => void;
  idPrefix: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Recibos automáticos</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <label htmlFor={`${idPrefix}-auto-receipts`} className="flex cursor-pointer items-start justify-between gap-4">
          <span>
            <span className="block text-sm font-medium">Emitir recibo ao marcar como pago</span>
            <span className="block text-xs text-muted-foreground">
              Vale para todas as vendas deste cliente com Fatura KeyInvoice emitida. Só conta para pagamentos marcados a partir de agora.
            </span>
          </span>
          <Switch
            id={`${idPrefix}-auto-receipts`}
            checked={value.receipts}
            onCheckedChange={(receipts) => onChange({ receipts, email: receipts ? value.email : false })}
          />
        </label>
        <label htmlFor={`${idPrefix}-auto-email`} className={`flex items-start justify-between gap-4 ${value.receipts ? "cursor-pointer" : "opacity-50"}`}>
          <span>
            <span className="block text-sm font-medium">Enviar o recibo por email</span>
            <span className="block text-xs text-muted-foreground">Para o email deste cliente, com o template "Recibo" de Marketing → Templates.</span>
          </span>
          <Switch
            id={`${idPrefix}-auto-email`}
            checked={value.email}
            disabled={!value.receipts}
            onCheckedChange={(email) => onChange({ ...value, email })}
          />
        </label>
      </CardContent>
    </Card>
  );
}
