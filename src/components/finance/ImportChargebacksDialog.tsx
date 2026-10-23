import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useEffect, useMemo, useState } from "react";
import { Loader2, AlertTriangle, CalendarDays } from "lucide-react";
import { toast } from "sonner";
import { ImportStep1Upload } from "@/components/marketing/import/ImportStep1Upload";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useImportCommissionChargebacks, type ImportChargebackSummary } from "@/hooks/useCommissionAnalysis";

interface ImportChargebacksDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function normalizeHeader(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function detectCpeColumn(headers: string[]) {
  const edpCol = headers.find((header) => {
    const normalized = normalizeHeader(header);
    return normalized.includes("local de consumo") || normalized.includes("local consumo");
  });
  if (edpCol) return edpCol;

  return headers.find((header) => {
    const normalized = normalizeHeader(header);
    return normalized === "cpe" || normalized.includes("cpe") || normalized.includes("cui");
  });
}

function detectAmountColumn(headers: string[]) {
  const scored = headers
    .map((header) => {
      const normalized = normalizeHeader(header);
      let score = 0;
      if (normalized.includes("chargeback")) score += 8;
      if (normalized.includes("valor")) score += 4;
      if (normalized.includes("montante")) score += 4;
      if (normalized.includes("amount")) score += 3;
      if (normalized.includes("euro") || normalized.includes("eur")) score += 2;
      return { header, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored[0]?.header;
}

export function ImportChargebacksDialog({ open, onOpenChange }: ImportChargebacksDialogProps) {
  const importChargebacks = useImportCommissionChargebacks();
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [selectedCpeColumn, setSelectedCpeColumn] = useState("");
  const [selectedAmountColumn, setSelectedAmountColumn] = useState("");
  const [importSummary, setImportSummary] = useState<ImportChargebackSummary | null>(null);
  const [referenceMonth, setReferenceMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });

  const suggestedCpeColumn = useMemo(() => detectCpeColumn(headers), [headers]);
  const suggestedAmountColumn = useMemo(() => detectAmountColumn(headers), [headers]);

  useEffect(() => {
    if (!open) {
      setFileName("");
      setHeaders([]);
      setRows([]);
      setSelectedCpeColumn("");
      setSelectedAmountColumn("");
      setImportSummary(null);
      return;
    }

    if (!selectedCpeColumn && suggestedCpeColumn) {
      setSelectedCpeColumn(suggestedCpeColumn);
    }
    if (!selectedAmountColumn && suggestedAmountColumn) {
      setSelectedAmountColumn(suggestedAmountColumn);
    }
  }, [open, selectedCpeColumn, suggestedCpeColumn, selectedAmountColumn, suggestedAmountColumn]);

  const preparedRows = useMemo(() => {
    if (!selectedCpeColumn || !selectedAmountColumn) return [];

    return rows
      .map((row) => ({
        ...row,
        cpe: String(row[selectedCpeColumn] ?? "").trim(),
        chargeback_amount: String(row[selectedAmountColumn] ?? "0").trim(),
      }))
      .filter((row) => row.cpe.length > 0);
  }, [selectedAmountColumn, rows, selectedCpeColumn]);

  // Preview before importing: how many rows have a CPE and a valid amount.
  const previewStats = useMemo(() => {
    let withAmount = 0;
    let total = 0;
    for (const row of preparedRows) {
      const n = parseFloat(String(row.chargeback_amount).replace(/[^\d.,-]/g, "").replace(",", "."));
      if (Number.isFinite(n) && n !== 0) {
        withAmount += 1;
        total += Math.abs(n);
      }
    }
    return { withCpe: preparedRows.length, withAmount, total };
  }, [preparedRows]);

  const handleImport = async () => {
    if (!fileName || preparedRows.length === 0 || !selectedCpeColumn) return;

    try {
      await importChargebacks.mutateAsync({
        fileName,
        cpeColumnName: selectedCpeColumn,
        rows: preparedRows,
        referenceMonth: `${referenceMonth}-01`,
      });

      toast.success("Ficheiro importado com sucesso.");
      onOpenChange(false);
    } catch (error: unknown) {
      console.error("Chargeback import error:", error);
      let msg = "Erro ao importar chargebacks.";
      if (error && typeof error === "object") {
        const e = error as Record<string, unknown>;
        if (typeof e.message === "string" && e.message.length > 0) {
          msg = e.message;
        } else if (typeof e.details === "string" && e.details.length > 0) {
          msg = e.details;
        }
      } else if (typeof error === "string") {
        msg = error;
      }
      toast.error(msg);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent variant="fullScreen" className="flex h-full flex-col overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b px-4 py-4 pr-14 sm:px-6">
          <DialogTitle>Importar</DialogTitle>
          <DialogDescription>
            Carregue o ficheiro e o sistema associa automaticamente aos comerciais.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">

            <section className="space-y-4 rounded-xl border bg-card p-4 sm:p-5">
              <div>
                <h3 className="text-sm font-semibold text-foreground">1. Carregar ficheiro</h3>
                <p className="text-sm text-muted-foreground">Suporta Excel, CSV ou TXT com até 1000 linhas por importação.</p>
              </div>

              <ImportStep1Upload
                fileName={fileName}
                headers={headers}
                rows={rows}
                onFileLoaded={(nextFileName, nextHeaders, nextRows) => {
                  setFileName(nextFileName);
                  setHeaders(nextHeaders);
                  setRows(nextRows);
                  setSelectedCpeColumn(detectCpeColumn(nextHeaders) || "");
                  setSelectedAmountColumn(detectAmountColumn(nextHeaders) || "");
                  setImportSummary(null);
                }}
                onClearFile={() => {
                  setFileName("");
                  setHeaders([]);
                  setRows([]);
                  setSelectedCpeColumn("");
                  setSelectedAmountColumn("");
                  setImportSummary(null);
                }}
              />
            </section>

            {headers.length > 0 && (
              <section className="space-y-4 rounded-xl border bg-card p-4 sm:p-5">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">2. Confirmar colunas</h3>
                  <p className="text-sm text-muted-foreground">Detetámos automaticamente. Confirma ou corrige qual a coluna do CPE e a do valor do estorno.</p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="cpe-col" className="text-sm">Coluna do CPE</Label>
                    <Select value={selectedCpeColumn || '__no_column__'} onValueChange={value => setSelectedCpeColumn(value === '__no_column__' ? '' : value)}><SelectTrigger id="cpe-col"><SelectValue placeholder="— escolher —" /></SelectTrigger><SelectContent><SelectItem value="__no_column__">— escolher —</SelectItem>{headers.filter(Boolean).map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}</SelectContent></Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="amount-col" className="text-sm">Coluna do valor (estorno)</Label>
                    <Select value={selectedAmountColumn || '__no_column__'} onValueChange={value => setSelectedAmountColumn(value === '__no_column__' ? '' : value)}><SelectTrigger id="amount-col"><SelectValue placeholder="— escolher —" /></SelectTrigger><SelectContent><SelectItem value="__no_column__">— escolher —</SelectItem>{headers.filter(Boolean).map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}</SelectContent></Select>
                  </div>
                </div>
              </section>
            )}

            {headers.length > 0 && !selectedCpeColumn && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  Não foi possível detectar a coluna CPE automaticamente. Escolhe-a acima (ex.: "Linha de Contrato: Local de Consumo" ou "CPE").
                </AlertDescription>
              </Alert>
            )}

            {headers.length > 0 && !selectedAmountColumn && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  Não foi possível detectar a coluna de valor automaticamente. Verifique se o ficheiro contém uma coluna com "chargeback", "valor" ou "montante".
                </AlertDescription>
              </Alert>
            )}

            {headers.length > 0 && selectedCpeColumn && selectedAmountColumn && (
              <>
                <section className="space-y-4 rounded-xl border bg-card p-4 sm:p-5">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                      <CalendarDays className="h-4 w-4" />
                      3. Mês de referência
                    </h3>
                    <p className="text-sm text-muted-foreground">A que mês se refere este ficheiro?</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Label htmlFor="ref-month" className="text-sm whitespace-nowrap">Mês</Label>
                    <input
                      id="ref-month"
                      type="month"
                      value={referenceMonth}
                      onChange={(e) => setReferenceMonth(e.target.value)}
                      className="flex h-10 w-full max-w-[200px] rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                    />
                  </div>
                </section>

                <section className="space-y-2 rounded-xl border bg-card p-4 sm:p-5">
                  <h3 className="text-sm font-semibold text-foreground">4. Pré-visualização</h3>
                  <p className="text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">{previewStats.withCpe}</span> linha(s) com CPE ·{" "}
                    <span className="font-medium text-foreground">{previewStats.withAmount}</span> com valor de estorno ·{" "}
                    total <span className="font-medium text-foreground">{previewStats.total.toFixed(2)}€</span>
                  </p>
                  {previewStats.withAmount === 0 && (
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                      Nenhuma linha tem um valor de estorno válido. Confirma a coluna do valor acima.
                    </p>
                  )}
                </section>

              </>
            )}
          </div>
        </div>

        <div className="shrink-0 border-t px-4 py-4 sm:px-6">
          <div className="mx-auto flex w-full max-w-4xl flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Fechar
            </Button>
            <Button
              onClick={handleImport}
              disabled={!fileName || preparedRows.length === 0 || !selectedCpeColumn || importChargebacks.isPending}
            >
              {importChargebacks.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Importar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
