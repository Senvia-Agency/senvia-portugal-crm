import { format } from 'date-fns';
import { ClipboardList, PartyPopper } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import type { CalendarMarker } from './calendar-layers';

/** A holiday or task deadline on the calendar grid, in the same chip language as events. */
export function CalendarMarkerChip({ marker, className }: { marker: CalendarMarker; className?: string }) {
  const Icon = marker.layer === 'holidays' ? PartyPopper : ClipboardList;
  const classes = cn(
    'calendar-marker flex w-full min-w-0 items-center gap-1 rounded px-1.5 py-0.5 text-left text-[11px] font-semibold',
    marker.layer === 'holidays'
      ? 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300'
      : marker.overdue
        ? 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300'
        : 'bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200',
    className,
  );
  const label = `${marker.layer === 'holidays' ? 'Feriado' : marker.overdue ? 'Prazo em atraso' : 'Prazo de tarefa'}: ${marker.title}`;
  const content = <>
    <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
    <span className="truncate">{!marker.allDay && <span className="opacity-75">{format(marker.date, 'HH:mm')} </span>}{marker.title}</span>
  </>;
  return marker.href
    ? <Link to={marker.href} data-layer={marker.layer} title={label} aria-label={label} className={classes} onClick={event => event.stopPropagation()}>{content}</Link>
    : <span data-layer={marker.layer} title={label} aria-label={label} className={classes}>{content}</span>;
}
