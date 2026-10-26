import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval, isSameMonth, isSameDay, isToday } from 'date-fns';
import { pt } from 'date-fns/locale';
import type { CalendarEvent } from '@/types/calendar';
import { EventCard } from './EventCard';
import { CalendarMarkerChip } from './CalendarMarkerChip';
import type { CalendarMarker } from './calendar-layers';

interface MonthViewProps {
  currentDate: Date;
  events: CalendarEvent[];
  selectedDay?: Date;
  onDayClick: (date: Date) => void;
  onEventClick: (event: CalendarEvent) => void;
  /** Holidays and task deadlines (Workplace only). */
  markers?: readonly CalendarMarker[];
}

export function MonthView({ currentDate, events, selectedDay, onDayClick, onEventClick, markers }: MonthViewProps) {
  const days = useMemo(() => {
    const monthStart = startOfMonth(currentDate);
    const monthEnd = endOfMonth(currentDate);
    const calendarStart = startOfWeek(monthStart, { weekStartsOn: 1 });
    const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
    
    return eachDayOfInterval({ start: calendarStart, end: calendarEnd });
  }, [currentDate]);

  const weekDays = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

  const getEventsForDay = (day: Date) => {
    return events.filter((event) => isSameDay(new Date(event.start_time), day));
  };

  return (
    <div className="calendar-surface calendar-month bg-card rounded-lg border overflow-hidden">
      {/* Header */}
      <div className="calendar-weekdays grid grid-cols-7 border-b">
        {weekDays.map((day) => (
          <div
            key={day}
            className="py-2 text-center text-xs font-medium text-muted-foreground uppercase"
          >
            {day}
          </div>
        ))}
      </div>

      {/* Days Grid */}
      <div className="grid grid-cols-7">
        {days.map((day, index) => {
          const dayEvents = getEventsForDay(day);
          // Markers come first (a holiday frames the day); the classic grid keeps its two events.
          const limit = markers ? 3 : 2;
          const dayMarkers = markers?.filter((marker) => isSameDay(marker.date, day)) ?? [];
          const shownMarkers = dayMarkers.slice(0, limit);
          const shownEvents = dayEvents.slice(0, limit - shownMarkers.length);
          const hiddenCount = dayMarkers.length + dayEvents.length - shownMarkers.length - shownEvents.length;
          const isCurrentMonth = isSameMonth(day, currentDate);
          const isCurrentDay = isToday(day);

          return (
            <div
              key={index}
              onClick={() => onDayClick(day)}
              data-today={isCurrentDay || undefined}
              data-outside={!isCurrentMonth || undefined}
              data-selected={(selectedDay && isSameDay(day, selectedDay)) || undefined}
              className={cn(
                'calendar-day min-h-[80px] sm:min-h-[100px] lg:min-h-[120px] border-b border-r p-1 cursor-pointer transition-colors hover:bg-accent/50',
                !isCurrentMonth && 'bg-muted/30',
                selectedDay && isSameDay(day, selectedDay) && 'ring-2 ring-primary ring-inset bg-primary/5'
              )}
            >
              <div className="calendar-day-head flex items-center justify-center mb-1">
                <span
                  className={cn(
                    'calendar-day-number flex items-center justify-center w-7 h-7 rounded-full text-sm',
                    isCurrentDay && 'bg-primary text-primary-foreground font-semibold',
                    !isCurrentMonth && 'text-muted-foreground'
                  )}
                >
                  {format(day, 'd')}
                </span>
              </div>
              <div className="calendar-day-events space-y-1">
                {shownMarkers.map((marker) => <CalendarMarkerChip key={marker.key} marker={marker} />)}
                {shownEvents.map((event) => (
                  <EventCard
                    key={event.id}
                    event={event}
                    compact
                     onClick={(e) => {
                       e.stopPropagation();
                       onDayClick(day);
                       onEventClick(event);
                     }}
                  />
                ))}
                {hiddenCount > 0 && (
                  <p className="calendar-more text-xs text-muted-foreground text-center">
                    +{hiddenCount} mais
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
