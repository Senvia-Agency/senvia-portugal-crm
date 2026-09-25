import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { SlidersHorizontal } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { usePersistedState } from '@/hooks/usePersistedState';
import { cn } from '@/lib/utils';

/**
 * The one-line bar every list page pins to the top: what page, which tab,
 * the headline numbers, what is filtered (as chips), and the actions. The
 * full panel — stat cards, search, switches — opens under it behind
 * "Filtros", and whether it is open is remembered per page.
 *
 * Plain `sticky` on the window with an opaque background and nothing hanging
 * outside its own width: the version that behaves, after two that did not.
 */
export function PinnedPageBar({
  icon: Icon,
  title,
  tabs,
  search,
  summary,
  chips = [],
  actions,
  storageKey,
  panel,
  className,
  layout = 'pinned',
  subtitle,
}: {
  icon: LucideIcon;
  title: string;
  /** A small TabsList, when the page has tabs — kept reachable with the panel closed. */
  tabs?: ReactNode;
  /** The typed search box — stays on the bar even with the panel closed. */
  search?: ReactNode;
  /** The headline numbers, as text. */
  summary?: ReactNode;
  /** One short label per active filter. */
  chips?: string[];
  /** Primary actions (Nova …). */
  actions?: ReactNode;
  /** Where the open/closed choice is remembered. */
  storageKey: string;
  /** Cards + filters. Absent = nothing to open, no Filtros button. */
  panel?: ReactNode;
  className?: string;
  /** Spacious page header for dashboard-style pages. */
  layout?: 'pinned' | 'dashboard';
  subtitle?: string;
}) {
  const [open, setOpen] = usePersistedState<boolean>(storageKey, false);

  if (layout === 'dashboard') {
    return (
      <div className={cn('space-y-5 p-4 pb-6 md:p-6 lg:p-8', className)}>
        <header className="flex flex-col gap-4 border-b border-border/70 pb-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-primary">Gestão comercial</p>
            <h1 className="text-3xl font-semibold tracking-tight md:text-[2.1rem]">{title}</h1>
            {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
          </div>
          <div className="flex flex-wrap gap-2">{actions}</div>
        </header>
        {tabs && <div>{tabs}</div>}
        {search && <div className="w-full">{search}</div>}
        {(summary || chips.length > 0) && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {summary}
            {chips.map((chip) => <Badge key={chip} variant="outline" className="h-6 rounded-full px-2 text-[11px] font-normal">{chip}</Badge>)}
          </div>
        )}
        {panel}
      </div>
    );
  }

  return (
    <div className={cn('sticky top-14 lg:top-0 z-20 border-b bg-background', className)}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 md:px-6 py-2">
        <span className="flex items-center gap-1.5 text-sm font-semibold">
          <Icon className="h-4 w-4 text-primary" />
          {title}
        </span>
        {tabs}
        {search && <div className="w-full sm:w-auto sm:min-w-[220px] sm:max-w-sm sm:flex-1">{search}</div>}
        {summary && <span className="text-xs text-muted-foreground">{summary}</span>}
        {chips.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            {chips.map((chip) => (
              <Badge key={chip} variant="outline" className="h-6 rounded-full px-2 text-[11px] font-normal">
                {chip}
              </Badge>
            ))}
          </div>
        )}
        <div className="ml-auto flex items-center gap-2">
          {panel && (
            <Button
              type="button"
              variant={open ? 'secondary' : 'outline'}
              size="sm"
              className="h-8"
              aria-expanded={open}
              onClick={() => setOpen(!open)}
            >
              <SlidersHorizontal className="h-4 w-4 mr-1" />
              Filtros{chips.length > 0 ? ` (${chips.length})` : ''}
            </Button>
          )}
          {actions}
        </div>
      </div>
      {open && panel && <div className="border-t">{panel}</div>}
    </div>
  );
}
