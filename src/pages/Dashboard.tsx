import { useState } from "react";
import { format } from "date-fns";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";
import { useDashboardWidgets } from "@/hooks/useDashboardWidgets";
import { useTeamFilter } from "@/hooks/useTeamFilter";
import { EditDashboardModal } from "@/components/dashboard/EditDashboardModal";
import { DynamicWidget } from "@/components/dashboard/DynamicWidget";
import { TeamMemberFilter } from "@/components/dashboard/TeamMemberFilter";
import { FidelizationAlertsWidget } from "@/components/dashboard/FidelizationAlertsWidget";
import { CalendarAlertsWidget } from "@/components/dashboard/CalendarAlertsWidget";
import { TasksWidget } from "@/components/dashboard/TasksWidget";
import { CommitmentPanel } from "@/components/dashboard/CommitmentPanel";
import { SalesPerformancePanel } from "@/components/dashboard/SalesPerformancePanel";
import { MetricsPanel } from "@/components/dashboard/MetricsPanel";
import { CommissionsWidget } from "@/components/dashboard/CommissionsWidget";
import { TeamPerformanceTable } from "@/components/dashboard/TeamPerformanceTable";
import { Loader2, Sparkles, LayoutDashboard, SlidersHorizontal, MoreHorizontal, Printer, MousePointerClick } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Link } from "react-router-dom";
import { NicheType } from "@/lib/dashboard-templates";
import { useRealtimeSubscription } from "@/hooks/useRealtimeSubscription";
import { useModules } from "@/hooks/useModules";
import { ActivationsPanel } from "@/components/dashboard/ActivationsPanel";
import { TelecomLifecyclePanel } from "@/components/dashboard/TelecomLifecyclePanel";
import { PaidTrafficCard } from "@/components/dashboard/PaidTrafficCard";
import { ReferralBanner } from "@/components/referrals/ReferralBanner";
import { dateLocale, useLanguage } from "@/i18n";
import { OttoDashboardSetup } from "@/components/otto/OttoDashboardSetup";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { filterChipClass } from "@/components/shared/filter-pills";
import { usePaidTrafficFilter } from "@/contexts/PaidTrafficFilterContext";
import { useDashboardPeriod } from "@/stores/useDashboardPeriod";
import { TRAFFIC_FILTER_OPTIONS, type TrafficFilterKey } from "@/lib/paid-traffic";
import { cn } from "@/lib/utils";
import "@/components/dashboard/dashboard.css";

// Full-width panels have their own component below; they must not also be
// handed to DynamicWidget, which only knows how to draw the small tiles.
const PANEL_WIDGET_TYPES = new Set([
  'team_performance_table', 'commitment_panel', 'telecom_lifecycle_panel',
  'sales_performance_panel', 'metrics_panel', 'activations_panel',
  'fidelization_alerts_widget', 'calendar_alerts_widget', 'tasks_widget',
  'commissions_widget',
]);

// Tiles that only repeat another one: the leads tile already shows the week,
// the origins and paid traffic; the delivered-sales tile says what is under way.
const ABSORBED_BY: Record<string, string> = {
  leads_trend: 'leads_total',
  leads_social: 'leads_total',
  leads_direct: 'leads_total',
  leads_by_source: 'leads_total',
  sales_active: 'sales_delivered',
};

const printDashboard = () => {
  const originalTitle = document.title;
  document.title = "Senvia OS";
  window.print();
  document.title = originalTitle;
};

