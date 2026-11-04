import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/i18n';

export interface CollaboratorOption {
  user_id: string;
  full_name: string;
}

interface CollaboratorPickerProps {
  members: CollaboratorOption[];
  value: string[];
  onChange: (next: string[]) => void;
  // 'single' = pick exactly one (radio); 'multi' = pick several (checkboxes).
  mode?: 'single' | 'multi';
  emptyHint?: string;
}

// Searchable collaborator list. Always a scrollable list with a type-to-search
// box so it scales to large teams (20+ people) instead of a flat grid.
export function CollaboratorPicker({
  members,
  value,
  onChange,
  mode = 'multi',
  emptyHint,
}: CollaboratorPickerProps) {
  const [q, setQ] = useState('');
  const { t } = useLanguage();

  if (members.length === 0) {
    return <p className="text-xs text-muted-foreground">{t('Não há colaboradores na equipa.')}</p>;
  }

  const term = q.trim().toLowerCase();
  const filtered = term
    ? members.filter((m) => (m.full_name || '').toLowerCase().includes(term))
    : members;

  const toggle = (id: string) => {
    if (mode === 'single') {
      onChange([id]);
      return;
    }
    onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  };

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('Procurar colaborador...')}
          className="h-9 pl-8"
        />
      </div>

      <div className="max-h-52 overflow-y-auto rounded-md border divide-y">
        {filtered.length === 0 ? (
          <p className="text-xs text-muted-foreground p-3 text-center">{t('Ninguém encontrado.')}</p>
        ) : (
          filtered.map((m) => {
            const checked = value.includes(m.user_id);
            return (
              <div
                key={m.user_id}
                role="option"
                aria-selected={checked}
                onClick={() => toggle(m.user_id)}
                className={cn(
                  'flex items-center gap-2.5 px-3 py-2 cursor-pointer transition-colors select-none',
                  checked ? 'bg-primary/10' : 'hover:bg-accent/50',
                )}
              >
                {mode === 'single' ? (
                  <span
                    className={cn(
                      'flex h-4 w-4 items-center justify-center rounded-full border shrink-0',
                      checked ? 'border-primary' : 'border-muted-foreground/40',
                    )}
                  >
                    {checked && <span className="h-2 w-2 rounded-full bg-primary" />}
                  </span>
                ) : (
                  <Checkbox checked={checked} className="pointer-events-none shrink-0" />
                )}
                <span className="text-sm truncate">{m.full_name}</span>
              </div>
            );
          })
        )}
      </div>

      {value.length > 0 ? (
        <p className="text-[11px] text-muted-foreground">
          {t(value.length > 1 ? '{{n}} selecionados' : '{{n}} selecionado', { n: value.length })}
        </p>
      ) : emptyHint ? (
        <p className="text-[11px] text-muted-foreground">{emptyHint}</p>
      ) : null}
    </div>
  );
}
