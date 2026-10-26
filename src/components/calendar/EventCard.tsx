import { cn } from '@/lib/utils';
import { EVENT_TYPE_COLORS, EVENT_TYPE_LABELS, type CalendarEvent, type EventType } from '@/types/calendar';
import { format } from 'date-fns';
import { pt } from 'date-fns/locale';
import { Video, Phone, CheckSquare, RefreshCw, Clock, User } from 'lucide-react';

const EVENT_TYPE_ICONS: Record<EventType, React.ElementType> = {
  meeting: Video,
  call: Phone,
  task: CheckSquare,
  follow_up: RefreshCw,
};

interface EventCardProps {
  event: CalendarEvent;
  compact?: boolean;
  onClick?: (e: React.MouseEvent) => void;
}

export function EventCard({ event, compact = false, onClick }: EventCardProps) {
  const Icon = EVENT_TYPE_ICONS[event.event_type];
  const colorClass = EVENT_TYPE_COLORS[event.event_type];

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onClick?.(e);
  };

  if (compact) {
    return (
      <button
        data-type={event.event_type}
        onClick={handleClick}
        className={cn(
          'calendar-chip w-full text-left px-2 py-1 rounded text-xs font-medium',
          colorClass,
          'text-white hover:opacity-90 transition-opacity'
        )}
      >
        <p className="calendar-chip-title truncate">{!event.all_day && <span className="calendar-chip-time hidden">{format(new Date(event.start_time), 'HH:mm')} </span>}{event.lead ? `${event.title} - ${event.lead.name}` : event.title}</p>
        <p className="calendar-chip-meta truncate text-[10px] text-primary-foreground/80">
          Comercial: {event.user?.full_name || 'Não identificado'}
        </p>
      </button>
    );
  }

  return (
    <button
      data-type={event.event_type}
        onClick={handleClick}
      className={cn(
        'calendar-event w-full text-left p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors',
        'flex items-start gap-3'
      )}
    >
      <div className={cn('calendar-event-icon p-2 rounded-lg text-white', colorClass)}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm truncate">{event.title}</p>
        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
          <Clock className="h-3 w-3" />
          {event.all_day ? (
            <span>Dia inteiro</span>
          ) : (
            <span>
              {format(new Date(event.start_time), 'HH:mm', { locale: pt })}
              {event.end_time && ` - ${format(new Date(event.end_time), 'HH:mm', { locale: pt })}`}
            </span>
          )}
        </div>
        {event.lead && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
            <User className="h-3 w-3" />
            <span className="truncate">{event.lead.name}</span>
          </div>
        )}
        <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
          <User className="h-3 w-3" />
          <span className="truncate">Comercial: {event.user?.full_name || 'Não identificado'}</span>
        </div>
      </div>
      <span
        className={cn(
          // shrink-0: in the narrow side column the badge was being squeezed
          // and wrapping its own label instead of the title truncating.
          'text-[10px] px-2 py-0.5 rounded-full font-medium shrink-0',
          event.status === 'completed' && 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
          event.status === 'pending' && 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
          event.status === 'cancelled' && 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
        )}
      >
        {EVENT_TYPE_LABELS[event.event_type]}
      </span>
    </button>
  );
}