export default function Dashboard() {
  useRealtimeSubscription([
    { table: 'leads', queryKeys: [['leads'], ['dashboard-stats']] },
    { table: 'proposals', queryKeys: [['proposals'], ['dashboard-stats']] },
    { table: 'sales', queryKeys: [['sales'], ['dashboard-stats']] },
  ]);
  const { profile, organization } = useAuth();
  const { isAdmin, isSuperAdmin } = usePermissions();
  const [editDashboardOpen, setEditDashboardOpen] = useState(false);
  const { modules } = useModules();
  const isTelecom = organization?.niche === 'telecom';
  const clientsModuleEnabled = modules.clients;
  const calendarModuleEnabled = modules.calendar !== false;
  const salesSettings = (organization?.sales_settings as any) || {};
  const commissionsEnabled = !!salesSettings.commissions_enabled;
  const {
    visibleWidgets,
    isLoading,
    niche,
  } = useDashboardWidgets();
  const isWidgetVisible = (type: string) => visibleWidgets.some((w) => w.widget_type === type);
  const { filterKey, setFilter } = usePaidTrafficFilter();
  const { from, to, setRange } = useDashboardPeriod();
  const { selectedMemberId } = useTeamFilter();
  const canEdit = isAdmin || isSuperAdmin;

  const { t, language } = useLanguage();
  const greeting = profile?.full_name
    ? t('Olá, {{name}}', { name: profile.full_name.split(' ')[0] })
    : t('Olá');
  const today = format(new Date(), language === 'en' ? "EEEE, d MMMM" : "EEEE, d 'de' MMMM", { locale: dateLocale() });

  // Below the numbers: the team on the left (wide), the day on the right.
  const showTeam = isWidgetVisible('team_performance_table');
  const showCommissions = commissionsEnabled && isWidgetVisible('commissions_widget');
  const showTasks = modules.inbox && isWidgetVisible('tasks_widget');
  const showCalendar = calendarModuleEnabled && isWidgetVisible('calendar_alerts_widget');
  const showFidelization = isTelecom && clientsModuleEnabled && isWidgetVisible('fidelization_alerts_widget');
  const metricWidgets = visibleWidgets.filter(w =>
    !PANEL_WIDGET_TYPES.has(w.widget_type)
    && !(ABSORBED_BY[w.widget_type] && isWidgetVisible(ABSORBED_BY[w.widget_type])));
  // Paid traffic rides in the leads tile when there is one.
  const leadsTileShown = metricWidgets.some(w => w.widget_type === 'leads_total');
  const metricCount = metricWidgets.length + (leadsTileShown ? 0 : 1);
  const hasWide = showTeam || showCommissions;
  const hasSide = showTasks || showCalendar || showFidelization;

  return (
    <div className="workplace-dashboard p-4 md:p-6 lg:px-8 lg:py-6">
      <div className="dashboard-header sticky top-0 z-30 -mx-4 md:-mx-6 lg:-mx-8 px-4 md:px-6 lg:px-8 pb-3 pt-3 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/75 border-b">
        <PageHeader
          icon={LayoutDashboard}
          title={greeting}
          subtitle={today.charAt(0).toUpperCase() + today.slice(1)}
          className="mb-0"
          actions={
            <div className="dashboard-actions">
              <DateRangePicker
                value={from ? { from, to: to ?? from } : undefined}
                onChange={setRange}
                placeholder={t("Todo o histórico")}
                className={cn(filterChipClass(false), 'w-auto justify-start [&_svg]:mr-0')}
              />
              <Select value={filterKey} onValueChange={(v) => setFilter(v as TrafficFilterKey)}>
                <SelectTrigger aria-label={t("Origem das leads")} className={cn(filterChipClass(filterKey !== 'all'), 'w-auto gap-1.5 [&>span]:max-w-[9rem] [&>span]:truncate')}>
                  <MousePointerClick className="h-3.5 w-3.5 shrink-0" />
                  <SelectValue>
                    {filterKey === 'all' ? t('Todas as origens') : TRAFFIC_FILTER_OPTIONS.find(opt => opt.value === filterKey)?.label}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {TRAFFIC_FILTER_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <TeamMemberFilter className={cn(filterChipClass(!!selectedMemberId), 'w-auto gap-1 [&>svg:first-child]:mr-0 [&>span]:max-w-[10rem] [&>span]:truncate')} />
              {/* The rare actions: what's new, printing, choosing the widgets. */}
              <DropdownMenu>
                <DropdownMenuTrigger className={cn(filterChipClass(false), 'w-9 justify-center px-0')} aria-label={t("Mais ações do painel")}>
                  <MoreHorizontal className="h-4 w-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuItem asChild>
                    <Link to="/novidades"><Sparkles className="mr-2 h-4 w-4" />{t("O que há de novo")}</Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={printDashboard}><Printer className="mr-2 h-4 w-4" />{t("Imprimir painel")}</DropdownMenuItem>
                  {canEdit && <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => setEditDashboardOpen(true)}><SlidersHorizontal className="mr-2 h-4 w-4" />{t("Editar painel")}</DropdownMenuItem>
                  </>}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          }
        />
      </div>

      <OttoDashboardSetup />

      {isLoading ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : (
        <div className="space-y-4 pt-4">
          {/* The numbers first, small, in one strip: a single row on a wide screen
              while they fit (up to seven), wrapping evenly otherwise. */}
          <div className={cn(
            "dashboard-metrics grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))]",
            metricCount <= 7 && "xl:grid-flow-col xl:auto-cols-fr xl:grid-cols-none",
          )}>
            {metricWidgets.map((widget) => (
              <DynamicWidget
                key={widget.id || widget.widget_type}
                widgetType={widget.widget_type as any}
                niche={niche as NicheType}
                withPaidTraffic={widget.widget_type === 'leads_total'}
              />
            ))}
            {!leadsTileShown && <PaidTrafficCard />}
          </div>

          <ReferralBanner />

          {isTelecom && (
            <div className="space-y-4">
              <h2 className="dashboard-section-title text-sm font-semibold text-muted-foreground uppercase tracking-wider">{t("Atividade Comercial")}</h2>
              <div className="space-y-4">
                {isWidgetVisible('commitment_panel') && <CommitmentPanel />}
                {isWidgetVisible('telecom_lifecycle_panel') && <TelecomLifecyclePanel />}
                {isWidgetVisible('sales_performance_panel') && <SalesPerformancePanel />}
                {isWidgetVisible('metrics_panel') && <MetricsPanel />}
                {isWidgetVisible('activations_panel') && <ActivationsPanel />}
              </div>
            </div>
          )}

          {(hasWide || hasSide) && (
            <div className={cn("grid items-start gap-4", hasWide && hasSide && "lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]")}>
              {hasWide && (
                <div className="min-w-0 space-y-4">
                  {showTeam && <TeamPerformanceTable />}
                  {showCommissions && <CommissionsWidget />}
                </div>
              )}
              {hasSide && (
                <div className={cn("dashboard-alerts min-w-0 gap-4", hasWide ? "flex flex-col" : "grid lg:grid-cols-2")}>
                  {showTasks && <TasksWidget />}
                  {showCalendar && <CalendarAlertsWidget />}
                  {showFidelization && <FidelizationAlertsWidget />}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {visibleWidgets.length === 0 && !isLoading && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <p className="text-muted-foreground">
            {canEdit
              ? t('Nenhum widget escolhido. Usa "Editar painel" no ⋯ acima para escolher o que queres ver.')
              : t('Nenhum widget configurado para o seu perfil. Contacte o administrador para personalizar o dashboard.')}
          </p>
        </div>
      )}

      <EditDashboardModal open={editDashboardOpen} onOpenChange={setEditDashboardOpen} />
    </div>
  );
}
