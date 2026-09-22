import { Toggle } from '@/components/ui/toggle';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Activity, Radio, Tags, Users } from 'lucide-react';
import { useProductTypes } from '@/hooks/useProductTypes';
import { useOperators } from '@/hooks/useOperators';
import { useTeamMembers } from '@/hooks/useTeam';
import { cn } from '@/lib/utils';
import { NO_OPERATOR, NO_TYPE, type CommissionFilters } from '@/lib/commission-filters';
import { TELECOM_STATUSES, TELECOM_STATUS_LABELS, type TelecomStatus } from '@/types/sales';

/**
 * Every switch carries its own colour, so a glance at the bar says which
 * operator or state is off without reading the labels. Written out in full
 * because Tailwind only keeps class names it can see in the source — a
 * template string like `bg-${tone}-500/15` is purged from the build.
 *
 * The `data-[state=on]:` copies are not redundant: Toggle ships its own
 * `data-[state=on]:bg-accent`, and an attribute selector outranks a plain
 * class, so the tone has to be restated in the same form to win.
 */
const OPERATOR_TONES = [
  'border-violet-500/40 bg-violet-500/15 text-violet-600 data-[state=on]:bg-violet-500/15 data-[state=on]:text-violet-600 dark:text-violet-400 dark:data-[state=on]:text-violet-400',
  'border-sky-500/40 bg-sky-500/15 text-sky-600 data-[state=on]:bg-sky-500/15 data-[state=on]:text-sky-600 dark:text-sky-400 dark:data-[state=on]:text-sky-400',
  'border-teal-500/40 bg-teal-500/15 text-teal-600 data-[state=on]:bg-teal-500/15 data-[state=on]:text-teal-600 dark:text-teal-400 dark:data-[state=on]:text-teal-400',
  'border-fuchsia-500/40 bg-fuchsia-500/15 text-fuchsia-600 data-[state=on]:bg-fuchsia-500/15 data-[state=on]:text-fuchsia-600 dark:text-fuchsia-400 dark:data-[state=on]:text-fuchsia-400',
  'border-orange-500/40 bg-orange-500/15 text-orange-600 data-[state=on]:bg-orange-500/15 data-[state=on]:text-orange-600 dark:text-orange-400 dark:data-[state=on]:text-orange-400',
  'border-indigo-500/40 bg-indigo-500/15 text-indigo-600 data-[state=on]:bg-indigo-500/15 data-[state=on]:text-indigo-600 dark:text-indigo-400 dark:data-[state=on]:text-indigo-400',
];

/** The neutral one, for lines that carry no operator at all. */
const NO_OPERATOR_TONE =
  'border-slate-400/40 bg-slate-400/15 text-slate-600 data-[state=on]:bg-slate-400/15 data-[state=on]:text-slate-600 dark:text-slate-300 dark:data-[state=on]:text-slate-300';

/** Same hues as the state badges everywhere else (TELECOM_STATUS_COLORS). */
const STATUS_TONES: Record<TelecomStatus, string> = {
  pendente: 'border-amber-500/40 bg-amber-500/15 text-amber-600 data-[state=on]:bg-amber-500/15 data-[state=on]:text-amber-600 dark:text-amber-400 dark:data-[state=on]:text-amber-400',
  em_instalacao: 'border-blue-500/40 bg-blue-500/15 text-blue-600 data-[state=on]:bg-blue-500/15 data-[state=on]:text-blue-600 dark:text-blue-400 dark:data-[state=on]:text-blue-400',
  ativo: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-600 data-[state=on]:bg-emerald-500/15 data-[state=on]:text-emerald-600 dark:text-emerald-400 dark:data-[state=on]:text-emerald-400',
  instalado: 'border-emerald-700/40 bg-emerald-700/15 text-emerald-700 data-[state=on]:bg-emerald-700/15 data-[state=on]:text-emerald-700 dark:text-emerald-300 dark:data-[state=on]:text-emerald-300',
  anulado: 'border-slate-500/40 bg-slate-500/15 text-slate-600 data-[state=on]:bg-slate-500/15 data-[state=on]:text-slate-600 dark:text-slate-300 dark:data-[state=on]:text-slate-300',
  cancelado: 'border-red-500/40 bg-red-500/15 text-red-600 data-[state=on]:bg-red-500/15 data-[state=on]:text-red-600 dark:text-red-400 dark:data-[state=on]:text-red-400',
};

/** How a switch looks once it has been turned off — colour drains out of it. */
const OFF_TONE = 'border-dashed border-border bg-transparent text-muted-foreground line-through opacity-55';

/**
 * Operator, state and seller filters for the commission cards. Operators and
 * states start ON; clicking one switches it off, so "everything except Digi"
 * is a single click rather than N-1 of them.
 */
/** One short label per active commission filter, for a pinned bar's chips. */
export function useCommissionFilterChips(value: CommissionFilters | undefined): string[] {
  const { data: operators = [] } = useOperators();
  const { data: members = [] } = useTeamMembers();
  const { byId: typeById } = useProductTypes();
  if (!value) return [];
  const chips: string[] = [];
  const opName = new Map(operators.map((o) => [o.id, o.name]));
  for (const id of value.excludedOperators) chips.push(`− ${id === NO_OPERATOR ? 'Sem operadora' : (opName.get(id) ?? id)}`);
  for (const st of value.excludedStatuses ?? []) chips.push(`− ${TELECOM_STATUS_LABELS[st as TelecomStatus] ?? st}`);
  for (const t of value.excludedTypes ?? []) chips.push(`− ${t === NO_TYPE ? 'Sem tipo' : (typeById.get(t)?.name ?? t)}`);
  if (value.userId) chips.push(members.find((m) => m.user_id === value.userId)?.full_name ?? 'vendedor');
  return chips;
}

