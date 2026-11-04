import { useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";
import { useTeamFilter } from "@/hooks/useTeamFilter";
import { useCommitments } from "@/hooks/useCommitments";
import { useTeamMembers } from "@/hooks/useTeam";
import { useDashboardPeriod } from "@/stores/useDashboardPeriod";
import { useModules } from "@/hooks/useModules";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Target, Pencil, Plus } from "lucide-react";
import { format, startOfMonth } from "date-fns";
import { dateLocale, intlLocale, useLanguage } from "@/i18n";
import { EditCommitmentModal } from "./EditCommitmentModal";
import { Skeleton } from "@/components/ui/skeleton";
import { PrintCardButton } from "./PrintCardButton";

function formatCurrency(val: number) {
  return new Intl.NumberFormat(intlLocale(), { style: "currency", currency: "EUR" }).format(val);
}

function formatNumber(val: number) {
  return new Intl.NumberFormat(intlLocale(), { maximumFractionDigits: 2 }).format(val);
}

interface RowData {
  userId: string;
  name: string;
  nifs: number;
  instalacoes: number;
  energia: number;
  solar: number;
  comissao: number;
  hasCommitment: boolean;
}

export function CommitmentPanel() {
  const { t } = useLanguage();
  const { user, profile, organization } = useAuth();
  const { isAdmin } = usePermissions();
  const { data: members = [] } = useTeamMembers();
  const { selectedMemberId } = useTeamFilter();
  const { selectedMonth } = useDashboardPeriod();
  const { commitment, isLoading, allCommitments, allLoading } = useCommitments(user?.id, selectedMonth);
  const { modules } = useModules();
  const [editOpen, setEditOpen] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const isTelecom = organization?.niche === 'telecom';
  const showEnergy = isTelecom && modules.energy;
  const currentMonthLabel = format(startOfMonth(selectedMonth), "MMMM yyyy", { locale: dateLocale() });

  const buildRows = (): RowData[] => {
    if (isAdmin) {
      const memberRows = members.map((m) => {
        const mc = allCommitments.find((c) => c.user_id === m.user_id);
        return {
          userId: m.user_id,
          name: m.full_name + (m.user_id === user?.id ? t(" (eu)") : ""),
          nifs: Number(mc?.total_nifs || 0),
          instalacoes: Number(mc?.total_instalacoes || 0),
          energia: Number(mc?.total_energia_mwh || 0),
          solar: Number(mc?.total_solar_kwp || 0),
          comissao: Number(mc?.total_comissao || 0),
          hasCommitment: !!mc,
        };
      });
      if (user?.id && !memberRows.some((r) => r.userId === user.id) && commitment) {
        memberRows.unshift({
          userId: user.id,
          name: (profile?.full_name || t("Eu")) + t(" (eu)"),
          nifs: Number(commitment.total_nifs || 0),
          instalacoes: Number(commitment.total_instalacoes || 0),
          energia: Number(commitment.total_energia_mwh || 0),
          solar: Number(commitment.total_solar_kwp || 0),
          comissao: Number(commitment.total_comissao || 0),
          hasCommitment: true,
        });
      }
      return memberRows;
    }
    return [{
      userId: user?.id || "",
      name: profile?.full_name || t("Eu"),
      nifs: Number(commitment?.total_nifs || 0),
      instalacoes: Number(commitment?.total_instalacoes || 0),
      energia: Number(commitment?.total_energia_mwh || 0),
      solar: Number(commitment?.total_solar_kwp || 0),
      comissao: Number(commitment?.total_comissao || 0),
      hasCommitment: !!commitment,
    }];
  };

  const allRows = buildRows();
  const rows = selectedMemberId ? allRows.filter((r) => r.userId === selectedMemberId) : allRows;
  const loading = isLoading || allLoading;

  const totals = rows.reduce(
    (acc, r) => ({
      nifs: acc.nifs + r.nifs,
      instalacoes: acc.instalacoes + r.instalacoes,
      energia: acc.energia + r.energia,
      solar: acc.solar + r.solar,
      comissao: acc.comissao + r.comissao,
    }),
    { nifs: 0, instalacoes: 0, energia: 0, solar: 0, comissao: 0 }
  );

  return (
    <>
      <Card ref={cardRef}>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <Target className="h-5 w-5 text-primary" />
              <CardTitle className="text-base capitalize">
                {t("Compromisso — {{month}}", { month: currentMonthLabel })}
              </CardTitle>
            </div>
            <div className="flex items-center gap-1">
              <PrintCardButton targetRef={cardRef} />
              <Button variant="ghost" size="icon-sm" onClick={() => setEditOpen(true)}>
                {commitment ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : rows.every((r) => !r.hasCommitment) ? (
            <div className="text-center py-6">
              <p className="text-sm text-muted-foreground mb-3">{t("Nenhum compromisso definido para este mês.")}</p>
              <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
                <Plus className="h-4 w-4 mr-1" /> {t("Definir Compromisso")}
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">{t("Colaborador")}</TableHead>
                  <TableHead className="text-xs text-right">NIFs</TableHead>
                  {isTelecom && <TableHead className="text-xs text-right">{t("Instalações")}</TableHead>}
                  {showEnergy && <TableHead className="text-xs text-right">{t("Energia (MWh)")}</TableHead>}
                  {showEnergy && <TableHead className="text-xs text-right hidden sm:table-cell">Solar (kWp)</TableHead>}
                  <TableHead className="text-xs text-right">{t("Comissão")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.userId}>
                    <TableCell className="text-xs py-1.5 font-medium">{row.name}</TableCell>
                    <TableCell className="text-xs text-right py-1.5">{row.nifs}</TableCell>
                    {isTelecom && <TableCell className="text-xs text-right py-1.5">{row.instalacoes}</TableCell>}
                    {showEnergy && <TableCell className="text-xs text-right py-1.5">{formatNumber(row.energia)}</TableCell>}
                    {showEnergy && <TableCell className="text-xs text-right py-1.5 hidden sm:table-cell">{formatNumber(row.solar)}</TableCell>}
                    <TableCell className="text-xs text-right py-1.5 font-medium text-green-500">{formatCurrency(row.comissao)}</TableCell>
                  </TableRow>
                ))}
                {isAdmin && rows.length > 1 && (
                  <TableRow className="bg-muted/20 hover:bg-muted/20">
                    <TableCell className="text-xs font-semibold py-1.5">{t("TOTAL")}</TableCell>
                    <TableCell className="text-xs text-right font-semibold py-1.5">{totals.nifs}</TableCell>
                    {isTelecom && <TableCell className="text-xs text-right font-semibold py-1.5">{totals.instalacoes}</TableCell>}
                    {showEnergy && <TableCell className="text-xs text-right font-semibold py-1.5">{formatNumber(totals.energia)}</TableCell>}
                    {showEnergy && <TableCell className="text-xs text-right font-semibold py-1.5 hidden sm:table-cell">{formatNumber(totals.solar)}</TableCell>}
                    <TableCell className="text-xs text-right font-semibold py-1.5 text-green-500">{formatCurrency(totals.comissao)}</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <EditCommitmentModal
        open={editOpen}
        onOpenChange={setEditOpen}
        existing={commitment ? {
          total_nifs: Number(commitment.total_nifs),
          total_instalacoes: Number(commitment.total_instalacoes),
          total_energia_mwh: Number(commitment.total_energia_mwh),
          total_solar_kwp: Number(commitment.total_solar_kwp),
          total_comissao: Number(commitment.total_comissao),
        } : null}
      />
    </>
  );
}
