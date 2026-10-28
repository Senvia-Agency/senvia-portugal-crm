import { Switch } from "@/components/ui/switch";

export interface ClientAutomaticDocumentsValue {
  invoices: boolean;
  receipts: boolean;
  email: boolean;
}

/**
 * The client's default for their sales, shown inside the "Faturação" card: the sale's
 * KeyInvoice Fatura issued on creation (a Fatura-Recibo when already paid), a receipt for
 * each payment marked as paid, and both emailed. A sale can still choose otherwise.
 */
export function ClientAutomaticDocuments({ value, onChange, idPrefix }: {
  value: ClientAutomaticDocumentsValue;
  onChange: (value: ClientAutomaticDocumentsValue) => void;
  idPrefix: string;
}) {
  const anyDocument = value.invoices || value.receipts;
  const rows: Array<{ key: keyof ClientAutomaticDocumentsValue; label: string; disabled?: boolean }> = [
    { key: "invoices", label: "Emitir Fatura ao criar a venda" },
    { key: "receipts", label: "Emitir Recibo ao marcar como pago" },
    { key: "email", label: "Enviar por email", disabled: !anyDocument },
  ];
  const set = (key: keyof ClientAutomaticDocumentsValue, checked: boolean) => {
    const next = { ...value, [key]: checked };
    onChange({ ...next, email: next.invoices || next.receipts ? next.email : false });
  };

  return (
    <div className="mt-4 space-y-2.5 border-t pt-4">
      <p className="text-sm font-medium">Documentos automáticos</p>
      {rows.map((row) => (
        <label
          key={row.key}
          htmlFor={`${idPrefix}-auto-${row.key}`}
          className={`flex items-center justify-between gap-3 text-sm ${row.disabled ? "opacity-50" : "cursor-pointer"}`}
        >
          {row.label}
          <Switch
            id={`${idPrefix}-auto-${row.key}`}
            checked={value[row.key]}
            disabled={row.disabled}
            onCheckedChange={(checked) => set(row.key, checked)}
          />
        </label>
      ))}
      <p className="text-xs text-muted-foreground">
        Só para vendas novas. Se a venda já estiver paga ao criar, sai Fatura-Recibo. Cada venda pode escolher outra opção.
      </p>
    </div>
  );
}
