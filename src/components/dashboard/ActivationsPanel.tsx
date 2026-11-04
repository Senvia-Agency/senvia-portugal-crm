import { useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";
import { useTeamFilter } from "@/hooks/useTeamFilter";
import { useTeamMembers } from "@/hooks/useTeam";
import { useActivationObjectives, type ActivationCountMode } from "@/hooks/useActivationObjectives";
import { useDashboardPeriod } from "@/stores/useDashboardPeriod";
import { useModules } from "@/hooks/useModules";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Zap, Pencil } from "lucide-react";
import { PrintCardButton } from "./PrintCardButton";
import { Skeleton } from "@/components/ui/skeleton";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import { EditActivationObjectivesModal } from "./EditActivationObjectivesModal";
import { intlLocale, useLanguage } from "@/i18n";

function percentColor(pct: number) {
  if (pct >= 100) return "text-green-500";
  if (pct >= 50) return "text-amber-500";
  return "text-red-500";
}

function donutColor(pct: number) {
  if (pct >= 100) return "hsl(142, 71%, 45%)";
  if (pct >= 50) return "hsl(38, 92%, 50%)";
  return "hsl(0, 84%, 60%)";
}

interface ActivationBlockProps {
  title: string;
  periodType: "monthly" | "annual";
  proposalType: "energia" | "servicos";
  members: { user_id: string; full_name: string }[];
  filteredMembers: { user_id: string; full_name: string }[];
  currentUserId?: string;
  isAdmin: boolean;
  getTarget: (userId: string, periodType: "monthly" | "annual", proposalType: "energia" | "servicos") => number;
  countActivations: (
    userId: string | null,
    periodType: "monthly" | "annual",
    proposalType: "energia" | "servicos",
    countMode?: ActivationCountMode
  ) => number;
  onEdit: () => void;
  unit?: string;
}

