import { useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { endOfDay, eachMonthOfInterval, format, startOfMonth } from "date-fns";
import { intlLocale, tr, useLanguage } from "@/i18n";
import { Users } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";
import { useProposals } from "@/hooks/useProposals";
import { useTeamMembers, type TeamMember } from "@/hooks/useTeam";
import { useTeamFilter } from "@/hooks/useTeamFilter";
import { usePipelineStages } from "@/hooks/usePipelineStages";
import { usePaidTrafficFilter } from "@/contexts/PaidTrafficFilterContext";
import { getTrafficMatcher } from "@/lib/paid-traffic";
import { supabase } from "@/integrations/supabase/client";
import { useDashboardPeriod, formatPeriodLabel } from "@/stores/useDashboardPeriod";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PrintCardButton } from "./PrintCardButton";
import { formatOperationalUnits, sumOperationalSaleUnits } from "@/lib/sale-units";
import { useCommercialCommissionsByMonth } from "@/hooks/useCommercialCommissions";

function formatCurrency(val: number) {
  return new Intl.NumberFormat(intlLocale(), { style: "currency", currency: "EUR" }).format(val);
}

function getConversionTone(rate: number) {
  if (rate >= 50) return "text-primary";
  if (rate >= 25) return "text-foreground";
  return "text-destructive";
}

function getScopeLabel(dataScope: string, selectedMemberName: string | null, isTeamLeader: boolean) {
  if (selectedMemberName) return tr("Filtro ativo: {{name}}", { name: selectedMemberName });
  if (dataScope === "all") return tr("A mostrar todos os colaboradores");
  if (dataScope === "team" && isTeamLeader) return tr("A mostrar a sua equipa");
  return tr("A mostrar apenas os seus dados");
}

interface MemberPerformance {
  userId: string;
  name: string;
  leads: number;
  wonLeads: number;
  proposals: number;
  openProposalValue: number;
  salesDelivered: number;
  commission: number;
  conversionRate: number;
}

