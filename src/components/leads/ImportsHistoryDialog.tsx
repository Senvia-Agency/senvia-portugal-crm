import { useState } from "react";
import { format } from "date-fns";
import { dateLocale, useLanguage } from "@/i18n";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Trash2, FileX, AlertTriangle } from "lucide-react";
import { useLeadImports, useDeleteLeadImport, type LeadImportRow } from "@/hooks/useLeadImports";
import { usePermissions } from "@/hooks/usePermissions";

interface ImportsHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ImportsHistoryDialog({ open, onOpenChange }: ImportsHistoryDialogProps) {
  const { data: imports = [], isLoading } = useLeadImports();
  const { t } = useLanguage();
  const deleteImport = useDeleteLeadImport();
  const { can, isAdmin } = usePermissions();

  const canDelete = isAdmin || can("leads", "imports", "delete");

  const [confirming, setConfirming] = useState<LeadImportRow | null>(null);

  const handleConfirmDelete = async () => {
    if (!confirming) return;
    await deleteImport.mutateAsync(confirming.id);
    setConfirming(null);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-5xl max-h-[85dvh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>{t("Histórico de Importações")}</DialogTitle>
            <DialogDescription>
              {t("Lotes de leads importados nesta organização. Só podes apagar lotes onde nenhum lead já tenha atividade (proposta, cliente, venda, encomenda ou evento).")}
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-auto">
            {isLoading ? (
              <div className="flex justify-center p-12">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : imports.length === 0 ? (
              <div className="p-12 text-center text-muted-foreground">
                <FileX className="mx-auto mb-3 h-12 w-12 opacity-50" />
                <p>{t("Ainda não há importações.")}</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("Nome")}</TableHead>
                    <TableHead>{t("Código")}</TableHead>
                    <TableHead>{t("Data")}</TableHead>
                    <TableHead>{t("Por")}</TableHead>
                    <TableHead className="text-right">{t("Importados")}</TableHead>
                    <TableHead className="text-right">{t("Ainda existem")}</TableHead>
                    <TableHead className="text-right">{t("Com atividade")}</TableHead>
                    {canDelete && <TableHead className="text-right">{t("Ações")}</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {imports.map((imp) => {
                    const locked = imp.leads_with_activity > 0;
                    return (
                      <TableRow key={imp.id}>
                        <TableCell className="font-medium">
                          {imp.name || (
                            <span className="text-muted-foreground italic">{t("(sem nome)")}</span>
                          )}
                          {imp.file_name && (
                            <div className="text-xs text-muted-foreground truncate max-w-[280px]">
                              {imp.file_name}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          <span className="font-mono text-xs">{imp.import_code}</span>
                        </TableCell>
                        <TableCell className="text-sm">
                          {format(new Date(imp.created_at), t("dd MMM yyyy 'às' HH:mm"), { locale: dateLocale() })}
                        </TableCell>
                        <TableCell className="text-sm">{imp.importer_name || "—"}</TableCell>
                        <TableCell className="text-right">{imp.total_inserted}</TableCell>
                        <TableCell className="text-right">{imp.leads_remaining}</TableCell>
                        <TableCell className="text-right">
                          {imp.leads_with_activity > 0 ? (
                            <Badge variant="secondary" className="bg-yellow-500/10 text-yellow-700 dark:text-yellow-400">
                              {imp.leads_with_activity}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground">0</span>
                          )}
                        </TableCell>
                        {canDelete && (
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive hover:text-destructive"
                              disabled={locked || deleteImport.isPending}
                              onClick={() => setConfirming(imp)}
                              title={
                                locked
                                  ? t("{{n}} lead(s) já têm atividade — não é possível apagar este lote.", { n: imp.leads_with_activity })
                                  : t("Apagar importação")
                              }
                            >
                              {locked ? <AlertTriangle className="h-4 w-4" /> : <Trash2 className="h-4 w-4" />}
                            </Button>
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirming} onOpenChange={(o) => !o && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Apagar importação?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirming && (
                <>
                  {t("Vais apagar a importação \"{{name}}\":", { name: confirming.name || confirming.import_code })}
                  <ul className="mt-2 list-disc pl-5 space-y-1 text-sm">
                    <li>{t("{{n}} lead(s) serão eliminados.", { n: confirming.leads_remaining })}</li>
                    <li>{t("O registo da importação será removido.")}</li>
                  </ul>
                  <p className="mt-3 text-sm text-destructive">
                    {t("Esta ação não pode ser revertida.")}
                  </p>
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Cancelar")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteImport.isPending}
            >
              {deleteImport.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t("Apagar")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
