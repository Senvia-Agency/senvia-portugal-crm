import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ChevronLeft, ChevronRight, Plus, Calendar as CalendarIcon } from 'lucide-react';
import { addDays, format } from 'date-fns';
import { pt } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { useInterfaceStore } from '@/stores/useInterfaceStore';

export type ViewType = 'month' | 'week' | 'day' | 'agenda';
const VIEWS: readonly { key: ViewType; label: string }[] = [{ key: 'day', label: 'Dia' }, { key: 'week', label: 'Semana' }, { key: 'month', label: 'Mês' }, { key: 'agenda', label: 'Agenda' }];

interface CalendarHeaderProps {
  currentDate: Date;
  view: ViewType;
  onViewChange: (view: ViewType) => void;
  onPrevious: () => void;
  onNext: () => void;
  onToday: () => void;
  onCreateEvent: () => void;
  filterUserId?: string;
  onFilterChange?: (userId: string) => void;
  teamMembers?: Array<{ id: string; full_name: string }>;
  isAdmin?: boolean;
}

export function CalendarHeader({
  currentDate,
  view,
  onViewChange,
  onPrevious,
  onNext,
  onToday,
  onCreateEvent,
  filterUserId,
  onFilterChange,
  teamMembers,
  isAdmin,
}: CalendarHeaderProps) {
  const legacy = useInterfaceStore(state => state.legacy);
  const getTitle = () => {
    switch (view) {
      case 'month':
        return format(currentDate, "MMMM 'de' yyyy", { locale: pt });
      case 'week':
        return format(currentDate, "'Semana de' d 'de' MMMM", { locale: pt });
      case 'day':
        return format(currentDate, "EEEE, d 'de' MMMM 'de' yyyy", { locale: pt });
      case 'agenda':
        return `${format(currentDate, "d 'de' MMM", { locale: pt })} – ${format(addDays(currentDate, 29), "d 'de' MMM yyyy", { locale: pt })}`;
    }
  };

  const teamFilter = isAdmin && teamMembers && teamMembers.length > 0 && onFilterChange && (
    <Select value={filterUserId || 'all'} onValueChange={onFilterChange}>
      <SelectTrigger className="agenda-team-filter h-10 w-[180px] rounded-full">
        <SelectValue placeholder="Todos" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">Todos</SelectItem>
        {teamMembers.map((member) => (
          <SelectItem key={member.id} value={member.id}>
            {member.full_name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  // Workplace: Realize-style toolbar (round navigation, segmented views, pill action).
  if (!legacy) {
    return (
      <div className="agenda-toolbar mb-5 flex flex-wrap items-center gap-x-3 gap-y-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="agenda-title text-[26px] font-extrabold tracking-tight">Agenda</h1>
          <div className="flex items-center gap-1">
            <button type="button" onClick={onPrevious} aria-label="Anterior" className="agenda-round flex h-9 w-9 items-center justify-center rounded-full border bg-card shadow-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button type="button" onClick={onToday} className="agenda-round h-9 rounded-full border bg-card px-3.5 text-[13px] font-semibold shadow-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              Hoje
            </button>
            <button type="button" onClick={onNext} aria-label="Seguinte" className="agenda-round flex h-9 w-9 items-center justify-center rounded-full border bg-card shadow-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <h2 className="agenda-period text-base font-bold first-letter:uppercase">{getTitle()}</h2>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {teamFilter}
          <div role="group" aria-label="Vista do calendário" className="agenda-views flex rounded-full border bg-card p-1 shadow-sm">
            {VIEWS.map((option) => (
              <button key={option.key} type="button" aria-pressed={view === option.key} onClick={() => onViewChange(option.key)}
                className={cn('h-8 rounded-full px-3.5 text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  view === option.key ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground')}>
                {option.label}
              </button>
            ))}
          </div>
          <Button onClick={onCreateEvent} className="h-10 rounded-full px-4">
            <Plus className="h-4 w-4 mr-1" />
            <span className="hidden sm:inline">Novo evento</span>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
      <div className="flex items-center gap-2">
        <CalendarIcon className="h-6 w-6 text-primary" />
        <h1 className="text-xl sm:text-2xl font-bold capitalize">{getTitle()}</h1>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {/* Admin Filter */}
        {isAdmin && teamMembers && teamMembers.length > 0 && onFilterChange && (
          <Select value={filterUserId || 'all'} onValueChange={onFilterChange}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Todos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              {teamMembers.map((member) => (
                <SelectItem key={member.id} value={member.id}>
                  {member.full_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* View Selector */}
        <Select value={view} onValueChange={(v) => onViewChange(v as ViewType)}>
          <SelectTrigger className="w-[120px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="month">Mês</SelectItem>
            <SelectItem value="week">Semana</SelectItem>
            <SelectItem value="day">Dia</SelectItem>
          </SelectContent>
        </Select>

        {/* Navigation */}
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" onClick={onPrevious}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={onToday}>
            Hoje
          </Button>
          <Button variant="outline" size="icon" onClick={onNext}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        {/* Create Event */}
        <Button onClick={onCreateEvent}>
          <Plus className="h-4 w-4 mr-1" />
          <span className="hidden sm:inline">Novo Evento</span>
        </Button>
      </div>
    </div>
  );
}
