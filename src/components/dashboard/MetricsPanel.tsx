import { useState, useMemo, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";
import { useTeamFilter } from "@/hooks/useTeamFilter";
import { useTeamMembers } from "@/hooks/useTeam";
import { useMonthlyMetrics } from "@/hooks/useMonthlyMetrics";
import { useDashboardPeriod } from "@/stores/useDashboardPeriod";
import { useModules } from "@/hooks/useModules";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { TrendingUp, Pencil, ChevronDown, ChevronUp } from "lucide-react";
import { format, startOfMonth, endOfMonth } from "date-fns";
import { dateLocale, intlLocale, useLanguage } from "@/i18n";
import { Skeleton } from "@/components/ui/skeleton";
import { EditMetricsModal } from "./EditMetricsModal";
import { PrintCardButton } from "./PrintCardButton";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";

function formatNumber(val: number) {
  return new Intl.NumberFormat(intlLocale(), { maximumFractionDigits: 2 }).format(val);
}

function formatCurrency(val: number) {
  return new Intl.NumberFormat(intlLocale(), { style: "currency", currency: "EUR" }).format(val);
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

interface RitmoRow {
  userId: string;
  name: string;
  opEnergia: number;
  energia: number;
  opSolar: number;
  solar: number;
  comissao: number;
}

export function MetricsPanel() {
  const { t } = useLanguage();
  const { user, profile, organization } = useAuth();
  const { isAdmin } = usePermissions();
  const { data: members = [] } = useTeamMembers();
  const { selectedMemberId } = useTeamFilter();
  const { selectedMonth, from, to } = useDashboardPeriod();
  const { metrics, isLoading: metricsLoading } = useMonthlyMetrics(selectedMonth);
  const { modules } = useModules();
  const [editOpen, setEditOpen] = useState(false);
  const [metricasOpen, setMetricasOpen] = useState(true);
  const [ritmoOpen, setRitmoOpen] = useState(true);
  const [concOpen, setConcOpen] = useState(true);
  const cardRef = useRef<HTMLDivElement>(null);

  const showEnergy = organization?.niche === 'telecom' && modules.energy;
  const orgId = organization?.id;
  const currentMonthLabel = format(startOfMonth(selectedMonth), "MMMM yyyy", { locale: dateLocale() });

  // As secções "Ritmo" e "Concretização" são contagens por data, por isso
  // seguem o período exato. Só as "Métricas Mensais" (secção A) é que estão
  // guardadas por mês e continuam presas ao mês de `selectedMonth`.
  const monthStart = format(from ?? startOfMonth(selectedMonth), "yyyy-MM-dd");
  const monthEndStr = format(to ?? endOfMonth(selectedMonth), "yyyy-MM-dd");

  const { data: proposalsRaw = [], isLoading: proposalsLoading } = useQuery({
    queryKey: ["metrics-proposals-ops", orgId, monthStart, monthEndStr],
    queryFn: async () => {
      if (!orgId) return [];
      const { data, error } = await supabase
        .from("proposals")
        .select("created_by, proposal_type, kwp, client_id")
        .eq("organization_id", orgId)
        .gte("proposal_date", monthStart)
        .lte("proposal_date", monthEndStr)
        .in("status", ["sent", "negotiating"]);
      if (error) throw error;
      return data || [];
    },
    enabled: !!orgId,
  });

  const proposalClientIds = useMemo(() => {
    const ids = new Set<string>();
    for (const p of proposalsRaw) {
      if (p.client_id) ids.add(p.client_id);
    }
    return Array.from(ids);
  }, [proposalsRaw]);

  const { data: clientNifMap = new Map<string, string | null>(), isLoading: nifsLoading } = useQuery({
    queryKey: ["metrics-client-nifs", proposalClientIds],
    queryFn: async () => {
      if (proposalClientIds.length === 0) return new Map<string, string | null>();
      const { data, error } = await supabase
        .from("crm_clients")
        .select("id, nif")
        .in("id", proposalClientIds);
      if (error) throw error;
      const map = new Map<string, string | null>();
      for (const c of data || []) {
        map.set(c.id, c.nif);
      }
      return map;
    },
    enabled: proposalClientIds.length > 0,
  });

  const { data: salesAggregated = [], isLoading: salesLoading } = useQuery({
    queryKey: ["metrics-sales-ops-v2", orgId, monthStart, monthEndStr],
    queryFn: async () => {
      if (!orgId) return [];
      const { data: sales, error } = await supabase
        .from("sales")
        .select("id, created_by, proposal_id")
        .eq("organization_id", orgId)
        .gte("sale_date", monthStart)
        .lte("sale_date", monthEndStr)
        .eq("status", "fulfilled");
      if (error) throw error;
      if (!sales?.length) return [];

      const proposalIds = [...new Set(sales.map(s => s.proposal_id).filter(Boolean))] as string[];

      let cpesByProposal = new Map<string, { consumo: number; comissao: number }>();
      if (proposalIds.length > 0) {
        const { data: cpes } = await supabase
          .from("proposal_cpes")
          .select("proposal_id, consumo_anual, comissao")
          .in("proposal_id", proposalIds);
        if (cpes) {
          for (const cpe of cpes) {
            const existing = cpesByProposal.get(cpe.proposal_id) || { consumo: 0, comissao: 0 };
            existing.consumo += Number(cpe.consumo_anual || 0);
            existing.comissao += Number(cpe.comissao || 0);
            cpesByProposal.set(cpe.proposal_id, existing);
          }
        }
      }

      let kwpByProposal = new Map<string, number>();
      if (proposalIds.length > 0) {
        const { data: proposals } = await supabase
          .from("proposals")
          .select("id, servicos_details")
          .in("id", proposalIds);
        if (proposals) {
          for (const p of proposals) {
            let totalKwp = 0;
            const details = p.servicos_details as Record<string, { kwp?: number }> | null;
            if (details && typeof details === "object") {
              for (const prod of Object.values(details)) {
                totalKwp += prod?.kwp || 0;
              }
            }
            kwpByProposal.set(p.id, totalKwp);
          }
        }
      }

      return sales.map(s => {
        const cpeData = s.proposal_id ? cpesByProposal.get(s.proposal_id) : null;
        return {
          created_by: s.created_by,
          consumo_anual: cpeData?.consumo ?? 0,
          kwp: s.proposal_id ? (kwpByProposal.get(s.proposal_id) || 0) : 0,
          comissao: cpeData?.comissao ?? 0,
        };
      });
    },
    enabled: !!orgId,
  });

  const loading = metricsLoading || proposalsLoading || salesLoading || nifsLoading;

  const memberList = members.length > 0 ? members : (user?.id ? [{ user_id: user.id, full_name: profile?.full_name || t("Eu") }] : []);
  const filteredMembers = selectedMemberId ? memberList.filter((m) => m.user_id === selectedMemberId) : memberList;

  const ritmoRows: RitmoRow[] = useMemo(() => {
    return filteredMembers.map((m) => {
      const userProposals = proposalsRaw.filter((p: any) => p.created_by === m.user_id);
      
      const energiaKeys = new Set<string>();
      const solarKeys = new Set<string>();
      for (const p of userProposals) {
        const nif = p.client_id ? clientNifMap.get(p.client_id) : null;
        const dedupeKey = nif || p.client_id;
        if (!dedupeKey) continue;
        if (p.proposal_type === "energia") energiaKeys.add(dedupeKey);
        if (p.proposal_type === "servicos" && Number(p.kwp || 0) > 0) solarKeys.add(dedupeKey);
      }
      const opEnergia = energiaKeys.size;
      const opSolar = solarKeys.size;

      const userSales = salesAggregated.filter((s: any) => s.created_by === m.user_id);
      let energia = 0, solar = 0, comissao = 0;
      for (const s of userSales) {
        energia += Number(s.consumo_anual || 0) / 1000;
        solar += Number(s.kwp || 0);
        comissao += Number(s.comissao || 0);
      }
      return {
        userId: m.user_id,
        name: m.full_name + (m.user_id === user?.id ? t(" (eu)") : ""),
        opEnergia,
        energia,
        opSolar,
        solar,
        comissao,
      };
    });
  }, [filteredMembers, proposalsRaw, salesAggregated, clientNifMap, user?.id, t]);

  const sumRitmo = (rows: RitmoRow[]) =>
    rows.reduce((acc, r) => ({
      opEnergia: acc.opEnergia + r.opEnergia,
      energia: acc.energia + r.energia,
      opSolar: acc.opSolar + r.opSolar,
      solar: acc.solar + r.solar,
      comissao: acc.comissao + r.comissao,
    }), { opEnergia: 0, energia: 0, opSolar: 0, solar: 0, comissao: 0 });

  const ritmoTotals = sumRitmo(ritmoRows);
  const showTotals = isAdmin && ritmoRows.length > 1;

  const headers = (
    <TableRow>
      <TableHead className="text-xs whitespace-nowrap">{t("Consultor")}</TableHead>
      {showEnergy && <TableHead className="text-xs text-right whitespace-nowrap">OP</TableHead>}
      {showEnergy && <TableHead className="text-xs text-right whitespace-nowrap">{t("Energia")}</TableHead>}
      {showEnergy && <TableHead className="text-xs text-right whitespace-nowrap">OP</TableHead>}
      {showEnergy && <TableHead className="text-xs text-right whitespace-nowrap">Solar</TableHead>}
      <TableHead className="text-xs text-right whitespace-nowrap">{t("Comissão")}</TableHead>
    </TableRow>
  );

  return (
    <>
      <Card ref={cardRef}>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-primary" />
              <CardTitle className="text-base capitalize">
                {t("Métricas Mensais — {{month}}", { month: currentMonthLabel })}
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
              <Collapsible open={metricasOpen} onOpenChange={setMetricasOpen}>
                <CollapsibleTrigger className="flex items-center gap-1 w-full text-left">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("A) Métricas")}</span>
                  {metricasOpen ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>{headers}</TableHeader>
                      <TableBody>
                        {filteredMembers.map((m) => {
                          const target = metrics.find((mt) => mt.user_id === m.user_id);
                          return (
                            <TableRow key={m.user_id}>
                              <TableCell className="text-xs py-1.5 font-medium whitespace-nowrap">{m.full_name}{m.user_id === user?.id ? t(" (eu)") : ""}</TableCell>
                              {showEnergy && <TableCell className="text-xs text-right py-1.5">{target?.op_energia || 0}</TableCell>}
                              {showEnergy && <TableCell className="text-xs text-right py-1.5">{formatNumber(target?.energia || 0)}</TableCell>}
                              {showEnergy && <TableCell className="text-xs text-right py-1.5">{target?.op_solar || 0}</TableCell>}
                              {showEnergy && <TableCell className="text-xs text-right py-1.5">{formatNumber(target?.solar || 0)}</TableCell>}
                              <TableCell className="text-xs text-right py-1.5 font-medium text-primary">{formatCurrency(target?.comissao || 0)}</TableCell>
                            </TableRow>
                          );
                        })}
                        {showTotals && (
                          <TableRow className="bg-muted/20 hover:bg-muted/20">
                            <TableCell className="text-xs font-semibold py-1.5">{t("TOTAL")}</TableCell>
                            {showEnergy && <TableCell className="text-xs text-right font-semibold py-1.5">{metrics.reduce((a, m) => a + m.op_energia, 0)}</TableCell>}
                            {showEnergy && <TableCell className="text-xs text-right font-semibold py-1.5">{formatNumber(metrics.reduce((a, m) => a + m.energia, 0))}</TableCell>}
                            {showEnergy && <TableCell className="text-xs text-right font-semibold py-1.5">{metrics.reduce((a, m) => a + m.op_solar, 0)}</TableCell>}
                            {showEnergy && <TableCell className="text-xs text-right font-semibold py-1.5">{formatNumber(metrics.reduce((a, m) => a + m.solar, 0))}</TableCell>}
                            <TableCell className="text-xs text-right font-semibold py-1.5 text-primary">{formatCurrency(metrics.reduce((a, m) => a + m.comissao, 0))}</TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </CollapsibleContent>
              </Collapsible>

              <Collapsible open={ritmoOpen} onOpenChange={setRitmoOpen}>
                <CollapsibleTrigger className="flex items-center gap-1 w-full text-left">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("B) Ritmo")}</span>
                  {ritmoOpen ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>{headers}</TableHeader>
                      <TableBody>
                        {ritmoRows.map((row) => (
                          <TableRow key={row.userId}>
                            <TableCell className="text-xs py-1.5 font-medium whitespace-nowrap">{row.name}</TableCell>
                            {showEnergy && <TableCell className="text-xs text-right py-1.5">{row.opEnergia}</TableCell>}
                            {showEnergy && <TableCell className="text-xs text-right py-1.5">{formatNumber(row.energia)}</TableCell>}
                            {showEnergy && <TableCell className="text-xs text-right py-1.5">{row.opSolar}</TableCell>}
                            {showEnergy && <TableCell className="text-xs text-right py-1.5">{formatNumber(row.solar)}</TableCell>}
                            <TableCell className="text-xs text-right py-1.5 font-medium text-primary">{formatCurrency(row.comissao)}</TableCell>
                          </TableRow>
                        ))}
                        {showTotals && (
                          <TableRow className="bg-muted/20 hover:bg-muted/20">
                            <TableCell className="text-xs font-semibold py-1.5">{t("TOTAL")}</TableCell>
                            {showEnergy && <TableCell className="text-xs text-right font-semibold py-1.5">{ritmoTotals.opEnergia}</TableCell>}
                            {showEnergy && <TableCell className="text-xs text-right font-semibold py-1.5">{formatNumber(ritmoTotals.energia)}</TableCell>}
                            {showEnergy && <TableCell className="text-xs text-right font-semibold py-1.5">{ritmoTotals.opSolar}</TableCell>}
                            {showEnergy && <TableCell className="text-xs text-right font-semibold py-1.5">{formatNumber(ritmoTotals.solar)}</TableCell>}
                            <TableCell className="text-xs text-right font-semibold py-1.5 text-primary">{formatCurrency(ritmoTotals.comissao)}</TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </CollapsibleContent>
              </Collapsible>

              <Collapsible open={concOpen} onOpenChange={setConcOpen}>
                <CollapsibleTrigger className="flex items-center gap-1 w-full text-left">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("C) Concretização das Métricas")}</span>
                  {concOpen ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>{headers}</TableHeader>
                      <TableBody>
                        {ritmoRows.map((row) => {
                          const target = metrics.find((m) => m.user_id === row.userId);
                          const tOpE = target?.op_energia || 0;
                          const tE = target?.energia || 0;
                          const tOpS = target?.op_solar || 0;
                          const tS = target?.solar || 0;
                          const tC = target?.comissao || 0;
                          return (
                            <TableRow key={row.userId}>
                              <TableCell className="text-xs py-1.5 font-medium whitespace-nowrap">{row.name}</TableCell>
                              {showEnergy && <TableCell className={`text-xs text-right py-1.5 ${percentColor(row.opEnergia, tOpE)}`}>{formatPercent(row.opEnergia, tOpE)}</TableCell>}
                              {showEnergy && <TableCell className={`text-xs text-right py-1.5 ${percentColor(row.energia, tE)}`}>{formatPercent(row.energia, tE)}</TableCell>}
                              {showEnergy && <TableCell className={`text-xs text-right py-1.5 ${percentColor(row.opSolar, tOpS)}`}>{formatPercent(row.opSolar, tOpS)}</TableCell>}
                              {showEnergy && <TableCell className={`text-xs text-right py-1.5 ${percentColor(row.solar, tS)}`}>{formatPercent(row.solar, tS)}</TableCell>}
                              <TableCell className={`text-xs text-right py-1.5 font-medium ${percentColor(row.comissao, tC)}`}>{formatPercent(row.comissao, tC)}</TableCell>
                            </TableRow>
                          );
                        })}
                        {showTotals && (() => {
                          const tOpE = metrics.reduce((a, m) => a + m.op_energia, 0);
                          const tE = metrics.reduce((a, m) => a + m.energia, 0);
                          const tOpS = metrics.reduce((a, m) => a + m.op_solar, 0);
                          const tS = metrics.reduce((a, m) => a + m.solar, 0);
                          const tC = metrics.reduce((a, m) => a + m.comissao, 0);
                          return (
                            <TableRow className="bg-muted/20 hover:bg-muted/20">
                              <TableCell className="text-xs font-semibold py-1.5">{t("TOTAL")}</TableCell>
                              {showEnergy && <TableCell className={`text-xs text-right font-semibold py-1.5 ${percentColor(ritmoTotals.opEnergia, tOpE)}`}>{formatPercent(ritmoTotals.opEnergia, tOpE)}</TableCell>}
                              {showEnergy && <TableCell className={`text-xs text-right font-semibold py-1.5 ${percentColor(ritmoTotals.energia, tE)}`}>{formatPercent(ritmoTotals.energia, tE)}</TableCell>}
                              {showEnergy && <TableCell className={`text-xs text-right font-semibold py-1.5 ${percentColor(ritmoTotals.opSolar, tOpS)}`}>{formatPercent(ritmoTotals.opSolar, tOpS)}</TableCell>}
                              {showEnergy && <TableCell className={`text-xs text-right font-semibold py-1.5 ${percentColor(ritmoTotals.solar, tS)}`}>{formatPercent(ritmoTotals.solar, tS)}</TableCell>}
                              <TableCell className={`text-xs text-right font-semibold py-1.5 ${percentColor(ritmoTotals.comissao, tC)}`}>{formatPercent(ritmoTotals.comissao, tC)}</TableCell>
                            </TableRow>
                          );
                        })()}
                      </TableBody>
                    </Table>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </>
          )}
        </CardContent>
      </Card>

      <EditMetricsModal open={editOpen} onOpenChange={setEditOpen} metrics={metrics} />
    </>
  );
}
