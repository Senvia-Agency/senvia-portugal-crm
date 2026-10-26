import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CALENDAR_LAYERS, type CalendarLayer } from './calendar-layers';

interface Props {
  readonly hidden: readonly CalendarLayer[];
  readonly onToggle: (layer: CalendarLayer) => void;
}

/** Which calendars are visible, as in Realize's calendar sidebar. */
export function CalendarLayersPanel({ hidden, onToggle }: Props) {
  return (
    <section className="calendar-layers rounded-[1.6rem] border bg-card p-4 shadow-sm" aria-label="Calendários">
      <p className="mb-2 px-1 text-[12px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Calendários</p>
      <ul className="space-y-0.5">
        {CALENDAR_LAYERS.map((layer) => {
          const visible = !hidden.includes(layer.key);
          return (
            <li key={layer.key}>
              <button type="button" aria-pressed={visible} onClick={() => onToggle(layer.key)}
                className="flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left text-[13.5px] font-semibold transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span className={cn('flex h-4 w-4 shrink-0 items-center justify-center rounded-md', visible ? layer.dot : 'ring-2 ring-border')}>
                  {visible && <Check className="h-3 w-3 text-white" strokeWidth={3} aria-hidden="true" />}
                </span>
                <span className={cn(!visible && 'text-muted-foreground')}>{layer.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
