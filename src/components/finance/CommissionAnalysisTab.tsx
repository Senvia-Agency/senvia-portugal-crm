import React, { useMemo, useState } from "react";
import { format, startOfMonth, subMonths } from "date-fns";
import { useLanguage, dateLocale, intlLocale } from "@/i18n";
import { AlertTriangle, ChevronDown, FileSearch, FileUp, RefreshCw, Search, TrendingDown, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TeamMemberFilter } from "@/components/dashboard/TeamMemberFilter";
import { ImportChargebacksDialog } from "@/components/finance/ImportChargebacksDialog";
import { useCommissionAnalysis, useSyncFileToSystem, type CommissionAnalysisCommercial, type FileDataRow, type ComparisonRow, type SyncFileToSystemItem } from "@/hooks/useCommissionAnalysis";
import { useTeamFilter } from "@/hooks/useTeamFilter";
import { matchesSearch } from "@/lib/utils";
import { NEGOTIATION_TYPE_LABELS, type NegotiationType } from "@/types/proposals";
import { toast } from "@/hooks/use-toast";

function generateMonthOptions() {
  const options: {value: string;label: string;}[] = [];
  const now = new Date();

  for (let i = 0; i < 12; i += 1) {
    const date = startOfMonth(subMonths(now, i));
    options.push({
      value: format(date, "yyyy-MM-dd"),
      label: format(date, "MMMM yyyy", { locale: dateLocale() })
    });
  }

  return options;
}