function ActivationBlock({
  title,
  periodType,
  proposalType,
  filteredMembers,
  currentUserId,
  isAdmin,
  getTarget,
  countActivations,
  onEdit,
  unit: unitOverride,
}: ActivationBlockProps) {
  const { t } = useLanguage();
  const unit = unitOverride || (proposalType === "energia" ? "MWh" : "kWp");
  const formatVal = (v: number) => new Intl.NumberFormat(intlLocale(), { maximumFractionDigits: 2 }).format(v);

  const rows = filteredMembers.map((m) => {
    const target = getTarget(m.user_id, periodType, proposalType);
    const actual = countActivations(m.user_id, periodType, proposalType);
    const pct = target > 0 ? Math.round((actual / target) * 100) : 0;
    return { userId: m.user_id, name: m.full_name + (m.user_id === currentUserId ? t(" (eu)") : ""), target, actual, pct };
  });

  const totalTarget = rows.reduce((a, r) => a + r.target, 0);
  const totalActual = rows.reduce((a, r) => a + r.actual, 0);
  const totalPct = totalTarget > 0 ? Math.round((totalActual / totalTarget) * 100) : 0;
  const showTotals = isAdmin && rows.length > 1;

  const donutData = [
    { name: "done", value: Math.min(totalPct, 100) },
    { name: "remaining", value: Math.max(100 - totalPct, 0) },
  ];

  const blockRef = useRef<HTMLDivElement>(null);

  return (
    <Card ref={blockRef}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-semibold">{title}</CardTitle>
          <div className="flex items-center gap-1">
            <PrintCardButton targetRef={blockRef} />
            {isAdmin && periodType === "annual" && (
              <Button variant="ghost" size="icon-sm" onClick={onEdit}>
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        {/* Donut + Summary */}
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 flex-shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={donutData}
                  innerRadius={20}
                  outerRadius={30}
                  dataKey="value"
                  startAngle={90}
                  endAngle={-270}
                  strokeWidth={0}
                >
                  <Cell fill={donutColor(totalPct)} />
                  <Cell fill="hsl(var(--muted))" />
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2">
              <span className={`text-2xl font-bold ${percentColor(totalPct)}`}>{totalPct}%</span>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("{{actual}} de {{target}} {{unit}}", { actual: formatVal(totalActual), target: formatVal(totalTarget), unit })}
            </p>
          </div>
        </div>

        {/* Per-consultant table */}
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">{t("Consultor")}</TableHead>
                <TableHead className="text-xs text-right">{t("Obj.")}</TableHead>
                <TableHead className="text-xs text-right">{t("Ativ.")}</TableHead>
                <TableHead className="text-xs text-right">%</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.userId}>
                  <TableCell className="text-xs py-1.5 font-medium whitespace-nowrap">{row.name}</TableCell>
                  <TableCell className="text-xs text-right py-1.5">{formatVal(row.target)}</TableCell>
                  <TableCell className="text-xs text-right py-1.5">{formatVal(row.actual)}</TableCell>
                  <TableCell className={`text-xs text-right py-1.5 font-medium ${percentColor(row.pct)}`}>
                    {row.target > 0 ? `${row.pct}%` : "—"}
                  </TableCell>
                </TableRow>
              ))}
              {showTotals && (
                <TableRow className="bg-muted/20 hover:bg-muted/20">
                  <TableCell className="text-xs font-semibold py-1.5">{t("TOTAL")}</TableCell>
                  <TableCell className="text-xs text-right font-semibold py-1.5">{formatVal(totalTarget)}</TableCell>
                  <TableCell className="text-xs text-right font-semibold py-1.5">{formatVal(totalActual)}</TableCell>
                  <TableCell className={`text-xs text-right font-semibold py-1.5 ${percentColor(totalPct)}`}>
                    {totalTarget > 0 ? `${totalPct}%` : "—"}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

export function ActivationsPanel() {
  const { t } = useLanguage();
  const { user, profile, organization } = useAuth();
  const { isAdmin } = usePermissions();
  const { data: members = [] } = useTeamMembers();
  const { selectedMemberId } = useTeamFilter();
  const { selectedMonth } = useDashboardPeriod();
  const { isLoading, getTarget, countActivations } = useActivationObjectives(selectedMonth);
  const { modules } = useModules();

  const showEnergy = organization?.niche === 'telecom' && modules.energy;

  const [editModal, setEditModal] = useState<{
    open: boolean;
    periodType: "monthly" | "annual";
    proposalType: "energia" | "servicos";
  }>({ open: false, periodType: "monthly", proposalType: "energia" });

  const memberList = members.length > 0
    ? members
    : user?.id
      ? [{ user_id: user.id, full_name: profile?.full_name || t("Eu") }]
      : [];

  const filteredMembers = selectedMemberId
    ? memberList.filter((m) => m.user_id === selectedMemberId)
    : memberList;

  const openEdit = (periodType: "monthly" | "annual", proposalType: "energia" | "servicos") => {
    setEditModal({ open: true, periodType, proposalType });
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-primary" />
            <CardTitle className="text-base">{t("Ativações")}</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[1, 2].map((i) => (
              <Skeleton key={i} className="h-48 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const servicosUnit = showEnergy ? "kWp" : t("contratos");
  const servicosCountActivations = showEnergy
    ? countActivations
    : (
        userId: string | null,
        periodType: "monthly" | "annual",
        proposalType: "energia" | "servicos",
        countMode: ActivationCountMode = "count"
      ) => countActivations(userId, periodType, proposalType, countMode);

  const blockProps = {
    members: memberList,
    filteredMembers,
    currentUserId: user?.id,
    isAdmin,
    getTarget,
    countActivations,
  };

  return (
    <>
      <div className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <Zap className="h-4 w-4" />
          {t("Ativações")}
        </h3>

        {/* Monthly row */}
        <div className={`grid grid-cols-1 ${showEnergy ? 'md:grid-cols-2' : ''} gap-4`}>
          {showEnergy && (
            <ActivationBlock
              title={t("Energia — Mensal")}
              periodType="monthly"
              proposalType="energia"
              {...blockProps}
              onEdit={() => openEdit("monthly", "energia")}
            />
          )}
          <ActivationBlock
            title={t("Serviços — Mensal")}
            periodType="monthly"
            proposalType="servicos"
            {...blockProps}
            countActivations={servicosCountActivations}
            unit={servicosUnit}
            onEdit={() => openEdit("monthly", "servicos")}
          />
        </div>

        {/* Annual row */}
        <div className={`grid grid-cols-1 ${showEnergy ? 'md:grid-cols-2' : ''} gap-4`}>
          {showEnergy && (
            <ActivationBlock
              title={t("Energia — Anual")}
              periodType="annual"
              proposalType="energia"
              {...blockProps}
              onEdit={() => openEdit("annual", "energia")}
            />
          )}
          <ActivationBlock
            title={t("Serviços — Anual")}
            periodType="annual"
            proposalType="servicos"
            {...blockProps}
            countActivations={servicosCountActivations}
            unit={servicosUnit}
            onEdit={() => openEdit("annual", "servicos")}
          />
        </div>
      </div>

      <EditActivationObjectivesModal
        open={editModal.open}
        onOpenChange={(open) => setEditModal((prev) => ({ ...prev, open }))}
        periodType={editModal.periodType}
        proposalType={editModal.proposalType}
        members={memberList}
      />
    </>
  );
}
