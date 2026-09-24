import { useMemo, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, FileText, ChevronRight } from "lucide-react";
import { matchesSearch } from "@/lib/utils";
import { formatCurrency } from "@/lib/format";
import { useAuth } from "@/contexts/AuthContext";
import { useSales } from "@/hooks/useSales";
import { useSaleItems } from "@/hooks/useSaleItems";
import { useSalePayments } from "@/hooks/useSalePayments";
import { useIssueInvoice } from "@/hooks/useIssueInvoice";
import { useIssueInvoiceReceipt } from "@/hooks/useIssueInvoiceReceipt";
import { getOrgTaxValue } from "@/components/sales/SaleFiscalInfo";
import { InvoiceDraftModal } from "@/components/sales/InvoiceDraftModal";
import { SALE_STATUS_LABELS } from "@/types/sales";
import type { SaleWithDetails } from "@/types/sales";
import { isSalePaidInFull } from "@/lib/fiscal-eligibility";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Once a sale is chosen, fetch its items/payments and reuse the same invoice
// draft preview + issue flow as the sale details screen.
function EmitInvoiceForSale({ sale, onClose }: { sale: SaleWithDetails; onClose: (emitted: boolean) => void }) {
  const { organization } = useAuth();
  const { data: items = [] } = useSaleItems(sale.id);
  const { data: payments = [] } = useSalePayments(sale.id);
  const issueInvoice = useIssueInvoice();
  const issueInvoiceReceipt = useIssueInvoiceReceipt();

  const paymentObligation = sale.gross_value ?? sale.total_value;
  const paidInFull = isSalePaidInFull(paymentObligation, payments);
  const mode = paidInFull ? "invoice_receipt" : "invoice";
  const orgTaxValue = getOrgTaxValue(organization);

  return (
    <InvoiceDraftModal
      open
      onOpenChange={(o) => { if (!o) onClose(false); }}
      mode={mode}
      isLoading={issueInvoice.isPending || issueInvoiceReceipt.isPending}
      onConfirm={(obs) => {
        const args = { saleId: sale.id, organizationId: organization?.id || "", observations: obs };
        const m = mode === "invoice_receipt" ? issueInvoiceReceipt : issueInvoice;
        m.mutate(args, { onSuccess: () => onClose(true) });
      }}
      clientName={sale.client?.name || sale.lead?.name || ""}
      clientNif={sale.client?.nif || ""}
      amount={paymentObligation}
      paymentDate={sale.sale_date}
      saleTotal={paymentObligation}
      saleItems={items.map((it: any) => ({
        name: it.name,
        quantity: Number(it.quantity),
        unit_price: Number(it.unit_price),
        tax_value: it.tax_value ?? it.product?.tax_value ?? null,
      }))}
      payments={payments}
      taxConfig={{
        tax_value: orgTaxValue,
        tax_exemption_reason: (organization as any)?.tax_exemption_reason,
      }}
    />
  );
}

export function SaleInvoicePicker({ open, onOpenChange }: Props) {
  const { data: sales = [] } = useSales();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<SaleWithDetails | null>(null);

  const eligible = useMemo(
    () => sales.filter((s) =>
      !s.invoicexpress_id && !s.credit_note_id && s.client?.nif &&
      (s.status === "delivered" || s.status === "fulfilled") &&
      matchesSearch(search, s.client?.name, s.code, s.lead?.name)),
    [sales, search],
  );

  if (selected) {
    return (
      <EmitInvoiceForSale
        sale={selected}
        onClose={(emitted) => {
          setSelected(null);
          if (emitted) onOpenChange(false);
        }}
      />
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nova Fatura</DialogTitle>
          <DialogDescription>Escolhe a venda para emitir a fatura.</DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Pesquisar por cliente ou código..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <div className="max-h-[50dvh] space-y-2 overflow-y-auto">
          {eligible.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Sem vendas elegíveis (precisam de cliente com NIF, estar entregues e ainda sem fatura).
            </p>
          ) : (
            eligible.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSelected(s)}
                className="flex w-full items-center justify-between gap-3 rounded-md border p-3 text-left transition-colors hover:bg-muted/50"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="truncate font-medium">{s.client?.name || s.lead?.name || "—"}</span>
                    <Badge variant="outline" className="shrink-0 text-[10px]">{s.code}</Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {SALE_STATUS_LABELS[s.status]} · {formatCurrency(s.gross_value ?? s.total_value)}
                  </p>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
