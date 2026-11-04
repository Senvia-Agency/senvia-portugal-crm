import { Command as CommandPrimitive } from 'cmdk';
import { useNavigate } from 'react-router-dom';
import { CornerDownLeft, Search } from 'lucide-react';
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useLanguage } from '@/i18n';
import { ModuleNavIcon } from './ModuleNavIcon';
import { workspaceNavigationGroups, type workspaceNavigation } from './workspaceNavigation';

type NavItem = (typeof workspaceNavigation)[number];

const kbd = 'inline-flex h-5 min-w-5 items-center justify-center rounded-md border border-border bg-muted px-1.5 font-sans text-[10px] font-semibold text-muted-foreground';

/** The Ctrl K palette: every module and page this person can open, by area. */
export function WorkspaceSearch({ open, onOpenChange, items }: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly items: readonly NavItem[];
}) {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const go = (to: string) => { navigate(to); onOpenChange(false); };

  return <Dialog open={open} onOpenChange={onOpenChange}>
    {/* Sits high on the screen like a launcher, not centred like a form; the
        input row's own Esc replaces the dialog's floating close button. */}
    <DialogContent aria-describedby={undefined}
      className="gap-0 overflow-hidden rounded-2xl p-0 shadow-2xl sm:top-[12vh] sm:max-w-[600px] sm:translate-y-0 [&>[title=Fechar]]:hidden">
      <DialogTitle className="sr-only">{t('Procurar módulos e páginas...')}</DialogTitle>
      <CommandPrimitive loop className="flex flex-col text-foreground">
        <div className="flex items-center gap-3 border-b border-border px-4">
          <Search className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <CommandPrimitive.Input autoFocus placeholder={t('Para onde quer ir?')}
            className="h-14 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground" />
          <DialogClose className={`${kbd} h-6 cursor-pointer hover:bg-accent hover:text-foreground`}>Esc</DialogClose>
        </div>

        <CommandPrimitive.List className="max-h-[min(440px,60vh)] overflow-y-auto overscroll-contain p-2">
          <CommandPrimitive.Empty className="px-4 py-10 text-center text-sm text-muted-foreground">{t('Nenhum módulo encontrado.')}</CommandPrimitive.Empty>
          {workspaceNavigationGroups.map((group) => {
            const groupItems = items.filter((item) => item.group === group);
            if (!groupItems.length) return null;
            return <CommandPrimitive.Group key={group} heading={t(group)}
              className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground">
              {groupItems.map((item) =>
                <CommandPrimitive.Item key={item.to} value={`${t(item.label)} ${t(group)}`} onSelect={() => go(item.to)}
                  className="group flex cursor-pointer select-none items-center gap-3 rounded-xl px-2.5 py-2 text-sm outline-none transition-colors data-[selected=true]:bg-primary/10">
                  <ModuleNavIcon icon={item.icon} to={item.to} />
                  <span className="min-w-0 flex-1 truncate font-medium">{t(item.label)}</span>
                  <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-primary opacity-0 transition-opacity group-data-[selected=true]:opacity-100" aria-hidden="true" />
                </CommandPrimitive.Item>)}
            </CommandPrimitive.Group>;
          })}
        </CommandPrimitive.List>

        <div className="hidden items-center gap-4 border-t border-border bg-muted/40 px-4 py-2.5 text-[11px] text-muted-foreground sm:flex">
          <span className="flex items-center gap-1.5"><kbd className={kbd}>↑</kbd><kbd className={kbd}>↓</kbd>{t('navegar')}</span>
          <span className="flex items-center gap-1.5"><kbd className={kbd}>↵</kbd>{t('abrir')}</span>
          <span className="flex items-center gap-1.5"><kbd className={kbd}>Esc</kbd>{t('fechar')}</span>
          <span className="ml-auto flex items-center gap-1.5"><kbd className={kbd}>Ctrl</kbd><kbd className={kbd}>K</kbd>{t('em qualquer página')}</span>
        </div>
      </CommandPrimitive>
    </DialogContent>
  </Dialog>;
}
