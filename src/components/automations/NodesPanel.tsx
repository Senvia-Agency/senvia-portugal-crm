import { useEffect, useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn, normalizeString } from '@/lib/utils';
import {
  ACTION_TYPES, CATEGORY_LABELS, NODE_CATEGORY_STYLES, NODE_DEFINITIONS,
} from '@/lib/automation-nodes';
import { GroupChip } from '@/components/automations/TriggerPicker';
import type { AutomationNodeCategory, AutomationNodeType } from '@/types/automations';

interface NodesPanelProps {
  onClose: () => void;
  onSelect: (type: AutomationNodeType) => void;
}

/** Action node types grouped into the panel's sections, in this order. */
const CATEGORY_ORDER: AutomationNodeCategory[] = ['whatsapp', 'email', 'timing', 'logic', 'crm', 'end'];

/**
 * The step catalogue, as n8n's nodes panel: a full-height drawer on the right
 * of the canvas, with the flow still visible behind it. Search first, then
 * one chip per category; Enter takes the first match, Esc closes.
 */
export function NodesPanel({ onClose, onSelect }: NodesPanelProps) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<AutomationNodeCategory | null>(null);
  const term = normalizeString(search.trim());

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const grouped = useMemo(() => {
    const groups = new Map<AutomationNodeCategory, AutomationNodeType[]>();
    for (const type of ACTION_TYPES) {
      const definition = NODE_DEFINITIONS[type];
      if (category && definition.category !== category) continue;
      if (term
        && !normalizeString(definition.label).includes(term)
        && !normalizeString(definition.description).includes(term)) continue;
      groups.set(definition.category, [...(groups.get(definition.category) ?? []), type]);
    }
    return CATEGORY_ORDER
      .filter((key) => groups.has(key))
      .map((key) => ({ category: key, types: groups.get(key) as AutomationNodeType[] }));
  }, [term, category]);

  const categoriesPresent = useMemo(
    () => CATEGORY_ORDER.filter((key) => ACTION_TYPES.some((type) => NODE_DEFINITIONS[type].category === key)),
    [],
  );
  const first = grouped[0]?.types[0];

  return (
    <aside
      className={cn(
        'absolute inset-y-0 right-0 z-20 flex w-full flex-col border-l border-border bg-card shadow-2xl',
        'animate-in slide-in-from-right duration-200 sm:w-[420px]',
      )}
      role="dialog"
      aria-label="Adicionar passo"
    >
      <div className="flex items-start gap-3 border-b border-border p-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-foreground">Adicionar passo</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">O que acontece a seguir neste ponto do fluxo?</p>
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={onClose} aria-label="Fechar">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="space-y-2 border-b border-border p-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-primary" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && first) {
                event.preventDefault();
                onSelect(first);
              }
            }}
            placeholder="Pesquisar passo..."
            className="h-10 border-primary/40 bg-primary/[0.05] pl-10 shadow-sm focus-visible:ring-2 focus-visible:ring-primary/25"
            aria-label="Pesquisar passo"
            autoFocus
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <GroupChip active={category === null} onClick={() => setCategory(null)}>Todos</GroupChip>
          {categoriesPresent.map((key) => (
            <GroupChip
              key={key}
              active={category === key}
              onClick={() => setCategory(category === key ? null : key)}
            >
              {CATEGORY_LABELS[key]}
            </GroupChip>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {grouped.length === 0 ? (
          <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
            Nenhum passo corresponde à pesquisa.
          </div>
        ) : (
          <div className="space-y-5">
            {grouped.map(({ category: key, types }) => (
              <section key={key}>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {CATEGORY_LABELS[key]}
                </p>
                <div className="grid gap-2">
                  {types.map((type) => {
                    const definition = NODE_DEFINITIONS[type];
                    const style = NODE_CATEGORY_STYLES[definition.category];
                    const Icon = definition.icon;
                    return (
                      <button
                        key={type}
                        type="button"
                        onClick={() => onSelect(type)}
                        className={cn(
                          'flex items-start gap-3 rounded-xl border border-border bg-background p-3 text-left',
                          'transition-all hover:border-primary/50 hover:shadow-sm',
                          type === first && term && 'border-primary/50',
                        )}
                      >
                        <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-full ring-[2.5px]', style.bg, style.ring)}>
                          <Icon className={cn('h-5 w-5', style.icon)} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold text-foreground">{definition.label}</span>
                          <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{definition.description}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      <p className="shrink-0 border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
        Enter escolhe o primeiro resultado · Esc fecha
      </p>
    </aside>
  );
}
