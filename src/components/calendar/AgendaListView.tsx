import { addDays, eachDayOfInterval, format, isSameDay, isToday } from 'date-fns';
import { pt } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import type { CalendarEvent } from '@/types/calendar';
import { CalendarMarkerChip } from './CalendarMarkerChip';
import type { CalendarMarker } from './calendar-layers';

interface Props {
  readonly start: Date;
  readonly days: number;
  readonly events: readonly CalendarEvent[];
  readonly markers: readonly CalendarMarker[];
  readonly onEventClick: (event: CalendarEvent) => void;
}

/** Agenda: the next days as a list, one card per day that has something on it. */
export function AgendaListView({ start, days, events, markers, onEventClick }: Props) {
  const list = eachDayOfInterval({ start, end: addDays(start, days - 1) })
    .map((day) => ({
      day,
      markers: markers.filter((marker) => isSameDay(marker.date, day)),
      events: events.filter((event) => isSameDay(new Date(event.start_time), day))
        .sort((first, second) => Number(second.all_day) - Number(first.all_day) || first.start_time.localeCompare(second.start_time)),
    }))
    .filter((entry) => entry.markers.length > 0 || entry.events.length > 0);

  if (list.length === 0) {
    return <p className="calendar-surface rounded-[1.5rem] border bg-card p-10 text-center text-sm text-muted-foreground">Nada marcado nos próximos {days} dias.</p>;
  }
  return (
    <div className="space-y-3">
      {list.map(({ day, markers: dayMarkers, events: dayEvents }) => (
        <section key={day.toISOString()} className="calendar-surface calendar-agenda-day flex gap-4 rounded-[1.5rem] border bg-card p-4">
          <div className="w-14 shrink-0 text-center">
            <p className="text-[11px] font-bold uppercase text-muted-foreground">{format(day, 'EEE', { locale: pt })}</p>
            <p className={cn('text-2xl font-extrabold', isToday(day) && 'text-primary')}>{format(day, 'd')}</p>
            <p className="text-[11px] text-muted-foreground">{format(day, 'MMM', { locale: pt })}</p>
          </div>
          <ul className="min-w-0 flex-1 space-y-1.5">
            {dayMarkers.map((marker) => <li key={marker.key}><CalendarMarkerChip marker={marker} className="rounded-2xl px-3 py-2 text-[13px]" /></li>)}
            {dayEvents.map((event) => (
              <li key={event.id}>
                <button type="button" data-type={event.event_type} onClick={() => onEventClick(event)}
                  className="calendar-chip flex w-full items-center gap-3 rounded-2xl px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <span className="w-24 shrink-0 text-[12px] font-bold opacity-80">
                    {event.all_day ? 'Dia todo' : `${format(new Date(event.start_time), 'HH:mm')}${event.end_time ? `–${format(new Date(event.end_time), 'HH:mm')}` : ''}`}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold">{event.lead ? `${event.title} - ${event.lead.name}` : event.title}</span>
                    <span className="block truncate text-[11.5px] opacity-75">Comercial: {event.user?.full_name || 'Não identificado'}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
