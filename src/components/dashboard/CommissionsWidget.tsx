import { useMemo } from "react";
import { Link } from "react-router-dom";
import { format, startOfMonth } from "date-fns";
import { ArrowRight, Percent } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useCommercialCommissions } from "@/hooks/useCommercialCommissions";
import { useAuth } from "@/contexts/AuthContext";
import { useDashboardPeriod } from "@/stores/useDashboardPeriod";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/i18n";

/**
 * The logged-in user's own commissions for the dashboard period, counted the
 * same way as Financeiro → Comissões (earned as the client pays).
 */
export function CommissionsWidget() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const { from, to } = useDashboardPeriod();
  const month = useMemo(() => format(startOfMonth(new Date()), "yyyy-MM-dd"), []);
  const dateRange = from ? { from, to: to ?? undefined } : undefined;
  const { data, isLoading } = useCommercialCommissions(month, null, { dateRange });
  const mine = data?.commercials.find((commercial) => commercial.userId === user?.id);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Percent className="h-4 w-4" />
          {t("As minhas comissões")}
        </CardTitle>
        <Link to="/financeiro?tab=comissoes" className="flex items-center gap-1 text-xs font-medium text-primary hover:underline">
          {t("Ver")}<ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </CardHeader>
      <CardContent>
        {isLoading ? <Skeleton className="h-16 w-full" /> : !mine ? (
          <p className="text-sm text-muted-foreground">{t("Sem comissões neste período.")}</p>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg border bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">{t("Ganhas")}</p>
              <p className="text-lg font-bold tabular-nums">{formatCurrency(mine.total)}</p>
            </div>
            <div className="rounded-lg border bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">{t("Por pagar")}</p>
              <p className={cn("text-lg font-bold tabular-nums", mine.totalPending > 0.005 && "text-amber-600 dark:text-amber-400")}>
                {formatCurrency(mine.totalPending)}
              </p>
            </div>
            <div className="rounded-lg border bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">{t("A ganhar")}</p>
              <p className="text-lg font-bold tabular-nums text-muted-foreground">{formatCurrency(mine.toEarn)}</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
