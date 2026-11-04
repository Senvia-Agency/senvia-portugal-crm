import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Clock3 } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { WorkdayPanel, useWorkday } from '@/components/timeclock/WorkdayPanel';
import { formatDuration } from '@/lib/timeclock';
import { intlLocale, useLanguage } from '@/i18n';

/**
 * The top bar's clock: the time worked today while the day runs (the hour
 * otherwise), and the day's buttons one click away.
 */
export function WorkplaceTimePreview() {
  const [open, setOpen] = useState(false);
  const day = useWorkday();
  const { t } = useLanguage();
  const hour = new Intl.DateTimeFormat(intlLocale(), { hour: '2-digit', minute: '2-digit' }).format(day.now);
  const running = day.state !== 'closed';
  const shown = running ? formatDuration(day.workedMs, true).slice(0, 5) : hour;
  const label = t(day.state === 'working' ? 'A trabalhar' : day.state === 'paused' ? 'Em pausa' : 'Ponto');

  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <button type="button" data-otto-target="guide-ponto" className="workplace-time-preview" data-state-day={day.state} aria-label={`${t('Ponto')}: ${label}`}>
        <span className="workplace-time-dot" aria-hidden="true" />
        <Clock3 className="h-4 w-4" aria-hidden="true" />
        <time dateTime={day.now.toISOString()} className="tabular-nums">{shown}</time><span className="workplace-time-separator" aria-hidden="true" /><span className="workplace-time-label">{label}</span>
      </button>
    </PopoverTrigger>
    <PopoverContent align="end" className="w-80 space-y-3">
      <WorkdayPanel compact />
      <Link to="/ponto" onClick={() => setOpen(false)} className="flex items-center justify-between border-t pt-2 text-xs font-medium text-primary hover:underline">
        Ver o meu ponto <ChevronRight className="h-3.5 w-3.5" />
      </Link>
    </PopoverContent>
  </Popover>;
}
