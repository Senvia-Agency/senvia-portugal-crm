import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Shield }  from 'lucide-react';
import { useModules } from '@/hooks/useModules';
import { usePermissions } from '@/hooks/usePermissions';
import { useSubscription } from '@/hooks/useSubscription';
import { useAuth } from '@/contexts/AuthContext';
import { InterfaceVersionSwitch } from './InterfaceVersionSwitch';
import { WorkplaceAccountMenu } from './WorkplaceAccountMenu';
import { WorkplaceNotifications } from './WorkplaceNotifications';
import { WorkplaceTimePreview } from './WorkplaceTimePreview';
import { ReferralTopbarButton } from '@/components/referrals/ReferralTopbarButton';
import { OttoTopbarButton } from '@/components/otto/OttoTopbarButton';
import './workplace-topbar.css';
import { workspaceNavigation } from './workspaceNavigation';
import { WorkspaceSearch } from './WorkspaceSearch';
import { NewsTopbarButton } from './NewsTopbarButton';
import { useLanguage } from '@/i18n';


export function WorkspaceTopbar({ organizationName, userName }: { organizationName?: string; userName?: string }) {
  const [searchOpen, setSearchOpen] = useState(false);
  const navigate = useNavigate();
  const { isSuperAdmin } = useAuth();
  const { modules } = useModules();
  const { canViewModule, isAdmin } = usePermissions();
  const { t } = useLanguage();
  const { isModuleLocked } = useSubscription();
  const searchItems = workspaceNavigation.filter((item) => (!item.adminOnly || isAdmin) && (
    !item.moduleKey || (!isModuleLocked(item.moduleKey) && modules[item.moduleKey] && canViewModule(item.moduleKey))));

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
    <header className="workspace-topbar flex h-16 min-w-0 items-center justify-between gap-3 px-4 text-white xl:px-6">
      <button type="button" data-workspace-search data-otto-target="guide-search" onClick={() => setSearchOpen(true)}
        className="flex h-10 min-w-0 w-full max-w-[450px] items-center gap-3 rounded-full border border-white/10 bg-white/[.07] px-4 text-left text-sm text-[#a7b2c7] transition-colors hover:border-[#6e93d8]/40 hover:bg-white/[.11] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5a94ff]">
        <Search className="h-4 w-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{t("Procurar módulos e páginas...")}</span>
        <kbd className="hidden rounded-md border border-white/15 px-1.5 py-0.5 text-[10px] font-semibold text-[#8c9bb6] lg:block">Ctrl K</kbd>
      </button>
      <div className="workplace-header-actions flex shrink-0 items-center gap-2"><NewsTopbarButton /><InterfaceVersionSwitch />
        {isSuperAdmin && <button type="button" className="workplace-admin-link" onClick={() => navigate('/system-admin')} aria-label={t("Abrir administração")}><Shield className="h-4 w-4" aria-hidden="true" /><span>Admin</span></button>}
        <ReferralTopbarButton />
        <OttoTopbarButton />
        <WorkplaceNotifications />
        <WorkplaceTimePreview />
        <WorkplaceAccountMenu userName={userName} organizationName={organizationName} />
      </div>
    </header>
    <WorkspaceSearch open={searchOpen} onOpenChange={setSearchOpen} items={searchItems} />
  </>;
}
