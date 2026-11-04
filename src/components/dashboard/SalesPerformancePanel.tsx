import { useRef, useState, useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";
import { useTeamFilter } from "@/hooks/useTeamFilter";
import { useTeamMembers } from "@/hooks/useTeam";
import { useMonthlyObjectives } from "@/hooks/useMonthlyObjectives";
import { useMonthSalesMetrics } from "@/hooks/useMonthSalesMetrics";
import { useDashboardPeriod } from "@/stores/useDashboardPeriod";
import { useModules } from "@/hooks/useModules";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { BarChart3, Pencil, ChevronDown, ChevronUp } from "lucide-react";
import { format, startOfMonth } from "date-fns";
import { dateLocale, intlLocale, useLanguage } from "@/i18n";
import { Skeleton } from "@/components/ui/skeleton";
import { EditObjectiveModal } from "./EditObjectiveModal";
import { PrintCardButton } from "./PrintCardButton";

function formatCurrency(val: number) {
  return new Intl.NumberFormat(intlLocale(), { style: "currency", currency: "EUR" }).format(val);
}

function formatNumber(val: number) {
  return new Intl.NumberFormat(intlLocale(), { maximumFractionDigits: 2 }).format(val);
}

function formatPercent(actual: number, target: number) {
  if (target === 0) return "—";
  return `${Math.round((actual / target) * 100)}%`;
}

function percentColor(actual: number, target: number) {
  if (target === 0) return "text-muted-foreground";
  const pct = (actual / target) * 100;
  if (pct >= 100) return "text-green-500";
  if (pct >= 50) return "text-amber-500";
  return "text-red-500";
}

interface RowData {
  userId: string;
  name: string;
  nifs: number;
  energia: number;
  solar: number;
  comissao: number;
}

export function SalesPerformancePanel() {
  const { t } = useLanguage();
  const { user, profile, organization } = useAuth();
  const { isAdmin } = usePermissions();
  const { data: members = [] } = useTeamMembers();
  const { selectedMemberId, canFilterByTeam, isTeamLeader, teamMemberIds, dataScope } = useTeamFilter();
  // `selectedMonth` só serve os OBJETIVOS, que estão guardados uma linha por
  // mês (não há como um intervalo arbitrário mapear nisso). As vendas, essas,
  // seguem o período exato escolhido.
  const { selectedMonth, from, to } = useDashboardPeriod();
  const { objectives, isLoading: objLoading } = useMonthlyObjectives(selectedMonth);
  const { data: salesMetrics = [], isLoading: salesLoading } = useMonthSalesMetrics(selectedMonth, from, to);
  const { modules } = useModules();
  const [editOpen, setEditOpen] = useState(false);
  const [objOpen, setObjOpen] = useState(true);
  const [salesOpen, setSalesOpen] = useState(true);
  const [concOpen, setConcOpen] = useState(true);
  const cardRef = useRef<HTMLDivElement>(null);

  const showEnergy = organization?.niche === 'telecom' && modules.energy;
  const currentMonthLabel = format(startOfMonth(selectedMonth), "MMMM yyyy", { locale: dateLocale() });
  const loading = objLoading || salesLoading;

  const allMemberList = members.length > 0 ? members : (user?.id ? [{ user_id: user.id, full_name: profile?.full_name || t("Eu") }] : []);

  const filteredMembers = useMemo(() => {
    if (dataScope === 'own' || !canFilterByTeam) {
      return allMemberList.filter(m => m.user_id === user?.id);
    }
    if (selectedMemberId) {
      return allMemberList.filter(m => m.user_id === selectedMemberId);
    }
    if (dataScope === 'team' && isTeamLeader) {
      const allowed = new Set([user?.id, ...teamMemberIds].filter(Boolean));
      return allMemberList.filter(m => allowed.has(m.user_id));
    }
    return allMemberList;
  }, [allMemberList, dataScope, canFilterByTeam, selectedMemberId, isTeamLeader, teamMemberIds, user?.id]);

  const objectiveRows: RowData[] = filteredMembers.map((m) => {
    const obj = objectives.find((o) => o.user_id === m.user_id);
    return {
      userId: m.user_id,
      name: m.full_name + (m.user_id === user?.id ? t(" (eu)") : ""),
      nifs: Number(obj?.total_nifs || 0),
      energia: Number(obj?.total_energia_mwh || 0),
      solar: Number(obj?.total_solar_kwp || 0),
      comissao: Number(obj?.total_comissao || 0),
    };
  });

  const salesRows: RowData[] = filteredMembers.map((m) => {
    const sm = salesMetrics.find((s) => s.userId === m.user_id);
    return {
      userId: m.user_id,
      name: m.full_name + (m.user_id === user?.id ? t(" (eu)") : ""),
      nifs: sm?.nifs || 0,
      energia: sm?.energia || 0,
      solar: sm?.solar || 0,
      comissao: sm?.comissao || 0,
    };
  });

  const sumRows = (rows: RowData[]) =>
    rows.reduce((acc, r) => ({ nifs: acc.nifs + r.nifs, energia: acc.energia + r.energia, solar: acc.solar + r.solar, comissao: acc.comissao + r.comissao }), { nifs: 0, energia: 0, solar: 0, comissao: 0 });

  const salesTotals = sumRows(salesRows);
  const objTotals = sumRows(objectiveRows);
  const showTotals = isAdmin && salesRows.length > 1;

  const TableHeaders = () => (
    <TableRow>
      <TableHead className="text-xs">{t("Colaborador")}</TableHead>
      <TableHead className="text-xs text-right">NIFs</TableHead>
      {showEnergy && <TableHead className="text-xs text-right">{t("Energia")}</TableHead>}
      {showEnergy && <TableHead className="text-xs text-right hidden sm:table-cell">Solar</TableHead>}
      <TableHead className="text-xs text-right">{t("Comissão")}</TableHead>
    </TableRow>
  );

  const ObjectiveTable = () => (
    <Table>
      <TableHeader><TableHeaders /></TableHeader>
      <TableBody>
        {objectiveRows.map((row) => (
          <TableRow key={row.userId}>
            <TableCell className="text-xs py-1.5 font-medium">{row.name}</TableCell>
            <TableCell className="text-xs text-right py-1.5">{formatNumber(row.nifs)}</TableCell>
            {showEnergy && <TableCell className="text-xs text-right py-1.5">{formatNumber(row.energia)}</TableCell>}
            {showEnergy && <TableCell className="text-xs text-right py-1.5 hidden sm:table-cell">{formatNumber(row.solar)}</TableCell>}
            <TableCell className="text-xs text-right py-1.5 font-medium text-primary">{formatCurrency(row.comissao)}</TableCell>
          </TableRow>
        ))}
        {showTotals && (
          <TableRow className="bg-muted/20 hover:bg-muted/20">
            <TableCell className="text-xs font-semibold py-1.5">{t("TOTAL")}</TableCell>
            <TableCell className="text-xs text-right font-semibold py-1.5">{formatNumber(objTotals.nifs)}</TableCell>
            {showEnergy && <TableCell className="text-xs text-right font-semibold py-1.5">{formatNumber(objTotals.energia)}</TableCell>}
            {showEnergy && <TableCell className="text-xs text-right font-semibold py-1.5 hidden sm:table-cell">{formatNumber(objTotals.solar)}</TableCell>}
            <TableCell className="text-xs text-right font-semibold py-1.5 text-primary">{formatCurrency(objTotals.comissao)}</TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );

  const SalesTable = () => (
    <Table>
      <TableHeader><TableHeaders /></TableHeader>
      <TableBody>
        {salesRows.map((row) => (
          <TableRow key={row.userId}>
            <TableCell className="text-xs py-1.5 font-medium">{row.name}</TableCell>
            <TableCell className="text-xs text-right py-1.5">{formatNumber(row.nifs)}</TableCell>
            {showEnergy && <TableCell className="text-xs text-right py-1.5">{formatNumber(row.energia)}</TableCell>}
            {showEnergy && <TableCell className="text-xs text-right py-1.5 hidden sm:table-cell">{formatNumber(row.solar)}</TableCell>}
            <TableCell className="text-xs text-right py-1.5 font-medium text-green-500">{formatCurrency(row.comissao)}</TableCell>
          </TableRow>
        ))}
        {showTotals && (
          <TableRow className="bg-muted/20 hover:bg-muted/20">
            <TableCell className="text-xs font-semibold py-1.5">{t("TOTAL")}</TableCell>
            <TableCell className="text-xs text-right font-semibold py-1.5">{formatNumber(salesTotals.nifs)}</TableCell>
            {showEnergy && <TableCell className="text-xs text-right font-semibold py-1.5">{formatNumber(salesTotals.energia)}</TableCell>}
            {showEnergy && <TableCell className="text-xs text-right font-semibold py-1.5 hidden sm:table-cell">{formatNumber(salesTotals.solar)}</TableCell>}
            <TableCell className="text-xs text-right font-semibold py-1.5 text-green-500">{formatCurrency(salesTotals.comissao)}</TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );

  const ConcretizacaoTable = () => (
    <Table>
      <TableHeader><TableHeaders /></TableHeader>
      <TableBody>
        {salesRows.map((row, i) => {
          const obj = objectiveRows[i];
          return (
            <TableRow key={row.userId}>
              <TableCell className="text-xs py-1.5 font-medium">{row.name}</TableCell>
              <TableCell className={`text-xs text-right py-1.5 ${percentColor(row.nifs, obj.nifs)}`}>{formatPercent(row.nifs, obj.nifs)}</TableCell>
              {showEnergy && <TableCell className={`text-xs text-right py-1.5 ${percentColor(row.energia, obj.energia)}`}>{formatPercent(row.energia, obj.energia)}</TableCell>}
              {showEnergy && <TableCell className={`text-xs text-right py-1.5 hidden sm:table-cell ${percentColor(row.solar, obj.solar)}`}>{formatPercent(row.solar, obj.solar)}</TableCell>}
              <TableCell className={`text-xs text-right py-1.5 font-medium ${percentColor(row.comissao, obj.comissao)}`}>{formatPercent(row.comissao, obj.comissao)}</TableCell>
            </TableRow>
          );
        })}
        {showTotals && (
          <TableRow className="bg-muted/20 hover:bg-muted/20">
            <TableCell className="text-xs font-semibold py-1.5">{t("TOTAL")}</TableCell>
            <TableCell className={`text-xs text-right font-semibold py-1.5 ${percentColor(salesTotals.nifs, objTotals.nifs)}`}>{formatPercent(salesTotals.nifs, objTotals.nifs)}</TableCell>
            {showEnergy && <TableCell className={`text-xs text-right font-semibold py-1.5 ${percentColor(salesTotals.energia, objTotals.energia)}`}>{formatPercent(salesTotals.energia, objTotals.energia)}</TableCell>}
            {showEnergy && <TableCell className={`text-xs text-right font-semibold py-1.5 hidden sm:table-cell ${percentColor(salesTotals.solar, objTotals.solar)}`}>{formatPercent(salesTotals.solar, objTotals.solar)}</TableCell>}
            <TableCell className={`text-xs text-right font-semibold py-1.5 ${percentColor(salesTotals.comissao, objTotals.comissao)}`}>{formatPercent(salesTotals.comissao, objTotals.comissao)}</TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );

  return (
    <>
      <Card ref={cardRef}>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-primary" />
              <CardTitle className="text-base capitalize">
                {t("Objetivo Mensal — {{month}}", { month: currentMonthLabel })}
              </CardTitle>
            </div>
            <div className="flex items-center gap-1">
              <PrintCardButton targetRef={cardRef} />
              {isAdmin && (
                <Button variant="ghost" size="icon-sm" onClick={() => setEditOpen(true)}>
                  <Pencil className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0 space-y-3">
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : (
            <>
              <Collapsible open={objOpen} onOpenChange={setObjOpen}>
                <CollapsibleTrigger className="flex items-center gap-1 w-full text-left">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("A) Objetivo")}</span>
                  {objOpen ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <ObjectiveTable />
                </CollapsibleContent>
              </Collapsible>

              <Collapsible open={salesOpen} onOpenChange={setSalesOpen}>
                <CollapsibleTrigger className="flex items-center gap-1 w-full text-left">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("B) Vendas")}</span>
                  {salesOpen ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <SalesTable />
                </CollapsibleContent>
              </Collapsible>

              <Collapsible open={concOpen} onOpenChange={setConcOpen}>
                <CollapsibleTrigger className="flex items-center gap-1 w-full text-left">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("C) Concretização do Objetivo")}</span>
                  {concOpen ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <ConcretizacaoTable />
                </CollapsibleContent>
              </Collapsible>
            </>
          )}
        </CardContent>
      </Card>

      <EditObjectiveModal
        open={editOpen}
        onOpenChange={setEditOpen}
        objectives={objectives}
      />
    </>
  );
}
