import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { format, isSameDay, isToday, getHours, getMinutes } from 'date-fns';
import { pt } from 'date-fns/locale';
import type { CalendarEvent } from '@/types/calendar';
import { EVENT_TYPE_COLORS } from '@/types/calendar';
import { EventCard } from './EventCard';
import { CalendarMarkerChip } from './CalendarMarkerChip';
import type { CalendarMarker } from './calendar-layers';

interface DayViewProps {
  currentDate: Date;
  events: CalendarEvent[];
  onEventClick: (event: CalendarEvent) => void;
  /** Holidays and task deadlines, shown with the all-day items (Workplace only). */
  markers?: readonly CalendarMarker[];
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);

export function DayView({ currentDate, events, onEventClick, markers = [] }: DayViewProps) {
  const dayMarkers = markers.filter((marker) => isSameDay(marker.date, currentDate));
  const dayEvents = useMemo(() => {
    return events.filter((event) => isSameDay(new Date(event.start_time), currentDate));
  }, [events, currentDate]);

  const allDayEvents = dayEvents.filter((e) => e.all_day);
  const timedEvents = dayEvents.filter((e) => !e.all_day);

  const getEventPosition = (event: CalendarEvent) => {
    const startDate = new Date(event.start_time);
    const startHour = getHours(startDate);
    const startMinute = getMinutes(startDate);
    const top = (startHour + startMinute / 60) * 60;

    let height = 60; // Default 1 hour
    if (event.end_time) {
      const endDate = new Date(event.end_time);
      const durationMinutes = (endDate.getTime() - startDate.getTime()) / (1000 * 60);
      height = (durationMinutes / 60) * 60;
    }

    return { top, height: Math.max(height, 30) };
  };

  return (
    <div className="calendar-surface calendar-dayview bg-card rounded-lg border overflow-hidden">
      {/* Header */}
      <div
        className={cn(
          'py-4 text-center border-b',
          isToday(currentDate) && 'bg-primary/10'
        )}
      >
        <p className="text-sm font-medium text-muted-foreground uppercase">
          {format(currentDate, 'EEEE', { locale: pt })}
        </p>
        <p
          className={cn(
            'text-3xl font-bold',
            isToday(currentDate) && 'text-primary'
          )}
        >
          {format(currentDate, 'd')}
        </p>
        <p className="text-sm text-muted-foreground">
          {format(currentDate, "MMMM 'de' yyyy", { locale: pt })}
        </p>
      </div>

      {/* All Day Events */}
      {(allDayEvents.length > 0 || dayMarkers.length > 0) && (
        <div className="border-b p-3 bg-muted/30">
          <p className="text-xs font-medium text-muted-foreground mb-2">Dia Inteiro</p>
          <div className="space-y-2">
            {dayMarkers.map((marker) => <CalendarMarkerChip key={marker.key} marker={marker} className="rounded-lg px-3 py-2 text-sm" />)}
            {allDayEvents.map((event) => (
              <EventCard key={event.id} event={event} onClick={() => onEventClick(event)} />
            ))}
          </div>
        </div>
      )}

      {/* Time Grid */}
      <div className="relative max-h-[50dvh] sm:max-h-[600px] overflow-y-auto">
        {HOURS.map((hour) => (
          <div key={hour} className="flex border-b">
            <div className="w-16 py-4 text-xs text-muted-foreground text-right pr-2 flex-shrink-0">
              {format(new Date().setHours(hour, 0), 'HH:mm')}
            </div>
            <div className="flex-1 h-[60px] border-l" />
          </div>
        ))}

        {/* Timed Events */}
        <div className="absolute top-0 left-16 right-0 bottom-0 pointer-events-none">
          {timedEvents.map((event) => {
            const { top, height } = getEventPosition(event);
            const colorClass = EVENT_TYPE_COLORS[event.event_type];

            return (
              <button
                key={event.id}
                data-type={event.event_type}
                onClick={() => onEventClick(event)}
                className={cn(
                  'calendar-chip calendar-block absolute left-1 right-1 rounded p-2 text-white text-sm font-medium pointer-events-auto hover:opacity-90 transition-opacity text-left',
                  colorClass
                )}
                style={{ top: `${top}px`, minHeight: `${height}px` }}
              >
                <p className="font-semibold truncate">{event.title}</p>
                <p className="text-xs opacity-90">
                  {format(new Date(event.start_time), 'HH:mm')}
                  {event.end_time && ` - ${format(new Date(event.end_time), 'HH:mm')}`}
                </p>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
