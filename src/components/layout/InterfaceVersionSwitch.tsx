import { useInterfaceStore } from '@/stores/useInterfaceStore';
import { cn } from '@/lib/utils';

export function InterfaceVersionSwitch({ compact = false }: { readonly compact?: boolean }) {
  const legacy = useInterfaceStore(state => state.legacy);
  const setLegacy = useInterfaceStore(state => state.setLegacy);
  return <button type="button" role="switch" aria-checked={legacy} aria-label="Versão antiga"
    title={legacy ? 'Desativar para voltar à nova interface' : 'Ativar a interface antiga'}
    onClick={() => setLegacy(!legacy)}
    className={cn("interface-version-switch inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border border-border bg-background px-2.5 text-xs font-medium text-foreground shadow-sm hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary", compact && "interface-version-switch--compact")}>
    <span>{compact ? 'Antiga' : 'Versão antiga'}</span>
    <span aria-hidden="true" className={cn('flex h-5 w-8 items-center rounded-full p-0.5 transition-colors', legacy ? 'bg-primary' : 'bg-muted-foreground/30')}>
      <span className={cn('h-4 w-4 rounded-full bg-background shadow-sm transition-transform motion-reduce:transition-none', legacy && 'translate-x-3')} />
    </span>
  </button>;
}
