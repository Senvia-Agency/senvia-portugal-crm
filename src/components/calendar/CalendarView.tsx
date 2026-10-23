import { useState, useMemo, useEffect } from 'react';
import { addMonths, subMonths, addWeeks, subWeeks, addDays, subDays, startOfMonth, endOfMonth, startOfWeek, endOfWeek, startOfDay, endOfDay, isSameDay } from 'date-fns';
import { useCalendarEvents } from '@/hooks/useCalendarEvents';
import { useTeamMembers } from '@/hooks/useTeam';
import { useTeamFilter } from '@/hooks/useTeamFilter';
import { CalendarHeader, type ViewType } from './CalendarHeader';
import { MonthView } from './MonthView';
import { WeekView } from './WeekView';
import { DayView } from './DayView';
import { DayEventsList } from './DayEventsList';
import { CreateEventModal } from './CreateEventModal';
import { EventDetailsModal } from './EventDetailsModal';
import type { CalendarEvent } from '@/types/calendar';
import { Loader2 } from 'lucide-react';

export function CalendarView() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState<ViewType>('month');
  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [detailsModalOpen, setDetailsModalOpen] = useState(false);
  const [selectedDayForList, setSelectedDayForList] = useState<Date>(new Date());

  const { canFilterByTeam, selectedMemberId, setSelectedMemberId } = useTeamFilter();
  const { data: teamMembers = [] } = useTeamMembers();

  // Calculate date range based on view
  const dateRange = useMemo(() => {
    switch (view) {
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
    }
  }, [currentDate, view]);

  // useCalendarEvents já filtra baseado no effectiveUserId do useTeamFilter
  const { data: events = [], isLoading } = useCalendarEvents(dateRange.start, dateRange.end);

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
    switch (view) {
      case 'month':
        setCurrentDate(subMonths(currentDate, 1));
        break;
      case 'week':
        setCurrentDate(subWeeks(currentDate, 1));
        break;
      case 'day':
        setCurrentDate(subDays(currentDate, 1));
        break;
    }
  };

  const handleNext = () => {
    switch (view) {
      case 'month':
        setCurrentDate(addMonths(currentDate, 1));
        break;
      case 'week':
        setCurrentDate(addWeeks(currentDate, 1));
        break;
      case 'day':
        setCurrentDate(addDays(currentDate, 1));
        break;
    }
  };

  const handleToday = () => {
    setCurrentDate(new Date());
  };

  // In day view the day being shown IS the day navigated to — the side list
  // would otherwise keep showing whatever was last clicked in the month grid,
  // which is usually a different day than the one on screen.
  const listDate = view === 'day' ? currentDate : selectedDayForList;

  const selectedDayEvents = useMemo(() => {
    return events.filter(e => isSameDay(new Date(e.start_time), listDate));
  }, [events, listDate]);

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
    <div className="p-4 sm:p-6 lg:p-8">
      <CalendarHeader
        currentDate={currentDate}
        view={view}
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
      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_240px] lg:items-start">
        <div className="min-w-0">
          {view === 'month' && (
            <MonthView
              currentDate={currentDate}
              events={events}
              selectedDay={selectedDayForList}
              onDayClick={handleDayClick}
              onEventClick={handleEventClick}
            />
          )}

          {view === 'week' && (
            <WeekView
              currentDate={currentDate}
              events={events}
              selectedDay={selectedDayForList}
              onDayClick={handleDayClick}
              onEventClick={handleEventClick}
            />
          )}

          {view === 'day' && (
            <DayView
              currentDate={currentDate}
              events={events}
              onEventClick={handleEventClick}
            />
          )}
        </div>

        <DayEventsList
          selectedDate={listDate}
          events={selectedDayEvents}
          onEventClick={handleEventClick}
          onCreateEvent={() => {
            setSelectedDate(listDate);
            setSelectedEvent(null);
            setCreateModalOpen(true);
          }}
        />
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
