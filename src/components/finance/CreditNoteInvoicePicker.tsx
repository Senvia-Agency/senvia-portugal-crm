import { useMemo, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, FileText, ChevronRight } from "lucide-react";
import { matchesSearch } from "@/lib/utils";
import { formatCurrency, formatDate } from "@/lib/format";
import { useAuth } from "@/contexts/AuthContext";
import { useInvoices, type InvoiceRow } from "@/hooks/useInvoices";
import { CreateCreditNoteModal } from "@/components/sales/CreateCreditNoteModal";
import { useLanguage } from "@/i18n";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreditNoteInvoicePicker({ open, onOpenChange }: Props) {
  const { organization } = useAuth();
  const { t } = useLanguage();
  const { data: invoices = [] } = useInvoices();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<InvoiceRow | null>(null);

  // Invoices/invoice-receipts that aren't cancelled and don't have a credit note yet.
  const eligible = useMemo(
    () => invoices.filter((inv) =>
      (inv.document_type === "invoice" || inv.document_type === "invoice_receipt") &&
      inv.status !== "canceled" &&
      !inv.credit_note_reference &&
      matchesSearch(search, inv.reference, inv.client_name)),
    [invoices, search],
  );

  if (selected && organization) {
    return (
      <CreateCreditNoteModal
        open
        onOpenChange={(o) => { if (!o) { setSelected(null); onOpenChange(false); } }}
        organizationId={organization.id}
        saleId={selected.sale_id || undefined}
        documentId={selected.invoicexpress_id}
        documentType={selected.document_type as "invoice" | "invoice_receipt" | "receipt" | "credit_note"}
        documentReference={selected.reference || `#${selected.invoicexpress_id}`}
      />
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("Nota de Crédito")}</DialogTitle>
          <DialogDescription>{t("Escolhe a fatura para emitir a nota de crédito.")}</DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t("Pesquisar por referência ou cliente...")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <div className="max-h-[50dvh] space-y-2 overflow-y-auto">
          {eligible.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {t("Sem faturas elegíveis (já têm nota de crédito ou estão anuladas).")}
            </p>
          ) : (
            eligible.map((inv) => (
              <button
                key={inv.id}
                type="button"
                onClick={() => setSelected(inv)}
                className="flex w-full items-center justify-between gap-3 rounded-md border p-3 text-left transition-colors hover:bg-muted/50"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="truncate font-medium">{inv.reference || `#${inv.invoicexpress_id}`}</span>
                    <Badge variant="outline" className="shrink-0 text-[10px]">
                      {inv.document_type === "invoice_receipt" ? "FR" : "FT"}
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {inv.client_name || "—"} · {inv.date ? formatDate(inv.date) : "—"} · {formatCurrency(inv.total)}
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
