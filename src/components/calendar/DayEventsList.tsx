import { format } from 'date-fns';
import { pt } from 'date-fns/locale';
import { CalendarPlus, CalendarX2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EventCard } from './EventCard';
import type { CalendarEvent } from '@/types/calendar';
import { CalendarMarkerChip } from './CalendarMarkerChip';
import type { CalendarMarker } from './calendar-layers';

interface DayEventsListProps {
  selectedDate: Date;
  events: CalendarEvent[];
  onEventClick: (event: CalendarEvent) => void;
  onCreateEvent: () => void;
  /** The day's holidays and task deadlines (Workplace only). */
  markers?: readonly CalendarMarker[];
}

export function DayEventsList({ selectedDate, events, onEventClick, onCreateEvent, markers = [] }: DayEventsListProps) {
  return (
    // Follows the page as the calendar scrolls, and keeps a long day's list
    // inside its own scroll instead of stretching the column past the grid.
    <div className="calendar-side bg-card rounded-lg border p-4 lg:sticky lg:top-4 flex flex-col lg:max-h-[calc(100vh-7rem)]">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h3 className="text-sm font-semibold min-w-0 truncate">
          {format(selectedDate, "d 'de' MMMM", { locale: pt })}
        </h3>
        <Button size="sm" variant="outline" onClick={onCreateEvent} className="gap-1.5 shrink-0">
          <CalendarPlus className="h-4 w-4" />
          <span className="lg:hidden xl:inline">Novo</span>
        </Button>
      </div>

      {markers.length > 0 && <div className="mb-2 space-y-1.5">{markers.map((marker) => <CalendarMarkerChip key={marker.key} marker={marker} className="rounded-xl px-3 py-2 text-[13px]" />)}</div>}
      {events.length === 0 && markers.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
          <CalendarX2 className="h-10 w-10 mb-2 opacity-40" />
          <p className="text-sm">Sem eventos agendados</p>
        </div>
      ) : events.length === 0 ? null : (
        <div className="space-y-2 overflow-y-auto -mr-1 pr-1">
          {events.map((event) => (
            <EventCard
              key={event.id}
              event={event}
              onClick={() => onEventClick(event)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
