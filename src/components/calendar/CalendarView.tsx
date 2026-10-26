import { useState, useMemo, useEffect } from 'react';
import { addMonths, subMonths, addWeeks, subWeeks, addDays, subDays, startOfMonth, endOfMonth, startOfWeek, endOfWeek, startOfDay, endOfDay, isSameDay, isWithinInterval } from 'date-fns';
import { useAuth } from '@/contexts/AuthContext';
import { usePersistedState } from '@/hooks/usePersistedState';
import { useOpenInboxTasks, isTaskOverdue } from '@/hooks/useInboxTasks';
import { useInterfaceStore } from '@/stores/useInterfaceStore';
import { useCalendarEvents } from '@/hooks/useCalendarEvents';
import { useTeamMembers } from '@/hooks/useTeam';
import { useTeamFilter } from '@/hooks/useTeamFilter';
import { CalendarHeader, type ViewType } from './CalendarHeader';
import { MonthView } from './MonthView';
import { WeekView } from './WeekView';
import { DayView } from './DayView';
import { DayEventsList } from './DayEventsList';
import { AgendaListView } from './AgendaListView';
import { CalendarLayersPanel } from './CalendarLayersPanel';
import { portugueseHolidays, type CalendarLayer, type CalendarMarker } from './calendar-layers';
import { CreateEventModal } from './CreateEventModal';
import { EventDetailsModal } from './EventDetailsModal';
import type { CalendarEvent } from '@/types/calendar';
import { Loader2 } from 'lucide-react';
import './agenda.css';

const AGENDA_DAYS = 30;
const NO_LAYERS: CalendarLayer[] = [];

