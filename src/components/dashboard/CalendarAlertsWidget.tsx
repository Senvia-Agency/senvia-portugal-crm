import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useCalendarEvents } from '@/hooks/useCalendarEvents';
import { useTeamFilter } from '@/hooks/useTeamFilter';
import { Calendar, Phone, Users, CheckSquare, RotateCcw, ChevronRight, Loader2, AlertTriangle, Clock } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useNavigate } from 'react-router-dom';
import { format, isToday, startOfDay, endOfDay, addDays } from 'date-fns';
import { dateLocale, useLanguage } from '@/i18n';
import type { CalendarEvent, EventType } from '@/types/calendar';
import { EVENT_TYPE_LABELS } from '@/types/calendar';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

const EVENT_TYPE_ICONS: Record<EventType, React.ElementType> = {
  meeting: Users,
  call: Phone,
  task: CheckSquare,
  follow_up: RotateCcw,
};

export function CalendarAlertsWidget() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [modalOpen, setModalOpen] = useState(false);
  const today = useMemo(() => startOfDay(new Date()), []);
  const endRange = useMemo(() => endOfDay(addDays(today, 7)), [today]);

  const { data: events, isLoading } = useCalendarEvents(today, endRange);
  const { effectiveUserIds } = useTeamFilter();

  const { todayEvents, upcomingEvents } = useMemo(() => {
    const allowedUserIds = effectiveUserIds ? new Set(effectiveUserIds) : null;
    const scopedEvents = allowedUserIds
      ? (events || []).filter((event) => allowedUserIds.has(event.user_id))
      : (events || []);

    const pending = scopedEvents.filter(e => e.status === 'pending');
    return {
      todayEvents: pending.filter(e => isToday(new Date(e.start_time))),
      upcomingEvents: pending.filter(e => !isToday(new Date(e.start_time))),
    };
  }, [events, effectiveUserIds]);

  const totalAlerts = todayEvents.length + upcomingEvents.length;
  const allEvents = [...todayEvents, ...upcomingEvents];
  const previewItems = allEvents.slice(0, 4);
  const remaining = totalAlerts - previewItems.length;

  // Loading and empty fit on the title line: an empty week is one fact, not a
  // card's worth of blank space.
  if (isLoading || totalAlerts === 0) {
    return (
      <Card data-module="calendar">
        <CardHeader className="flex-row items-center justify-between gap-3 space-y-0 px-4 py-3">
          <CardTitle className="flex shrink-0 items-center gap-2 whitespace-nowrap text-sm font-semibold">
            <Calendar className="h-4 w-4 text-primary" />
            {t("Próximos eventos")}
          </CardTitle>
          {isLoading
            ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            : <span className="truncate text-xs text-muted-foreground">{t("Sem eventos nos próximos 7 dias")}</span>}
        </CardHeader>
      </Card>
    );
  }

  const renderEvent = (event: CalendarEvent, variant: 'today' | 'upcoming') => {
    const Icon = EVENT_TYPE_ICONS[event.event_type as EventType] || Calendar;
    const bgClass = variant === 'today'
      ? 'bg-destructive/5 hover:bg-destructive/10 border-destructive/20'
      : 'bg-blue-500/5 hover:bg-blue-500/10 border-blue-500/20';

    return (
      <button
        onClick={() => navigate('/calendar')}
        className={`w-full text-left p-3 rounded-md transition-colors border ${bgClass}`}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="text-sm font-medium truncate">{event.title}</span>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
        </div>
        <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5">
          <span>{t(EVENT_TYPE_LABELS[event.event_type as EventType])}</span>
          <span>•</span>
          <span>
            {event.all_day
              ? (variant === 'today' ? t('Hoje, dia inteiro') : format(new Date(event.start_time), "EEE dd/MM", { locale: dateLocale() }))
              : format(new Date(event.start_time), variant === 'today' ? "HH:mm" : t("EEE dd/MM 'às' HH:mm"), { locale: dateLocale() })
            }
          </span>
          {event.lead && (
            <>
              <span>•</span>
              <span className="truncate">{event.lead.name}</span>
            </>
          )}
        </div>
      </button>
    );
  };

  return (
    <>
      <Card
        data-module="calendar"
        className="cursor-pointer hover:border-primary/30 transition-colors"
        onClick={() => setModalOpen(true)}
      >
        <CardHeader className="px-4 pb-1.5 pt-3.5">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Calendar className="h-4 w-4 text-primary" />
              {t("Próximos eventos")}
            </CardTitle>
            <Badge variant="secondary" className="text-xs">{totalAlerts}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-0.5 px-4 pb-3 pt-0">
          {previewItems.map((event) => (
            <div key={event.id} className="flex items-center justify-between gap-3 py-0.5 text-[13px]">
              <span className="min-w-0 truncate">{event.title}</span>
              <span className={cn("shrink-0 text-xs tabular-nums", isToday(new Date(event.start_time)) ? "font-medium text-destructive" : "text-muted-foreground")}>
                {isToday(new Date(event.start_time))
                  ? (event.all_day ? t("Hoje") : t("Hoje {{time}}", { time: format(new Date(event.start_time), "HH:mm") }))
                  : format(new Date(event.start_time), event.all_day ? "EEE dd/MM" : "EEE dd/MM HH:mm", { locale: dateLocale() })}
              </span>
            </div>
          ))}
          {remaining > 0 && (
            <p className="pt-0.5 text-xs font-medium text-primary">{t(remaining === 1 ? "+ {{n}} evento" : "+ {{n}} eventos", { n: remaining })}</p>
          )}
        </CardContent>
      </Card>

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent variant="fullScreen" className="flex flex-col overflow-hidden p-0 gap-0">
          <DialogHeader className="shrink-0 px-4 pt-4 sm:px-6 sm:pt-6">
            <div className="flex items-center gap-3">
              <DialogTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5 text-primary" />
                {t("Próximos eventos")}
              </DialogTitle>
              <DialogDescription className="sr-only">{t("Lista de eventos pendentes nos próximos 7 dias")}</DialogDescription>
              <Badge variant="secondary">{totalAlerts}</Badge>
            </div>
          </DialogHeader>
          <ScrollArea className="flex-1 px-4 pb-4 sm:px-6 sm:pb-6">
            <div className="space-y-6 pt-2">
              {todayEvents.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-destructive">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    <span className="text-xs font-medium">{t("Hoje")}</span>
                    <Badge variant="destructive" className="text-xs ml-auto">{todayEvents.length}</Badge>
                  </div>
                  <div className="space-y-2">
                    {todayEvents.map(e => <div key={e.id}>{renderEvent(e, 'today')}</div>)}
                  </div>
                </div>
              )}

              {upcomingEvents.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-blue-500">
                    <Clock className="h-3.5 w-3.5" />
                    <span className="text-xs font-medium">{t("Próximos 7 dias")}</span>
                    <Badge variant="outline" className="text-xs ml-auto border-blue-500/50 text-blue-500">{upcomingEvents.length}</Badge>
                  </div>
                  <div className="space-y-2">
                    {upcomingEvents.map(e => <div key={e.id}>{renderEvent(e, 'upcoming')}</div>)}
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  );
}