export function TeamPerformanceTable() {
  const { t } = useLanguage();
  const { user, profile, organization } = useAuth();
  const { isAdmin } = usePermissions();
  const { data: members = [] } = useTeamMembers();
  const { data: pipelineStages = [] } = usePipelineStages();
  const { data: scopedProposals = [], isLoading: proposalsLoading } = useProposals();

  // A lead is "converted" when it reaches a final-positive (won) stage.
  const convertedStatusKeys = useMemo(() => {
    const keys = new Set(pipelineStages.filter((s) => s.is_final_positive).map((s) => s.key));
    keys.add("won"); // fallback for orgs without an explicit final-positive stage
    return keys;
  }, [pipelineStages]);
  const { selectedMemberId, canFilterByTeam, isTeamLeader, teamMemberIds, dataScope } = useTeamFilter();
  const { from, to } = useDashboardPeriod();
  const { filterKey } = usePaidTrafficFilter();
  const cardRef = useRef<HTMLDivElement>(null);

  const orgId = organization?.id;
  // Honra o intervalo escolhido tal como foi escolhido. Sem período ("Todo o
  // histórico"), abre para todo o passado e até ao fim do dia de hoje.
  const monthStartDate = from ?? new Date(0);
  const monthEndDate = endOfDay(to ?? from ?? new Date());
  const monthStart = monthStartDate.toISOString();
  const monthEnd = monthEndDate.toISOString();
  const monthStartMs = monthStartDate.getTime();
  const monthEndMs = monthEndDate.getTime();
  const currentMonthLabel = formatPeriodLabel(from, to);

  const allMemberList = useMemo(() => {
    const activeMembers = members.filter((member) => !member.is_banned);
    const membersMap = new Map(activeMembers.map((member) => [member.user_id, member]));

    if (user?.id && !membersMap.has(user.id)) {
      const fallbackCurrentUser: TeamMember = {
        id: user.id,
        user_id: user.id,
        full_name: profile?.full_name || t("Eu"),
        avatar_url: null,
        email: null,
        phone: null,
        organization_id: orgId || null,
        role: "viewer",
        is_banned: false,
        profile_id: null,
        profile_name: null,
      };

      membersMap.set(user.id, fallbackCurrentUser);
    }

    return Array.from(membersMap.values());
  }, [members, orgId, profile?.full_name, user?.id, t]);

  const filteredMembers = useMemo(() => {
    if (dataScope === "own" || !canFilterByTeam) {
      return allMemberList.filter((member) => member.user_id === user?.id);
    }

    if (selectedMemberId) {
      return allMemberList.filter((member) => member.user_id === selectedMemberId);
    }

    if (dataScope === "team" && isTeamLeader) {
      const allowed = new Set([user?.id, ...teamMemberIds].filter(Boolean));
      return allMemberList.filter((member) => allowed.has(member.user_id));
    }

    return allMemberList;
  }, [allMemberList, canFilterByTeam, dataScope, isTeamLeader, selectedMemberId, teamMemberIds, user?.id]);

  const memberIds = filteredMembers.map((member) => member.user_id);

  const selectedMemberName = useMemo(() => {
    if (!selectedMemberId) return null;
    return allMemberList.find((member) => member.user_id === selectedMemberId)?.full_name || null;
  }, [allMemberList, selectedMemberId]);

  const proposalsInPeriod = useMemo(() => {
    if (memberIds.length === 0) return [];

    return scopedProposals.filter((proposal) => {
      if (!proposal.created_by || !memberIds.includes(proposal.created_by)) return false;
      const createdAtMs = new Date(proposal.created_at).getTime();
      return createdAtMs >= monthStartMs && createdAtMs <= monthEndMs;
    });
  }, [memberIds, monthEndMs, monthStartMs, scopedProposals]);

  const { data: leadsData, isLoading: leadsLoading } = useQuery({
    queryKey: ["team-perf-leads", orgId, monthStart, monthEnd, memberIds, filterKey],
    queryFn: async () => {
      if (!orgId || memberIds.length === 0) return [];
      const { data, error } = await supabase
        .from("leads")
        .select("assigned_to, status, source")
        .eq("organization_id", orgId)
        .is("archived_at", null)
        .gte("created_at", monthStart)
        .lte("created_at", monthEnd)
        .in("assigned_to", memberIds);
      if (error) throw error;
      return data || [];
    },
    enabled: !!orgId && memberIds.length > 0,
  });

  const trafficFilteredLeads = useMemo(() => {
    if (filterKey === "all") return leadsData || [];
    const matcher = getTrafficMatcher(filterKey);
    return (leadsData || []).filter((lead) => matcher(lead.source));
  }, [leadsData, filterKey]);

  const { data: salesData, isLoading: salesLoading } = useQuery({
    queryKey: ["team-perf-sales", orgId, monthStart, monthEnd, memberIds],
    queryFn: async () => {
      if (!orgId || memberIds.length === 0) return [];
      // Cast: seller_id is newer than the generated types, and one unknown
      // column poisons the whole query inferred type.
      const { data, error } = await (supabase as any)
        .from("sales")
        .select("id, created_by, seller_id, status, operational_units")
        .eq("organization_id", orgId)
        .gte("created_at", monthStart)
        .lte("created_at", monthEnd)
        // Assigned OR created by one of them: a sale handed to a member by
        // somebody outside this list is still that member's sale.
        .or(`created_by.in.(${memberIds.join(",")}),seller_id.in.(${memberIds.join(",")})`);
      if (error) throw error;
      return data || [];
    },
    enabled: !!orgId && memberIds.length > 0,
  });

  // Commission: the same figures as the Comissões screen (what the client paid
  // in the month, recurring Stripe commissions, telecom by installation),
  // summed over the months the period covers. Counting only sales created and
  // delivered in the period showed a fraction of what was earned. The monthly
  // figures can't split a month, and an open-ended period ("Todo o histórico")
  // or one beyond a year has no sensible sum, so those show a dash.
  const commissionMonths = useMemo(() => {
    if (!from) return null;
    const months = eachMonthOfInterval({ start: startOfMonth(from), end: startOfMonth(to ?? from) })
      .map((month) => format(month, "yyyy-MM-dd"));
    return months.length <= 12 ? months : null;
  }, [from, to]);
  const commissionQueries = useCommercialCommissionsByMonth(commissionMonths ?? []);
  const commissionsLoading = commissionQueries.some((query) => query.isLoading);
  const commissionByUser = new Map<string, number>();
  for (const query of commissionQueries) {
    for (const commercial of query.data?.commercials ?? []) {
      commissionByUser.set(commercial.userId, (commissionByUser.get(commercial.userId) ?? 0) + commercial.total);
    }
  }

  const loading = leadsLoading || proposalsLoading || salesLoading || commissionsLoading;

  const rows: MemberPerformance[] = useMemo(() => {
    return filteredMembers.map((member) => {
      const memberLeadRows = trafficFilteredLeads.filter((lead) => lead.assigned_to === member.user_id);
      const memberLeads = memberLeadRows.length;
      const wonLeads = memberLeadRows.filter((lead) => lead.status && convertedStatusKeys.has(lead.status)).length;
      const memberProposals = proposalsInPeriod.filter((proposal) => proposal.created_by === member.user_id);
      const openProposalValue = memberProposals
        .filter((proposal) => proposal.status === "draft" || proposal.status === "sent" || proposal.status === "negotiating")
        .reduce((sum, proposal) => sum + (proposal.total_value || 0), 0);
      // The sale belongs to whoever it was assigned to; created_by is only
      // the fallback for sales made before assignment existed.
      const memberSales = (salesData || []).filter(
        (sale: any) => (sale.seller_id || sale.created_by) === member.user_id,
      );
      const delivered = memberSales.filter((sale) => sale.status === "delivered" || sale.status === "completed");
      const commission = commissionByUser.get(member.user_id) ?? 0;
      // Conversion is lead-based: how many of the member's leads were won.
      const conversionRate = memberLeads > 0 ? (wonLeads / memberLeads) * 100 : 0;

      return {
        userId: member.user_id,
        name: member.full_name + (member.user_id === user?.id ? t(" (eu)") : ""),
        leads: memberLeads,
        wonLeads,
        proposals: memberProposals.length,
        openProposalValue,
        salesDelivered: sumOperationalSaleUnits(delivered),
        commission,
        conversionRate,
      };
    });
  }, [filteredMembers, trafficFilteredLeads, proposalsInPeriod, salesData, user?.id, convertedStatusKeys, commissionByUser, t]);

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, row) => ({
        leads: acc.leads + row.leads,
        wonLeads: acc.wonLeads + row.wonLeads,
        proposals: acc.proposals + row.proposals,
        openProposalValue: acc.openProposalValue + row.openProposalValue,
        salesDelivered: acc.salesDelivered + row.salesDelivered,
        commission: acc.commission + row.commission,
      }),
      { leads: 0, wonLeads: 0, proposals: 0, openProposalValue: 0, salesDelivered: 0, commission: 0 },
    );
  }, [rows]);

  const totalConversion = totals.leads > 0 ? (totals.wonLeads / totals.leads) * 100 : 0;
  const showTotals = rows.length > 1;
  const scopeLabel = getScopeLabel(dataScope, selectedMemberName, isTeamLeader);

  return (
    <Card ref={cardRef} data-module="team">
      <CardHeader className="px-4 pb-1 pt-3.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            <CardTitle className="truncate text-sm font-semibold">{t("Desempenho da equipa")}</CardTitle>
            <span className="truncate text-xs text-muted-foreground" title={scopeLabel}>{currentMonthLabel}</span>
          </div>
          <PrintCardButton targetRef={cardRef} />
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-3 pt-0">
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : (
          <div className="-mx-4 overflow-x-auto sm:mx-0">
            <Table className="[&_:is(th,td)]:whitespace-nowrap [&_:is(th,td)]:px-2 [&_:is(th,td):first-child]:pl-4 sm:[&_:is(th,td):first-child]:pl-0 [&_:is(th,td):last-child]:pr-4 sm:[&_:is(th,td):last-child]:pr-0 [&_th]:h-8">
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">{t("Colaborador")}</TableHead>
                  <TableHead className="text-xs text-right">{t("Leads")}</TableHead>
                  <TableHead className="text-xs text-right">{t("Propostas")}</TableHead>
                  <TableHead className="team-col-open text-xs text-right hidden sm:table-cell" title={t("Valor das propostas em aberto")}>{t("Em aberto")}</TableHead>
                  <TableHead className="text-xs text-right">{t("Vendas")}</TableHead>
                  <TableHead className="text-xs text-right hidden sm:table-cell" title={t("A mesma comissão de Vendas → Comissões, somada pelos meses do período")}>{t("Comissão")}</TableHead>
                  <TableHead className="text-xs text-right">{t("Conversão")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  // A team leader sees his team's leads and proposals, but
                  // never a colleague's pay — that stays between the person
                  // and an admin.
                  const canSeeCommission = isAdmin || row.userId === user?.id;
                  return (
                    <TableRow key={row.userId}>
                      <TableCell className="text-xs py-1.5 font-medium">{row.name}</TableCell>
                      <TableCell className="text-xs text-right py-1.5">{row.leads}</TableCell>
                      <TableCell className="text-xs text-right py-1.5">{row.proposals}</TableCell>
                      <TableCell className="team-col-open text-xs text-right py-1.5 hidden sm:table-cell">{formatCurrency(row.openProposalValue)}</TableCell>
                      <TableCell className="text-xs text-right py-1.5">{formatOperationalUnits(row.salesDelivered)}</TableCell>
                      <TableCell className="text-xs text-right py-1.5 hidden sm:table-cell text-primary font-medium">
                        {canSeeCommission && commissionMonths ? formatCurrency(row.commission) : '—'}
                      </TableCell>
                      <TableCell className="text-xs text-right py-1.5 font-medium">
                        <span className={getConversionTone(row.conversionRate)}>{row.conversionRate.toFixed(0)}%</span>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {showTotals && (
                  <TableRow className="bg-muted/20 hover:bg-muted/20">
                    <TableCell className="text-xs font-semibold py-1.5">{t("Total")}</TableCell>
                    <TableCell className="text-xs text-right font-semibold py-1.5">{totals.leads}</TableCell>
                    <TableCell className="text-xs text-right font-semibold py-1.5">{totals.proposals}</TableCell>
                    <TableCell className="team-col-open text-xs text-right font-semibold py-1.5 hidden sm:table-cell">{formatCurrency(totals.openProposalValue)}</TableCell>
                    <TableCell className="text-xs text-right font-semibold py-1.5">{formatOperationalUnits(totals.salesDelivered)}</TableCell>
                    <TableCell className="text-xs text-right font-semibold py-1.5 hidden sm:table-cell text-primary">
                      {/* A team-wide total is still someone else's money once
                          the team has more than one member — only an admin
                          gets the aggregate. */}
                      {isAdmin && commissionMonths ? formatCurrency(totals.commission) : '—'}
                    </TableCell>
                    <TableCell className="text-xs text-right font-semibold py-1.5">
                      <span className={getConversionTone(totalConversion)}>{totalConversion.toFixed(0)}%</span>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
