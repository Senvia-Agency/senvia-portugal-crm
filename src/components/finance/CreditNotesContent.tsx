import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FileDown, FileText, RefreshCw, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { useCreditNotes, useSyncCreditNotes } from "@/hooks/useCreditNotes";
import { formatCurrency, formatDate } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { toast } from "sonner";
import { openPdfInNewTab } from "@/lib/download";
import { tr, useLanguage } from "@/i18n";

const getStatusLabel = (status: string | null) => {
  const map: Record<string, string> = {
    settled: 'Liquidada',
    final: 'Finalizada',
    draft: 'Rascunho',
    canceled: 'Anulada',
    sent: 'Enviada',
    second_copy: 'Segunda Via',
  };
  const label = map[status || ''];
  return label ? tr(label) : status || '-';
};

const getStatusVariant = (status: string | null): "default" | "secondary" | "destructive" | "outline" => {
  switch (status) {
    case 'settled': return 'default';
    case 'canceled': return 'destructive';
    case 'draft': return 'secondary';
    default: return 'outline';
  }
};

export function CreditNotesContent() {
  const { data: creditNotes, isLoading } = useCreditNotes();
  const { t } = useLanguage();
  const { data: orgData } = useOrganization();
  const isInvoicexpressEnabled = (orgData?.integrations_enabled as any)?.invoicexpress === true;
  const [viewingId, setViewingId] = useState<string | null>(null);
  const syncCreditNotes = useSyncCreditNotes();
  const hasSynced = useRef(false);

  // Auto-sync on mount (only if InvoiceXpress is enabled)
  useEffect(() => {
    if (!hasSynced.current && isInvoicexpressEnabled && !syncCreditNotes.isPending) {
      hasSynced.current = true;
      syncCreditNotes.mutate(undefined, { onError: () => {} });
    }
  }, [isInvoicexpressEnabled]);

  const handleViewPdf = async (id: string, pdfPath: string | null) => {
    if (!pdfPath) return;
    setViewingId(id);
    try {
      await openPdfInNewTab(pdfPath);
    } catch {
      toast.error(t("Erro ao abrir PDF"));
    } finally {
      setViewingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">{t("Notas de Crédito")}</h2>
          <p className="text-sm text-muted-foreground">
            {t("Notas de crédito importadas do InvoiceXpress")}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => syncCreditNotes.mutate()}
          disabled={syncCreditNotes.isPending}
        >
          {syncCreditNotes.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-2" />
          )}
          {t("Sincronizar")}
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-3 p-6">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : !creditNotes?.length ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <FileText className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <p className="text-muted-foreground">{t("Nenhuma nota de crédito encontrada")}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {t("Clique em \"Sincronizar\" para importar notas de crédito do InvoiceXpress")}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("Referência")}</TableHead>
                    <TableHead>{t("Data")}</TableHead>
                    <TableHead>{t("Cliente")}</TableHead>
                    <TableHead className="text-right">{t("Valor")}</TableHead>
                    <TableHead className="text-center">{t("Estado")}</TableHead>
                    <TableHead className="text-center">{t("Fatura Origem")}</TableHead>
                    <TableHead className="text-center">{t("Associada")}</TableHead>
                    <TableHead className="text-center w-[80px]">PDF</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {creditNotes.map((cn) => (
                    <TableRow key={cn.id}>
                      <TableCell className="font-medium">
                        {cn.reference || '-'}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {cn.date ? formatDate(cn.date) : '-'}
                      </TableCell>
                      <TableCell className="max-w-[150px] truncate">
                        {cn.client_name || '-'}
                      </TableCell>
                      <TableCell className="text-right font-semibold whitespace-nowrap">
                        {formatCurrency(cn.total)}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant={getStatusVariant(cn.status)} className="text-xs">
                          {getStatusLabel(cn.status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        {cn.related_invoice_reference ? (
                          <Badge variant="outline" className="text-xs">
                            {cn.related_invoice_reference}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground text-xs">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        {cn.sale_id || cn.payment_id ? (
                          <CheckCircle2 className="h-4 w-4 text-green-500 mx-auto" />
                        ) : (
                          <AlertCircle className="h-4 w-4 text-yellow-500 mx-auto" />
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        {cn.pdf_path ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => handleViewPdf(cn.id, cn.pdf_path)}
                            disabled={viewingId === cn.id}
                          >
                            {viewingId === cn.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <FileDown className="h-4 w-4" />
                            )}
                          </Button>
                        ) : (
                          <span className="text-muted-foreground text-xs">-</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
