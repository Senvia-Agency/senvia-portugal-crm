import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Search } from 'lucide-react';
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from '@/components/ui/command';
import { useModules } from '@/hooks/useModules';
import { usePermissions } from '@/hooks/usePermissions';
import { useSubscription } from '@/hooks/useSubscription';
import { InboxUnreadBadge } from './InboxUnreadBadge';
import { workspaceNavigation } from './workspaceNavigation';
import { InterfaceVersionSwitch } from './InterfaceVersionSwitch';

export function WorkspaceTopbar({ organizationName, userName }: { organizationName?: string; userName?: string }) {
  const [searchOpen, setSearchOpen] = useState(false);
  const navigate = useNavigate();
  const { modules } = useModules();
  const { canViewModule } = usePermissions();
  const { isModuleLocked } = useSubscription();
  const searchItems = workspaceNavigation.filter((item) =>
    !item.moduleKey || (!isModuleLocked(item.moduleKey) && modules[item.moduleKey] && canViewModule(item.moduleKey)));

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen((open) => !open);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  return <>
    <header className="workspace-topbar flex h-16 items-center justify-between gap-3 bg-[#0d1422] px-4 text-white xl:px-7">
      <button type="button" data-workspace-search onClick={() => setSearchOpen(true)}
        className="flex h-10 w-full max-w-[440px] items-center gap-3 rounded-xl border border-white/10 bg-white/[.07] px-4 text-left text-sm text-[#a7b2c7] transition-colors hover:border-[#6e93d8]/40 hover:bg-white/[.11] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5a94ff]">
        <Search className="h-4 w-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">Procurar módulos e páginas...</span>
        <kbd className="hidden rounded-md border border-white/15 px-1.5 py-0.5 text-[10px] font-semibold text-[#8c9bb6] lg:block">Ctrl K</kbd>
      </button>
      <div className="flex shrink-0 items-center gap-3">
        <InterfaceVersionSwitch />
        <button type="button" onClick={() => navigate('/inbox')} title="Abrir caixa de entrada" aria-label="Abrir caixa de entrada"
          className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 text-[#b5c1d7] hover:bg-white/[.09] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5a94ff]">
          <Bell className="h-4.5 w-4.5" />
          <span className="absolute -right-1 -top-1"><InboxUnreadBadge /></span>
        </button>
        <div data-workspace-user className="hidden min-w-0 max-w-[200px] text-right lg:block">
          <p className="truncate text-xs font-semibold text-white">{organizationName || 'Organização'}</p>
          <p className="truncate text-[11px] text-[#8e9cb5]">{userName || 'Utilizador'}</p>
        </div>
        <div className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-[#5e9afa] bg-[#243b61] text-xs font-bold text-white" aria-hidden="true">
          {(userName || 'U').trim().charAt(0).toUpperCase()}
        </div>
      </div>
    </header>
    <CommandDialog open={searchOpen} onOpenChange={setSearchOpen}>
      <CommandInput placeholder="Para onde quer ir?" />
      <CommandList>
        <CommandEmpty>Nenhum módulo encontrado.</CommandEmpty>
        {(['Visão geral', 'Comercial', 'Operação'] as const).map((group) =>
          <CommandGroup key={group} heading={group}>
            {searchItems.filter((item) => item.group === group).map((item) =>
              <CommandItem key={item.to} value={item.label} onSelect={() => { navigate(item.to); setSearchOpen(false); }}>
                <item.icon className="mr-2 h-4 w-4 text-primary" />{item.label}
                <CommandShortcut>↵</CommandShortcut>
              </CommandItem>)}
          </CommandGroup>)}
      </CommandList>
    </CommandDialog>
  </>;
}
