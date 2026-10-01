import { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn, normalizeString } from '@/lib/utils';
import {
  NODE_CATEGORY_STYLES, NODE_DEFINITIONS, TRIGGER_GROUPS, TRIGGER_TYPES, triggerGroupOf,
} from '@/lib/automation-nodes';
import type { AutomationTriggerType } from '@/types/automations';

interface TriggerPickerProps {
  value: AutomationTriggerType;
  onChange: (type: AutomationTriggerType) => void;
  /** Grid columns — the node details view has one column of room, the gallery three. */
  gridClassName?: string;
  autoFocus?: boolean;
}

/**
 * The trigger catalogue. Fifteen entries across five parts of the product is
 * past what a flat grid can be scanned for, so it gets what any catalogue
 * gets: a search box, one chip per group, and as many columns as there is
 * room for. Its own state, so leaving the screen clears the filters for free.
 */
export function TriggerPicker({
  value,
  onChange,
  gridClassName = 'sm:grid-cols-2 lg:grid-cols-3',
  autoFocus = false,
}: TriggerPickerProps) {
  const [search, setSearch] = useState('');
  const [group, setGroup] = useState<string | null>(null);
  const term = normalizeString(search.trim());

  const visible = useMemo(
    () => TRIGGER_TYPES.filter((type) => {
      if (group && triggerGroupOf(type) !== group) return false;
      if (!term) return true;
      const definition = NODE_DEFINITIONS[type];
      // Description too: "primeiro pagamento" finds the referral trigger even
      // when the label says nothing about payments.
      return normalizeString(definition.label).includes(term)
        || normalizeString(definition.description).includes(term);
    }),
    [term, group],
  );

  const counts = useMemo(() => {
    const tally: Record<string, number> = {};
    for (const type of TRIGGER_TYPES) {
      const key = triggerGroupOf(type);
      if (key) tally[key] = (tally[key] ?? 0) + 1;
    }
    return tally;
  }, []);

  const style = NODE_CATEGORY_STYLES.trigger;
  const filtering = term.length > 0 || group !== null;

  return (
    <div>
      {/* Stays put while the grid scrolls underneath it. */}
      <div className="sticky top-0 z-10 space-y-2 bg-background pb-3 pt-1">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Pesquisar gatilho..."
            className="h-9 pl-9 pr-9"
            aria-label="Pesquisar gatilho"
            autoFocus={autoFocus}
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              aria-label="Limpar pesquisa"
              className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5">
          <GroupChip active={group === null} onClick={() => setGroup(null)}>
            Todos <span className="tabular-nums opacity-60">{TRIGGER_TYPES.length}</span>
          </GroupChip>
          {TRIGGER_GROUPS.map((item) => (
            <GroupChip
              key={item.key}
              active={group === item.key}
              onClick={() => setGroup(group === item.key ? null : item.key)}
            >
              {item.label} <span className="tabular-nums opacity-60">{counts[item.key] ?? 0}</span>
            </GroupChip>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          <p>Nenhum gatilho corresponde{group ? ' neste grupo' : ''}.</p>
          {filtering && (
            <button
              type="button"
              onClick={() => { setSearch(''); setGroup(null); }}
              className="mt-2 text-primary underline-offset-4 hover:underline"
            >
              Limpar filtros
            </button>
          )}
        </div>
      ) : (
        <div className={cn('grid gap-2', gridClassName)}>
          {visible.map((type) => {
            const definition = NODE_DEFINITIONS[type];
            const Icon = definition.icon;
            const selected = value === type;
            return (
              <button
                key={type}
                type="button"
                onClick={() => onChange(type)}
                aria-pressed={selected}
                className={cn(
                  'flex items-start gap-2.5 rounded-xl border p-3 text-left transition-all',
                  selected
                    ? 'border-primary bg-primary/5 shadow-sm'
                    : 'border-border bg-card hover:border-primary/40',
                )}
              >
                <span
                  className={cn(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-2',
                    style.bg,
                    style.ring,
                  )}
                >
                  <Icon className={cn('h-4 w-4', style.icon)} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-semibold text-foreground">{definition.label}</span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
                    {definition.description}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function GroupChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}
