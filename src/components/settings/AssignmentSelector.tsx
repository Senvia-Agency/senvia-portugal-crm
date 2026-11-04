import { cn } from '@/lib/utils';
import { CircleSlash, User, RefreshCw } from 'lucide-react';
import { CollaboratorPicker, type CollaboratorOption } from './CollaboratorPicker';
import { useLanguage } from '@/i18n';

// One single mental model for "who receives leads/conversations" across forms,
// webhooks and inboxes. There is NO org-wide fallback: assignment is always
// decided here, explicitly. The mode is derived from the fields that already
// exist (assigned_user_ids + rotate_enabled), so no schema change is needed:
//   empty list        -> 'none'   (stays unassigned, never a hidden round-robin)
//   list + rotate off -> 'fixed'  (always the same person)
//   list + rotate on  -> 'rotate' (round-robin between the chosen people)
export type AssignmentMode = 'none' | 'fixed' | 'rotate';

export function deriveAssignmentMode(userIds: string[] | null | undefined, rotateEnabled: boolean): AssignmentMode {
  if (!userIds || userIds.length === 0) return 'none';
  return rotateEnabled ? 'rotate' : 'fixed';
}

// Map a chosen mode + selection back to the persisted fields. `assigned_to` is
// kept in sync (single owner) so any older reader still works.
export function assignmentToFields(mode: AssignmentMode, userIds: string[]): {
  assigned_user_ids: string[];
  rotate_enabled: boolean;
  assigned_to: string | null;
} {
  if (mode === 'none') return { assigned_user_ids: [], rotate_enabled: false, assigned_to: null };
  if (mode === 'fixed') {
    const one = userIds[0] ? [userIds[0]] : [];
    return { assigned_user_ids: one, rotate_enabled: false, assigned_to: one[0] ?? null };
  }
  return { assigned_user_ids: userIds, rotate_enabled: true, assigned_to: null };
}

interface AssignmentSelectorProps {
  members: CollaboratorOption[];
  mode: AssignmentMode;
  userIds: string[];
  onChange: (next: { mode: AssignmentMode; userIds: string[] }) => void;
  // The thing being distributed, for copy: "leads" (form/webhook) or "conversas" (caixa).
  noun?: string;
  className?: string;
}

export function AssignmentSelector({
  members,
  mode,
  userIds,
  onChange,
  noun = 'leads',
  className,
}: AssignmentSelectorProps) {
  const { t } = useLanguage();
  const options: { value: AssignmentMode; label: string; description: string; icon: typeof User }[] = [
    { value: 'none', label: t('Sem atribuição'), description: t('Os {{noun}} ficam por atribuir.', { noun: t(noun) }), icon: CircleSlash },
    { value: 'fixed', label: t('Responsável fixo'), description: t('Vão sempre para a mesma pessoa.'), icon: User },
    { value: 'rotate', label: t('Rotação entre colaboradores'), description: t('Distribuídos em rotação (round-robin).'), icon: RefreshCw },
  ];

  const selectMode = (next: AssignmentMode) => {
    if (next === mode) return;
    if (next === 'none') return onChange({ mode: 'none', userIds: [] });
    if (next === 'fixed') return onChange({ mode: 'fixed', userIds: userIds[0] ? [userIds[0]] : [] });
    return onChange({ mode: 'rotate', userIds });
  };

  return (
    <div className={cn('space-y-3', className)}>
      <div className="space-y-1.5">
        {options.map((opt) => {
          const Icon = opt.icon;
          const active = mode === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => selectMode(opt.value)}
              className={cn(
                'flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-all',
                active ? 'border-primary bg-primary/5 ring-1 ring-primary/30' : 'hover:border-primary/40 hover:bg-accent/40',
              )}
            >
              <span
                className={cn(
                  'mt-0.5 flex h-4 w-4 items-center justify-center rounded-full border shrink-0',
                  active ? 'border-primary' : 'border-muted-foreground/40',
                )}
              >
                {active && <span className="h-2 w-2 rounded-full bg-primary" />}
              </span>
              <Icon className={cn('h-4 w-4 shrink-0 mt-0.5', active ? 'text-primary' : 'text-muted-foreground')} />
              <span className="min-w-0">
                <span className="block text-sm font-medium">{opt.label}</span>
                <span className="block text-xs text-muted-foreground">{opt.description}</span>
              </span>
            </button>
          );
        })}
      </div>

      {mode !== 'none' && (
        <div className="space-y-2 rounded-xl border bg-muted/20 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {mode === 'rotate' ? t('Quem recebe (2 ou mais)') : t('Quem recebe')}
          </p>
          <CollaboratorPicker
            members={members}
            value={userIds}
            mode={mode === 'rotate' ? 'multi' : 'single'}
            onChange={(next) => onChange({ mode, userIds: next })}
          />
          {mode === 'rotate' && userIds.length < 2 ? (
            <p className="text-xs text-blue-600 dark:text-blue-400">{t('Seleciona pelo menos 2 para a rotação fazer sentido.')}</p>
          ) : userIds.length === 0 ? (
            <p className="text-xs text-amber-600 dark:text-amber-400">{t('Sem ninguém selecionado, fica por atribuir.')}</p>
          ) : (
            <p className="text-xs text-muted-foreground">{t('Quem recebe é notificado por email/push.')}</p>
          )}
        </div>
      )}
    </div>
  );
}