export function CommissionFiltersBar({
  value,
  onChange,
  className,
}: {
  value: CommissionFilters;
  onChange: (next: CommissionFilters) => void;
  className?: string;
}) {
  const { data: operators = [] } = useOperators();
  const { data: members = [] } = useTeamMembers();
  const { active: productTypes } = useProductTypes();
  const excluded = new Set(value.excludedOperators);
  const excludedStatuses = new Set(value.excludedStatuses ?? []);
  const excludedTypes = new Set(value.excludedTypes ?? []);

  const toggleOperator = (key: string) => {
    const next = new Set(excluded);
    if (next.has(key)) next.delete(key); else next.add(key);
    onChange({ ...value, excludedOperators: [...next] });
  };
  const toggleStatus = (key: string) => {
    const next = new Set(excludedStatuses);
    if (next.has(key)) next.delete(key); else next.add(key);
    onChange({ ...value, excludedStatuses: [...next] });
  };
  const toggleType = (key: string) => {
    const next = new Set(excludedTypes);
    if (next.has(key)) next.delete(key); else next.add(key);
    onChange({ ...value, excludedTypes: [...next] });
  };

  // The organization's real product types (Fibra, Satélite, Cartões, …),
  // not the old Energia / Outros Serviços pair.
  const typeSwitches = [
    ...productTypes.map((t, i) => ({ key: t.id, label: t.name, tone: OPERATOR_TONES[(i + 3) % OPERATOR_TONES.length] })),
    { key: NO_TYPE, label: 'Sem tipo', tone: NO_OPERATOR_TONE },
  ];

  const switchClass = (on: boolean, tone: string) =>
    cn('h-8 rounded-full px-3 text-xs font-medium transition-all', on ? tone : OFF_TONE);

  const operatorSwitches = [
    ...operators.map((o, i) => ({ key: o.id, label: o.name, tone: OPERATOR_TONES[i % OPERATOR_TONES.length] })),
    { key: NO_OPERATOR, label: 'Sem operadora', tone: NO_OPERATOR_TONE },
  ];

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <span className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
          <Radio className="h-4 w-4" />
          Operadoras:
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          {operatorSwitches.map((s) => {
            const on = !excluded.has(s.key);
            return (
              <Toggle
                key={s.key}
                size="sm"
                variant="outline"
                pressed={on}
                onPressedChange={() => toggleOperator(s.key)}
                aria-label={`${on ? 'Esconder' : 'Mostrar'} ${s.label}`}
                className={switchClass(on, s.tone)}
              >
                {s.label}
              </Toggle>
            );
          })}
          {excluded.size > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-xs"
              onClick={() => onChange({ ...value, excludedOperators: [] })}
            >
              Todas
            </Button>
          )}
        </div>

        <Select
          value={value.userId ?? 'all'}
          onValueChange={(v) => onChange({ ...value, userId: v === 'all' ? null : v })}
        >
          <SelectTrigger
            className={cn(
              'h-8 w-full text-xs sm:w-[200px]',
              value.userId && 'border-primary/40 bg-primary/10 text-primary',
            )}
          >
            <Users className="mr-2 h-4 w-4 shrink-0" />
            <SelectValue placeholder="Todos os vendedores" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os vendedores</SelectItem>
            {members.map((m) => (
              <SelectItem key={m.user_id} value={m.user_id}>{m.full_name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <span className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
          <Activity className="h-4 w-4" />
          Estado:
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          {TELECOM_STATUSES.map((st) => {
            const on = !excludedStatuses.has(st);
            return (
              <Toggle
                key={st}
                size="sm"
                variant="outline"
                pressed={on}
                onPressedChange={() => toggleStatus(st)}
                aria-label={`${on ? 'Esconder' : 'Mostrar'} ${TELECOM_STATUS_LABELS[st]}`}
                className={switchClass(on, STATUS_TONES[st])}
              >
                {TELECOM_STATUS_LABELS[st]}
              </Toggle>
            );
          })}
          {excludedStatuses.size > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-xs"
              onClick={() => onChange({ ...value, excludedStatuses: [] })}
            >
              Todos
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <span className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
          <Tags className="h-4 w-4" />
          Tipos:
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          {typeSwitches.map((s) => {
            const on = !excludedTypes.has(s.key);
            return (
              <Toggle
                key={s.key}
                size="sm"
                variant="outline"
                pressed={on}
                onPressedChange={() => toggleType(s.key)}
                aria-label={`${on ? 'Esconder' : 'Mostrar'} ${s.label}`}
                className={switchClass(on, s.tone)}
              >
                {s.label}
              </Toggle>
            );
          })}
          {excludedTypes.size > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-xs"
              onClick={() => onChange({ ...value, excludedTypes: [] })}
            >
              Todos
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