export function CalendarView() {
  // Versão antiga keeps the original three views, side list and every event visible.
  const legacy = useInterfaceStore((state) => state.legacy);
  const { user } = useAuth();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState<ViewType>('month');
  const activeView: ViewType = legacy && view === 'agenda' ? 'month' : view;
  const [hiddenLayers, setHiddenLayers] = usePersistedState<CalendarLayer[]>('calendar-hidden-layers-v1', []);
  const hidden = legacy ? NO_LAYERS : hiddenLayers;
  const toggleLayer = (layer: CalendarLayer) => setHiddenLayers((current) => current.includes(layer) ? current.filter((key) => key !== layer) : [...current, layer]);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [detailsModalOpen, setDetailsModalOpen] = useState(false);
  const [selectedDayForList, setSelectedDayForList] = useState<Date>(new Date());

  const { canFilterByTeam, selectedMemberId, setSelectedMemberId } = useTeamFilter();
  const { data: teamMembers = [] } = useTeamMembers();

  // Calculate date range based on view
  const dateRange = useMemo(() => {
    switch (activeView) {
      case 'month': {
        const monthStart = startOfMonth(currentDate);
        const monthEnd = endOfMonth(currentDate);
        return {
          start: startOfWeek(monthStart, { weekStartsOn: 1 }),
          end: endOfWeek(monthEnd, { weekStartsOn: 1 }),
        };
      }
      case 'week': {
        return {
          start: startOfWeek(currentDate, { weekStartsOn: 1 }),
          end: endOfWeek(currentDate, { weekStartsOn: 1 }),
        };
      }
      case 'day':
        return {
          start: startOfDay(currentDate),
          end: endOfDay(currentDate),
        };
      case 'agenda':
        return {
          start: startOfDay(currentDate),
          end: endOfDay(addDays(currentDate, AGENDA_DAYS - 1)),
        };
    }
  }, [currentDate, activeView]);

  // useCalendarEvents já filtra baseado no effectiveUserId do useTeamFilter
  const { data: events = [], isLoading } = useCalendarEvents(dateRange.start, dateRange.end);
  const { data: openTasks = [] } = useOpenInboxTasks(!legacy);
  const visibleEvents = useMemo(() => events.filter((event) => !hidden.includes(event.event_type)), [events, hidden]);

  // Holidays and open task deadlines in range, as calendar layers the panel can hide.
  const markers = useMemo(() => {
    if (legacy) return [];
    const range = { start: dateRange.start, end: dateRange.end };
    const list: CalendarMarker[] = [];
    if (!hidden.includes('holidays')) {
      for (let year = range.start.getFullYear(); year <= range.end.getFullYear(); year++) {
        for (const holiday of portugueseHolidays(year)) {
          if (isWithinInterval(holiday.date, range)) list.push({ key: `holiday-${holiday.date.toISOString()}`, layer: 'holidays', title: holiday.name, date: holiday.date, allDay: true });
        }
      }
    }
    if (!hidden.includes('deadlines')) {
      // The chosen colleague's deadlines; otherwise everyone's for who filters the team, or only mine.
      const owner = selectedMemberId ?? (canFilterByTeam ? null : user?.id ?? null);
      for (const task of openTasks) {
        if (!task.due_at) continue;
        const due = new Date(task.due_at);
        if (!isWithinInterval(due, range) || (owner && (task.assigned_to ?? task.created_by) !== owner)) continue;
        list.push({
          key: `task-${task.id}`, layer: 'deadlines', title: task.title, date: due, allDay: false, overdue: isTaskOverdue(task),
          href: task.contact_phone ? `/inbox?phone=${encodeURIComponent(task.contact_phone)}` : '/inbox',
        });
      }
    }
    return list;
  }, [legacy, hidden, dateRange, openTasks, selectedMemberId, canFilterByTeam, user?.id]);

  // Sync selectedEvent with updated data from events list
  useEffect(() => {
    if (selectedEvent && events.length > 0) {
      const updatedEvent = events.find((e) => e.id === selectedEvent.id);
      if (updatedEvent) {
        setSelectedEvent(updatedEvent);
      }
    }
  }, [events]);

  const handlePrevious = () => {
    switch (activeView) {
      case 'month':
        setCurrentDate(subMonths(currentDate, 1));
        break;
      case 'week':
        setCurrentDate(subWeeks(currentDate, 1));
        break;
      case 'day':
        setCurrentDate(subDays(currentDate, 1));
        break;
      case 'agenda':
        setCurrentDate(subDays(currentDate, AGENDA_DAYS));
        break;
    }
  };

  const handleNext = () => {
    switch (activeView) {
      case 'month':
        setCurrentDate(addMonths(currentDate, 1));
        break;
      case 'week':
        setCurrentDate(addWeeks(currentDate, 1));
        break;
      case 'day':
        setCurrentDate(addDays(currentDate, 1));
        break;
      case 'agenda':
        setCurrentDate(addDays(currentDate, AGENDA_DAYS));
        break;
    }
  };

  const handleToday = () => {
    setCurrentDate(new Date());
  };

  // In day view the day being shown IS the day navigated to — the side list
  // would otherwise keep showing whatever was last clicked in the month grid,
  // which is usually a different day than the one on screen.
  const listDate = activeView === 'day' ? currentDate : selectedDayForList;

  const selectedDayEvents = useMemo(() => {
    return visibleEvents.filter(e => isSameDay(new Date(e.start_time), listDate));
  }, [visibleEvents, listDate]);
  const selectedDayMarkers = markers.filter((marker) => isSameDay(marker.date, listDate));

  const handleDayClick = (date: Date) => {
    setSelectedDayForList(date);
  };

  const handleEventClick = (event: CalendarEvent) => {
    setSelectedEvent(event);
    setDetailsModalOpen(true);
  };

  const handleEditEvent = () => {
    setDetailsModalOpen(false);
    setCreateModalOpen(true);
  };

  const handleCreateEvent = () => {
    setSelectedDate(new Date());
    setSelectedEvent(null);
    setCreateModalOpen(true);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="workplace-agenda p-4 sm:p-6 lg:p-8">
      <CalendarHeader
        currentDate={currentDate}
        view={activeView}
        onViewChange={setView}
        onPrevious={handlePrevious}
        onNext={handleNext}
        onToday={handleToday}
        onCreateEvent={handleCreateEvent}
        filterUserId={selectedMemberId || 'all'}
        onFilterChange={(id) => setSelectedMemberId(id === 'all' ? null : id)}
        teamMembers={teamMembers.map((m) => ({ id: m.user_id, full_name: m.full_name }))}
        isAdmin={canFilterByTeam}
      />

      {/* Calendar on the left, the selected day's events in a narrow column
          beside it. Stacks back to one column below lg, where 240px of side
          panel would leave the grid itself unusable. */}
      <div className="agenda-layout mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_240px] lg:items-start">
        <div className="min-w-0">
          {activeView === 'month' && (
            <MonthView
              currentDate={currentDate}
              events={visibleEvents}
              markers={legacy ? undefined : markers}
              selectedDay={selectedDayForList}
              onDayClick={handleDayClick}
              onEventClick={handleEventClick}
            />
          )}

          {activeView === 'week' && (
            <WeekView
              currentDate={currentDate}
              events={visibleEvents}
              markers={markers}
              selectedDay={selectedDayForList}
              onDayClick={handleDayClick}
              onEventClick={handleEventClick}
            />
          )}

          {activeView === 'day' && (
            <DayView
              currentDate={currentDate}
              events={visibleEvents}
              markers={markers}
              onEventClick={handleEventClick}
            />
          )}

          {activeView === 'agenda' && (
            <AgendaListView start={dateRange.start} days={AGENDA_DAYS} events={visibleEvents} markers={markers} onEventClick={handleEventClick} />
          )}
        </div>

        <div className={legacy ? 'contents' : 'agenda-side'}>
        {!legacy && <CalendarLayersPanel hidden={hiddenLayers} onToggle={toggleLayer} />}
        {activeView !== 'agenda' && <DayEventsList
          selectedDate={listDate}
          events={selectedDayEvents}
          onEventClick={handleEventClick}
          onCreateEvent={() => {
            setSelectedDate(listDate);
            setSelectedEvent(null);
            setCreateModalOpen(true);
          }}
          markers={selectedDayMarkers}
        />}
        </div>
      </div>

      <CreateEventModal
        open={createModalOpen}
        onOpenChange={setCreateModalOpen}
        selectedDate={selectedDate}
        event={selectedEvent}
      />

      <EventDetailsModal
        open={detailsModalOpen}
        onOpenChange={setDetailsModalOpen}
        event={selectedEvent}
        onEdit={handleEditEvent}
      />
    </div>
  );
}
