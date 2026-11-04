import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { CheckSquare, UserPlus, X, Download, FileSpreadsheet, FileText, Trash2, Archive, ArchiveRestore } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useLanguage } from "@/i18n";

interface BulkActionsBarProps {
  selectedCount: number;
  onAssignTeamMember: () => void;
  onExportCsv?: () => void;
  onExportExcel?: () => void;
  onDelete?: () => void;
  onArchive?: () => void;
  onRestore?: () => void;
  onClearSelection: () => void;
  entityLabel?: string;
}

export function BulkActionsBar({
  selectedCount,
  onAssignTeamMember,
  onExportCsv,
  onExportExcel,
  onDelete,
  onArchive,
  onRestore,
  onClearSelection,
  entityLabel = "selecionados",
}: BulkActionsBarProps) {
  const { t } = useLanguage();
  const hasExportOptions = onExportCsv || onExportExcel;
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);

  return (
    <>
      <AnimatePresence>
        {selectedCount > 0 && (
        <motion.div
          key="bulk-actions-bar"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.2 }}
          className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-4 p-3 rounded-lg bg-primary/10 border border-primary/20"
        >
          <div className="flex items-center gap-2 text-sm font-medium text-primary">
            <CheckSquare className="h-4 w-4" />
            <span>{selectedCount} {t(entityLabel)}</span>
          </div>
          
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <Button
              variant="secondary"
              size="sm"
              onClick={onAssignTeamMember}
              className="flex-1 sm:flex-none"
            >
              <UserPlus className="h-4 w-4 mr-2" />
              <span className="hidden sm:inline">{t("Atribuir Comercial Responsável")}</span>
              <span className="sm:hidden">{t("Atribuir")}</span>
            </Button>
            
            {hasExportOptions && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="secondary" size="sm" className="flex-1 sm:flex-none">
                    <Download className="h-4 w-4 sm:mr-2" />
                    <span className="hidden sm:inline">{t("Exportar")}</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {onExportCsv && (
                    <DropdownMenuItem onClick={onExportCsv}>
                      <FileText className="h-4 w-4 mr-2" />
                      {t("Exportar CSV")}
                    </DropdownMenuItem>
                  )}
                  {onExportExcel && (
                    <DropdownMenuItem onClick={onExportExcel}>
                      <FileSpreadsheet className="h-4 w-4 mr-2" />
                      {t("Exportar Excel")}
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            
            {onArchive && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setArchiveConfirmOpen(true)}
                className="flex-1 sm:flex-none"
              >
                <Archive className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">{t("Arquivar")}</span>
              </Button>
            )}

            {onRestore && (
              <Button
                variant="secondary"
                size="sm"
                onClick={onRestore}
                className="flex-1 sm:flex-none"
              >
                <ArchiveRestore className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">{t("Restaurar")}</span>
              </Button>
            )}

            {onDelete && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirmOpen(true)}
                className="text-destructive hover:text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="h-4 w-4 sm:mr-1" />
                <span className="hidden sm:inline">{t("Apagar")}</span>
              </Button>
            )}

            <Button
              variant="ghost"
              size="sm"
              onClick={onClearSelection}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
              <span className="sr-only sm:not-sr-only sm:ml-1">{t("Limpar")}</span>
            </Button>
          </div>
        </motion.div>
        )}
      </AnimatePresence>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Apagar {{n}} {{label}}?", { n: selectedCount, label: t(entityLabel) })}</AlertDialogTitle>
            <AlertDialogDescription>{t("Esta ação não pode ser desfeita.")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Cancelar")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { setConfirmOpen(false); onDelete?.(); }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("Apagar")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={archiveConfirmOpen} onOpenChange={setArchiveConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Arquivar {{n}} {{label}}?", { n: selectedCount, label: t(entityLabel) })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("Ficam ocultas das vistas e contagens, mas não são apagadas. Podes restaurá-las depois em \"Ver arquivadas\".")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Cancelar")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setArchiveConfirmOpen(false); onArchive?.(); }}>
              {t("Arquivar")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
