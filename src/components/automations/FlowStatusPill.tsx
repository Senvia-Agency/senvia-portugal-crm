import { CircleDot, Pause, PencilLine } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AutomationFlowStatus } from '@/types/automations';
import { useLanguage } from '@/i18n';

const STATUS_META: Record<AutomationFlowStatus, { label: string; className: string; icon: typeof CircleDot }> = {
  draft: { label: 'Rascunho', className: 'bg-muted text-muted-foreground', icon: PencilLine },
  active: { label: 'Ativa', className: 'bg-success/10 text-success', icon: CircleDot },
  paused: { label: 'Em pausa', className: 'bg-warning/10 text-warning', icon: Pause },
};

export function FlowStatusPill({
  status,
  className,
}: {
  status: AutomationFlowStatus;
  className?: string;
}) {
  const { t } = useLanguage();
  const meta = STATUS_META[status] ?? STATUS_META.draft;
  const Icon = meta.icon;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold',
        meta.className,
        className,
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {t(meta.label)}
    </span>
  );
}