function CommissionAnalysisTableSkeleton() {
  return (
    <Card>
      <CardContent className="p-0">
        <div className="space-y-3 p-4">
          {Array.from({ length: 6 }).map((_, index) =>
          <div key={index} className="grid grid-cols-9 gap-3">
              {Array.from({ length: 9 }).map((__, cellIndex) =>
            <Skeleton key={cellIndex} className="h-10 w-full" />
            )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>);

}

function ComparisonDataTable({ comparisonData }: {comparisonData: ComparisonRow[];}) {
  const { t } = useLanguage();
  if (comparisonData.length === 0) {
    return <p className="text-xs text-muted-foreground py-2">{t("Sem dados do ficheiro para este comercial.")}</p>;
  }

  const discrepancyCell = "bg-destructive/10 text-destructive font-medium";

  return (
    <div className="rounded-md border bg-muted/30 overflow-auto">
      <Table>
        <TableHeader>
          <TableRow className="text-xs">
            <TableHead className="h-8 min-w-[60px]">{t("Fonte")}</TableHead>
            <TableHead className="h-8 min-w-[100px] hidden sm:table-cell">{t("Tipo Comissão")}</TableHead>
            <TableHead className="h-8 min-w-[140px]">{t("Nome da Empresa")}</TableHead>
            <TableHead className="h-8 min-w-[60px] hidden md:table-cell">{t("Tipo")}</TableHead>
            <TableHead className="h-8 min-w-[180px]">CPE</TableHead>
            <TableHead className="h-8 min-w-[60px] hidden sm:table-cell">DBL</TableHead>
            <TableHead className="h-8 text-right min-w-[100px] hidden lg:table-cell">{t("Consumo anual")}</TableHead>
            <TableHead className="h-8 text-right min-w-[80px] hidden lg:table-cell">{t("Duração (anos)")}</TableHead>
            <TableHead className="h-8 min-w-[90px] hidden md:table-cell">{t("Data Início")}</TableHead>
            <TableHead className="h-8 min-w-[90px] hidden md:table-cell">{t("Data Fim")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {comparisonData.map((row, idx) => {
            // If no discrepancy, show single merged row with badge
            if (!row.hasAnyDiscrepancy) {
              return (
                <TableRow key={`merged-${idx}`} className="text-xs border-b">
                  <TableCell className="py-1.5">
                    <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600">
                      {t("Atualizado")}
                    </span>
                  </TableCell>
                  <TableCell className="py-1.5 hidden sm:table-cell">{row.file.tipoComissao || "—"}</TableCell>
                  <TableCell className="py-1.5 truncate max-w-[160px]">{row.systemClientName || row.file.nomeEmpresa || "—"}</TableCell>
                  <TableCell className="py-1.5 hidden md:table-cell">{row.systemNegotiationType ? (NEGOTIATION_TYPE_LABELS[row.systemNegotiationType as NegotiationType] ? t(NEGOTIATION_TYPE_LABELS[row.systemNegotiationType as NegotiationType]) : row.systemNegotiationType) : row.file.tipo || "—"}</TableCell>
                  <TableCell className="py-1.5 font-mono">{row.systemCpe || row.file.cpe || "—"}</TableCell>
                  <TableCell className="py-1.5 tabular-nums hidden sm:table-cell">{row.file.dbl || "—"}</TableCell>
                  <TableCell className="py-1.5 text-right tabular-nums hidden lg:table-cell">{row.file.consumoAnual || "—"}</TableCell>
                  <TableCell className="py-1.5 text-right tabular-nums hidden lg:table-cell">{row.file.duracaoContrato || "—"}</TableCell>
                  <TableCell className="py-1.5 hidden md:table-cell">{row.file.dataInicio || "—"}</TableCell>
                  <TableCell className="py-1.5 hidden md:table-cell">{row.file.dataFim || "—"}</TableCell>
                </TableRow>);

            }

            return (
              <React.Fragment key={`pair-${idx}`}>
                {/* File row */}
                <TableRow className="text-xs border-b-0">
                  <TableCell className="py-1.5">
                    <span className="inline-flex items-center rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                      {t("Ficheiro")}
                    </span>
                  </TableCell>
                  <TableCell className="py-1.5 hidden sm:table-cell">{row.file.tipoComissao || "—"}</TableCell>
                  <TableCell className="py-1.5 truncate max-w-[160px]">{row.file.nomeEmpresa || "—"}</TableCell>
                  <TableCell className="py-1.5 hidden md:table-cell">{row.file.tipo || "—"}</TableCell>
                  <TableCell className="py-1.5 font-mono">{row.file.cpe || "—"}</TableCell>
                  <TableCell className={`py-1.5 tabular-nums hidden sm:table-cell ${row.hasDblDiscrepancy ? discrepancyCell : ""}`}>
                    {row.file.dbl || "—"}
                  </TableCell>
                  <TableCell className={`py-1.5 text-right tabular-nums hidden lg:table-cell ${row.hasConsumoDiscrepancy ? discrepancyCell : ""}`}>
                    {row.file.consumoAnual || "—"}
                  </TableCell>
                  <TableCell className={`py-1.5 text-right tabular-nums hidden lg:table-cell ${row.hasDuracaoDiscrepancy ? discrepancyCell : ""}`}>
                    {row.file.duracaoContrato || "—"}
                  </TableCell>
                  <TableCell className="py-1.5 hidden md:table-cell">{row.file.dataInicio || "—"}</TableCell>
                  <TableCell className="py-1.5 hidden md:table-cell">{row.file.dataFim || "—"}</TableCell>
                </TableRow>
                {/* System row */}
                <TableRow className="text-xs bg-muted/50 border-b">
                  <TableCell className="py-1.5">
                    <span className="inline-flex items-center rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-secondary-foreground">
                      {t("Sistema")}
                    </span>
                  </TableCell>
                  <TableCell className="py-1.5 text-muted-foreground hidden sm:table-cell">—</TableCell>
                  <TableCell className="py-1.5 text-muted-foreground truncate max-w-[160px]">{row.systemClientName || "—"}</TableCell>
                  <TableCell className="py-1.5 text-muted-foreground hidden md:table-cell">{row.systemNegotiationType ? (NEGOTIATION_TYPE_LABELS[row.systemNegotiationType as NegotiationType] ? t(NEGOTIATION_TYPE_LABELS[row.systemNegotiationType as NegotiationType]) : row.systemNegotiationType) : "—"}</TableCell>
                  <TableCell className="py-1.5 font-mono text-muted-foreground">{row.systemCpe || "—"}</TableCell>
                  <TableCell className={`py-1.5 tabular-nums hidden sm:table-cell ${row.hasDblDiscrepancy ? discrepancyCell : "text-muted-foreground"}`}>
                    {row.systemDbl !== null ? row.systemDbl : "—"}
                  </TableCell>
                  <TableCell className={`py-1.5 text-right tabular-nums hidden lg:table-cell ${row.hasConsumoDiscrepancy ? discrepancyCell : "text-muted-foreground"}`}>
                    {row.systemConsumoAnual !== null ? row.systemConsumoAnual : "—"}
                  </TableCell>
                  <TableCell className={`py-1.5 text-right tabular-nums hidden lg:table-cell ${row.hasDuracaoDiscrepancy ? discrepancyCell : "text-muted-foreground"}`}>
                    {row.systemDuracao !== null ? Number(row.systemDuracao).toFixed(2) : "—"}
                  </TableCell>
                  <TableCell className="py-1.5 text-muted-foreground hidden md:table-cell">{row.systemDataInicio || "—"}</TableCell>
                  <TableCell className="py-1.5 text-muted-foreground hidden md:table-cell">{row.systemDataFim || "—"}</TableCell>
                </TableRow>
              </React.Fragment>);

          })}
        </TableBody>
      </Table>
    </div>);

}

export function CommissionAnalysisTab() {
  const { t, language } = useLanguage();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const monthOptions = useMemo(() => generateMonthOptions(), [language]);
  const [selectedMonth, setSelectedMonth] = useState(monthOptions[0]?.value ?? format(startOfMonth(new Date()), "yyyy-MM-dd"));
  const [searchTerm, setSearchTerm] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [syncConfirmOpen, setSyncConfirmOpen] = useState(false);
  const [detailModal, setDetailModal] = useState<'cb' | 'com' | null>(null);
  const { effectiveUserIds, canFilterByTeam } = useTeamFilter();
  const { data, isLoading, refetch } = useCommissionAnalysis(selectedMonth, effectiveUserIds);
  const syncMutation = useSyncFileToSystem();

  const filteredCommercials = useMemo(() => {
    if (!searchTerm.trim()) return data.commercials;

    return data.commercials.filter((item) => matchesSearch(searchTerm, item.name));
  }, [data.commercials, searchTerm]);

  // Collect all discrepant rows that can be synced
  const syncItems = useMemo<SyncFileToSystemItem[]>(() => {
    const items: SyncFileToSystemItem[] = [];
    for (const commercial of data.commercials) {
      for (const row of commercial.comparisonData) {
        if (row.hasAnyDiscrepancy && row.matchedProposalCpeId) {
          // null = não numérico/vazio no ficheiro → não sincroniza esse campo
          // (evita sobrescrever dados bons com 0).
          const parseNum = (s: string): number | null => {
            const n = parseFloat(String(s ?? "").replace(/[^\d.,-]/g, "").replace(",", "."));
            return Number.isFinite(n) ? n : null;
          };
          // Calculate duration from dates if possible
          const fileDuracaoRaw = parseNum(row.file.duracaoContrato);
          let duracao: number | null = fileDuracaoRaw;
          if (row.file.dataInicio && row.file.dataFim) {
            const parseDateVal = (raw: string): Date | null => {
              const trimmed = raw.trim();
              const [dd, mm, yyyy] = trimmed.split("/");
              if (dd && mm && yyyy) return new Date(Number(yyyy), Number(mm) - 1, Number(dd));
              return null;
            };
            const s = parseDateVal(row.file.dataInicio);
            const e = parseDateVal(row.file.dataFim);
            if (s && e && !isNaN(s.getTime()) && !isNaN(e.getTime())) {
              duracao = (e.getTime() - s.getTime()) / (365 * 86400000);
            }
          }
          // Format dates for DB (yyyy-MM-dd)
          const formatDateForDb = (raw: string): string | null => {
            const trimmed = raw.trim();
            const parts = trimmed.split("/");
            if (parts.length === 3) return `${parts[2]}-${parts[1]}-${parts[0]}`;
            return null;
          };
          items.push({
            proposalCpeId: row.matchedProposalCpeId,
            dbl: parseNum(row.file.dbl),
            consumoAnual: parseNum(row.file.consumoAnual),
            duracaoContrato: duracao,
            contratoInicio: row.file.dataInicio ? formatDateForDb(row.file.dataInicio) : null,
            contratoFim: row.file.dataFim ? formatDateForDb(row.file.dataFim) : null
          });
        }
      }
    }
    return items;
  }, [data.commercials]);

  const cbSummary = useMemo(() => ({
    cbCount: data.summary.cbFileCount,
    cbTotal: data.summary.cbFileTotal,
    cbDiscrepancies: data.summary.cbFileDiscrepancies,
    comCount: data.summary.comFileCount,
    comTotal: data.summary.comFileTotal
  }), [data.summary]);

  const handleSync = async () => {
    setSyncConfirmOpen(false);
    try {
      await syncMutation.mutateAsync(syncItems);
      await refetch();
      toast({ title: t("Sincronização concluída"), description: t("{{n}} CPE(s) atualizados com os dados do ficheiro.", { n: syncItems.length }) });
    } catch (err: any) {
      toast({ title: t("Erro na sincronização"), description: err.message || t("Não foi possível atualizar os CPEs."), variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">{t("Análise de Comissões")}</h2>
          <p className="text-sm text-muted-foreground">
            {t("Comparação entre ficheiro importado e dados do sistema, por comercial.")}
          </p>
        </div>

        <div className="flex gap-2 w-full sm:w-auto">
          {syncItems.length > 0 &&
          <Button variant="outline" onClick={() => setSyncConfirmOpen(true)} disabled={syncMutation.isPending} className="w-full sm:w-auto">
              <RefreshCw className={`h-4 w-4 ${syncMutation.isPending ? "animate-spin" : ""}`} />
              {t("Sincronizar ({{n}})", { n: syncItems.length })}
            </Button>
          }
          <Button onClick={() => setImportOpen(true)} className="w-full sm:w-auto">
            <FileUp className="h-4 w-4" />
            {t("Importar ficheiro")}
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-3 xl:flex-row">
        <Select value={selectedMonth} onValueChange={setSelectedMonth}>
          <SelectTrigger className="w-full xl:w-[220px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {monthOptions.map((option) =>
            <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            )}
          </SelectContent>
        </Select>

        {canFilterByTeam ? <TeamMemberFilter className="w-full xl:w-[220px]" /> : null}

        <div className="relative w-full xl:max-w-sm xl:ml-auto">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder={t("Pesquisar comercial")}
            className="pl-9" />
          
        </div>
      </div>

      {data.imports.length > 0 &&
      <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 rounded-md px-3 py-2">
          <FileUp className="h-3.5 w-3.5" />
          <span>
            {t("Importação ativa:")} <strong className="text-foreground">{data.imports[0]?.file_name}</strong>
            {" — "}
            {format(new Date(data.imports[0]?.created_at), "dd/MM/yyyy HH:mm")}
          </span>
        </div>
      }

      {!isLoading && data.imports.length > 0 &&
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setDetailModal('cb')}>
            <CardContent className="p-4 flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-destructive/10">
                <TrendingDown className="h-5 w-5 text-destructive" />
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">{t("Chargebacks (CB)")}</p>
                <p className="text-xl font-bold tracking-tight text-foreground tabular-nums">
                  {cbSummary.cbCount} <span className="text-sm font-normal text-muted-foreground">CPE(s)</span>
                </p>
                <p className="text-sm font-medium text-destructive tabular-nums">
                  {cbSummary.cbTotal.toLocaleString(intlLocale(), { style: "currency", currency: "EUR" })}
                </p>
                <p className="text-xs text-muted-foreground">{t("Ref. coluna \"Valor a Receber\"")}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setDetailModal('com')}>
            <CardContent className="p-4 flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                <TrendingUp className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">{t("Comissões")}</p>
                <p className="text-xl font-bold tracking-tight text-foreground tabular-nums">
                  {cbSummary.comCount} <span className="text-sm font-normal text-muted-foreground">CPE(s)</span>
                </p>
                <p className="text-sm font-medium text-primary tabular-nums">
                  {cbSummary.comTotal.toLocaleString(intlLocale(), { style: "currency", currency: "EUR" })}
                </p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-destructive/10">
                <AlertTriangle className="h-5 w-5 text-destructive" />
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">{t("Discrepâncias")}</p>
                <p className="text-xl font-bold tracking-tight text-foreground tabular-nums">
                  {cbSummary.cbDiscrepancies}
                </p>
                <p className="text-xs text-muted-foreground">{t("CPE(s) com diferenças")}</p>
              </div>
            </CardContent>
          </Card>
        </div>
      }

      {isLoading ?
      <CommissionAnalysisTableSkeleton /> :
      filteredCommercials.length > 0 ?
      <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t("Comerciais")}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Accordion type="multiple">
              {filteredCommercials.map((commercial) =>
            <AccordionItem key={commercial.userId} value={commercial.userId} className="border-b last:border-b-0">
                  <AccordionTrigger className="px-4 py-3 hover:no-underline hover:bg-muted/50 [&>svg]:hidden justify-start">
                    <div className="flex w-full items-center gap-2 text-sm">
                      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 [[data-state=open]_&]:rotate-180" />
                      <span className="font-medium text-foreground text-left">{commercial.name}</span>
                      {commercial.fileData.length > 0 &&
                  <span className="inline-flex items-center rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                          {t("{{n}} linha(s)", { n: commercial.fileData.length })}
                        </span>
                  }
                      {commercial.comparisonData.some((r) => r.hasAnyDiscrepancy) &&
                  <span className="inline-flex items-center rounded-full bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive">
                          {t("{{n}} discrepância(s)", { n: commercial.comparisonData.filter((r) => r.hasAnyDiscrepancy).length })}
                        </span>
                  }
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="px-4 pb-3 pt-0">
                    <ComparisonDataTable comparisonData={commercial.comparisonData} />
                  </AccordionContent>
                </AccordionItem>
            )}
            </Accordion>
          </CardContent>
        </Card> :

      <Card>
          <CardContent className="flex flex-col items-center justify-center gap-2 py-14 text-center">
            <FileSearch className="h-10 w-10 text-muted-foreground" />
            <h3 className="text-lg font-semibold text-foreground">{t("Sem dados para mostrar")}</h3>
            <p className="max-w-md text-sm text-muted-foreground">
              {t("Importe um ficheiro para ver a análise de comissões.")}
            </p>
          </CardContent>
        </Card>
      }

      <ImportChargebacksDialog open={importOpen} onOpenChange={setImportOpen} />

      <AlertDialog open={syncConfirmOpen} onOpenChange={setSyncConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Sincronizar dados do ficheiro")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("Isto vai atualizar {{cpes}} no sistema com os valores do ficheiro importado (DBL, Consumo anual e Duração). As comissões serão recalculadas automaticamente.", { cpes: "\u0001" }).split("\u0001").flatMap((part, i) => i === 0 ? [part] : [<strong key={i}>{t("{{n}} CPE(s)", { n: syncItems.length })}</strong>, part])}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Cancelar")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleSync}>{t("Sincronizar")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={detailModal !== null} onOpenChange={(open) => !open && setDetailModal(null)}>
        <DialogContent className="max-w-2xl max-h-[80dvh] flex flex-col">
          <DialogHeader>
            <DialogTitle>{detailModal === 'cb' ? t('Chargebacks (CB)') : t('Comissões')}</DialogTitle>
          </DialogHeader>
          <ScrollArea className="flex-1 -mx-6 px-6">
            <Table>
              <TableHeader>
                <TableRow className="text-xs">
                  <TableHead className="h-8">CPE</TableHead>
                  <TableHead className="h-8">{t("Nome da Empresa")}</TableHead>
                  <TableHead className="h-8">{t("Tipo Comissão")}</TableHead>
                  <TableHead className="h-8 text-right">{t("Valor a Receber")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(detailModal === 'cb' ? data.summary.cbFileItems : data.summary.comFileItems).map((item, idx) =>
                <TableRow key={idx} className="text-xs">
                    <TableCell className="font-mono">{item.cpe || "—"}</TableCell>
                    <TableCell>{item.nomeEmpresa || "—"}</TableCell>
                    <TableCell>{item.tipoComissao || "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{item.valorReceber || "—"}</TableCell>
                  </TableRow>
                )}
                {(detailModal === 'cb' ? data.summary.cbFileItems : data.summary.comFileItems).length === 0 &&
                <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground py-6">{t("Sem registos")}</TableCell>
                  </TableRow>
                }
              </TableBody>
            </Table>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>);

}