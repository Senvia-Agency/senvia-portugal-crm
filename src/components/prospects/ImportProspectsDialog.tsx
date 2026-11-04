import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ImportStep1Upload } from "@/components/marketing/import/ImportStep1Upload";
import { useImportProspects } from "@/hooks/useProspects";
import type { ProspectImportResult } from "@/types/prospects";
import { Loader2 } from "lucide-react";
import { useLanguage } from "@/i18n";

interface ImportProspectsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ImportProspectsDialog({ open, onOpenChange }: ImportProspectsDialogProps) {
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [importSummary, setImportSummary] = useState<ProspectImportResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const importProspects = useImportProspects();
  const { t } = useLanguage();

  useEffect(() => {
    if (!open) {
      setFileName("");
      setHeaders([]);
      setRows([]);
      setImportSummary(null);
      setErrorMessage(null);
    }
  }, [open]);

  const handleImport = async () => {
    if (!fileName || rows.length === 0 || importProspects.isPending) return;

    setErrorMessage(null);
    setImportSummary(null);

    try {
      const result = await importProspects.mutateAsync({ fileName, rows });
      setImportSummary(result);

      if (result.failed === 0) {
        onOpenChange(false);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("Erro ao importar prospects"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent variant="fullScreen" className="flex h-full flex-col overflow-hidden p-0">
        <DialogHeader className="border-b px-4 py-4 md:px-6">
          <DialogTitle>{t("Importar prospects")}</DialogTitle>
          <DialogDescription>
            {t("Suporta .xlsb, .xlsx, .xls, .csv e .txt com atualização automática por NIF + CPE ou email.")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-4 py-4 md:px-6">
          <div className="space-y-4">
            {errorMessage ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {errorMessage}
              </div>
            ) : null}

            {importSummary ? (
              <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-foreground">
                <strong className="font-medium">{t("Resultado:")}</strong> {t("{{inserted}} novos • {{updated}} atualizados • {{skipped}} ignorados • {{failed}} falhados", { inserted: importSummary.inserted, updated: importSummary.updated, skipped: importSummary.skipped, failed: importSummary.failed })}
                {importSummary.firstError ? <div className="mt-1 text-muted-foreground">{t("Primeiro erro: {{error}}", { error: importSummary.firstError })}</div> : null}
              </div>
            ) : null}

            <ImportStep1Upload
              fileName={fileName}
              headers={headers}
              rows={rows}
              onFileLoaded={(nextFileName, nextHeaders, nextRows) => {
                setFileName(nextFileName);
                setHeaders(nextHeaders);
                setRows(nextRows);
                setImportSummary(null);
                setErrorMessage(null);
              }}
              onClearFile={() => {
                setFileName("");
                setHeaders([]);
                setRows([]);
                setImportSummary(null);
                setErrorMessage(null);
              }}
            />
          </div>
        </div>

        <div className="border-t px-4 py-4 md:px-6">
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t("Cancelar")}
            </Button>
            <Button onClick={handleImport} disabled={!fileName || rows.length === 0 || importProspects.isPending}>
              {importProspects.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t("Importar prospects")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
