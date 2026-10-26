import { useRef, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useScrollEdges } from './useScrollEdges';
import { LogOut, Shield, Lock, Building2, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useOttoStore } from "@/stores/useOttoStore";
import { useSidebarStore } from "@/stores/useSidebarStore";
import { useModules } from "@/hooks/useModules";
import { usePermissions } from "@/hooks/usePermissions";
import { useActivationProgress } from "@/hooks/useActivationProgress";
import { useSubscription } from "@/hooks/useSubscription";
import { APP_VERSION } from "@/lib/constants";
import type { AppRole } from "@/types";
import { OrganizationSwitcher } from "./OrganizationSwitcher";
import { WhatsNewButton } from "@/components/announcements/WhatsNewButton";
import { InboxUnreadBadge } from "./InboxUnreadBadge";
import { WebmailUnreadBadge } from "@/features/webmail/WebmailUnreadBadge";
import { UpgradeModal } from "@/components/shared/UpgradeModal";
import { hasPerfect2GetherAccess } from "@/lib/perfect2gether";
import { workspaceNavigationGroups, workspaceNavigation, type WorkspaceNavItem } from './workspaceNavigation';
import { ModuleNavIcon } from './ModuleNavIcon';

// Hover tooltip shown only when the sidebar is collapsed (parent must be `group`).
function CollapsedTooltip({ label }: { label: string }) {
  return (
    <span className="pointer-events-none absolute left-full z-50 ml-2 hidden whitespace-nowrap rounded-md border border-sidebar-border bg-sidebar-accent px-2 py-1 text-xs font-medium text-sidebar-foreground shadow-md group-hover:block">
      {label}
    </span>
  );
}

const getRoleLabel = (roles: AppRole[]): string => {
  if (roles.includes('super_admin')) return 'Super Admin';
  if (roles.includes('admin')) return 'Administrador';
  if (roles.includes('viewer')) return 'Visualizador';
  return 'Colaborador';
};

interface AppSidebarProps {
  legacy?: boolean;
  userName?: string;
  organizationName?: string;
  forceCollapsed?: boolean;
  expanded?: boolean;
  onExpand?: () => void;
  onCollapse?: () => void;
  onNavigate?: () => void;
}

export function AppSidebar({
  userName = "Utilizador",
  organizationName = "A Minha Empresa",
  forceCollapsed = false,
  expanded = false,
  onExpand,
  onCollapse,
  onNavigate,
  legacy = false,
}: AppSidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { signOut, roles, isSuperAdmin, organization, organizations } = useAuth();
  const { setOpen: setOttoOpen } = useOttoStore();
  const savedCollapsed = useSidebarStore((s) => s.collapsed);
  const collapsed = !expanded && (savedCollapsed || forceCollapsed);
  const toggleCollapsed = useSidebarStore((s) => s.toggle);
  const { modules } = useModules();
  // Short screens (tablets) hide part of the list: fade the cut edge so it reads as scrollable.
  const navRef = useRef<HTMLElement>(null);
  const navEdges = useScrollEdges(navRef, 'y');
  const { canViewModule } = usePermissions();
  const { isModuleLocked, getRequiredPlan } = useSubscription();
  const activation = useActivationProgress();
  const showSetupBadge = activation.isAdmin && activation.ready && activation.done < activation.total;
  const hasPerfect2GetherModuleAccess = hasPerfect2GetherAccess({
    organizationId: organization?.id,
    memberships: organizations,
    isSuperAdmin,
  });

  const [upgradeModal, setUpgradeModal] = useState<{ open: boolean; feature: string; plan: string }>({
    open: false, feature: '', plan: ''
  });

  const navItems = workspaceNavigation.filter(item => {
    if (!item.moduleKey) return true;
    if (isModuleLocked(item.moduleKey)) return true;
    if (!modules[item.moduleKey]) return false;
    if (!canViewModule(item.moduleKey)) return false;
    return true;
  });
  if (legacy) {
    const order = ['/dashboard', '/leads', '/inbox', '/clients', '/proposals', '/sales', '/financeiro', '/calendar', '/marketing', '/automacoes', '/prospects', '/settings'];
    navItems.sort((a, b) => order.indexOf(a.to) - order.indexOf(b.to));
  }

  const handleLogout = async () => {
    await signOut();
    navigate('/');
  };

  const handleLockedClick = (e: React.MouseEvent, item: WorkspaceNavItem) => {
    if (item.moduleKey && isModuleLocked(item.moduleKey)) {
      e.preventDefault();
      setUpgradeModal({
        open: true,
        feature: item.label,
        plan: getRequiredPlan(item.moduleKey),
      });
    }
  };

  return (
    <>
      <aside className={cn(
        "workspace-sidebar fixed left-0 top-0 z-40 h-dvh gradient-sidebar border-r border-white/10 transition-[width] duration-200",
        collapsed ? "w-16" : "w-64",
      )}>
        <div className="flex h-full flex-col">
          <div className={cn("workspace-sidebar-brand flex h-16 items-center border-b border-white/10", collapsed ? "justify-center px-2" : "justify-between px-5")}>
            {!collapsed && (
              <div className="flex items-center gap-2.5" aria-label="Senvia OS">
                <img src="/senvia-logo-white.png" alt="Senvia" width={112} height={39} className="h-auto w-28 shrink-0 object-contain" /><span className="workplace-brand-caption">WORKPLACE</span>
              </div>
            )}
            <div className="flex items-center gap-0.5">
              {!collapsed && <WhatsNewButton variant="sidebar" />}
              <button
                type="button"
                onClick={collapsed ? onExpand ?? toggleCollapsed : onCollapse ?? toggleCollapsed}
                title={collapsed ? "Expandir menu" : "Recolher menu"}
                aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
                aria-expanded={!collapsed}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-sidebar-muted transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {collapsed ? <PanelLeftOpen className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
              </button>
            </div>
          </div>

          {!collapsed && (
            <div className="workspace-sidebar-org border-b border-sidebar-border px-3 py-3">
              <OrganizationSwitcher />
            </div>
          )}

          <nav ref={navRef} data-fade-start={navEdges.start} data-fade-end={navEdges.end}
            className="workspace-sidebar-nav scroll-fade-y min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-3 py-5" aria-label="Navegação principal">
            {(legacy ? ['Navegação'] : workspaceNavigationGroups).map(group => (
              <div key={group} className="space-y-1">
                {!collapsed && !legacy && <p className="px-3 pb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-[#71809c]">{group}</p>}
                {navItems.filter(item => legacy || item.group === group).map(item => {
              const locked = item.moduleKey ? isModuleLocked(item.moduleKey) : false;
              const isActive = location.pathname === item.to || item.to !== "/dashboard" && location.pathname.startsWith(item.to);

              return (
                <NavLink
                  key={item.to}
                  to={locked ? "#" : item.to}
                  data-otto-target={item.ottoTarget}
                  onClick={(e) => { handleLockedClick(e, item); if (!e.defaultPrevented) onNavigate?.(); }}
                  title={collapsed ? item.label : undefined}
                  className={cn(
                    "workspace-sidebar-link group relative flex items-center gap-3 rounded-xl px-3 py-2 text-[13px] font-medium transition-colors duration-150",
                    collapsed && "justify-center px-0",
                    locked
                      ? "cursor-pointer text-sidebar-muted/50 hover:bg-sidebar-accent/30"
                      : isActive
                        ? "bg-[#243453] text-white shadow-[inset_3px_0_0_#5c9aff]"
                        : "text-[#a9b4ca] hover:bg-white/[.07] hover:text-white"
                  )}
                >
                  <ModuleNavIcon icon={item.icon} to={item.to} sidebar locked={locked} />
                  {!collapsed && <span className="flex-1">{item.label}</span>}
                  {item.to === "/inbox" && !locked && (
                    <span className={cn(collapsed && "absolute right-0.5 top-0.5 scale-90")}>
                      <InboxUnreadBadge />
                    </span>
                  )}
                  {item.to === "/webmail" && !locked && (
                    <span className={cn(collapsed && "absolute right-0.5 top-0.5 scale-90")}>
                      <WebmailUnreadBadge />
                    </span>
                  )}
                  {item.to === "/settings" && showSetupBadge && (
                    collapsed ? (
                      <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-primary" title={`Configurar (${activation.done}/${activation.total})`} />
                    ) : (
                      <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs font-semibold text-primary" title="Passos de configuração concluídos">
                        {activation.done}/{activation.total}
                      </span>
                    )
                  )}
                  {!collapsed && locked && <Lock className="h-3.5 w-3.5 text-sidebar-muted/60" />}
                  {collapsed && <CollapsedTooltip label={item.label} />}
                </NavLink>
              );
                })}
              </div>
            ))}

            {/* Otto support chat — opens the assistant window (no route) */}
            <button
              type="button"
              onClick={() => setOttoOpen(true)}
              title={collapsed ? "Suporte / Otto" : undefined}
              className={cn(
                "group relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-sidebar-muted transition-all duration-200 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
                collapsed && "justify-center",
              )}
            >
              <img src="/otto-mascot.svg" alt="Otto" className="h-5 w-5 shrink-0 rounded-full" />
              {!collapsed && <span className="flex-1 text-left">Suporte / Otto</span>}
              {collapsed && <CollapsedTooltip label="Suporte / Otto" />}
            </button>

            {hasPerfect2GetherModuleAccess && (
              <NavLink
                to="/portal-total-link"
                onClick={onNavigate}
                title={collapsed ? "Portal Total Link" : undefined}
                className={cn(
                  "group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200",
                  collapsed && "justify-center",
                  location.pathname.startsWith("/portal-total-link")
                    ? "bg-sidebar-accent text-sidebar-foreground"
                    : "text-sidebar-muted hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                )}
              >
                <ModuleNavIcon icon={Building2} to="/portal-total-link" sidebar />
                {!collapsed && "Portal Total Link"}
                {collapsed && <CollapsedTooltip label="Portal Total Link" />}
              </NavLink>
            )}

            {/* Workplace reaches System Admin from the "Admin" button in the top bar. */}
            {isSuperAdmin && legacy && (
              <NavLink
                to="/system-admin"
                onClick={onNavigate}
                title={collapsed ? "System Admin" : undefined}
                className={cn(
                  "group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200",
                  collapsed && "justify-center",
                  location.pathname.startsWith("/system-admin")
                    ? "bg-sidebar-accent text-sidebar-foreground"
                    : "text-sidebar-muted hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                )}
              >
                <ModuleNavIcon icon={Shield} to="/system-admin" sidebar />
                {!collapsed && "System Admin"}
                {collapsed && <CollapsedTooltip label="System Admin" />}
              </NavLink>
            )}
          </nav>

          <div className={cn("workspace-sidebar-account border-t border-sidebar-border", collapsed ? "p-2" : "p-4")}>
            <div className={cn("flex items-center gap-3", collapsed && "justify-center")}>
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sidebar-accent text-sm font-semibold text-sidebar-foreground">
                {userName.charAt(0).toUpperCase()}
              </div>
              {!collapsed && (
                <>
                  <div className="flex-1 overflow-hidden">
                    <p className="truncate text-sm font-medium text-sidebar-foreground">
                      {userName}
                    </p>
                    <p className="text-xs text-sidebar-muted">{getRoleLabel(roles)}</p>
                  </div>
                  <button onClick={handleLogout} className="rounded-lg p-2 text-sidebar-muted transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground" title="Terminar sessão">
                    <LogOut className="h-4 w-4" />
                  </button>
                </>
              )}
            </div>
            {collapsed && (
              <button onClick={handleLogout} className="group relative mt-1 flex w-full justify-center rounded-lg p-2 text-sidebar-muted transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground" title="Terminar sessão">
                <LogOut className="h-4 w-4" />
                <CollapsedTooltip label="Terminar sessão" />
              </button>
            )}
          </div>

          {!collapsed && (
            <div className="px-4 py-2 text-center leading-tight">
              <NavLink
                to="/novidades"
                onClick={onNavigate}
                className="block text-[10px] text-sidebar-muted/60 transition-colors hover:text-sidebar-muted"
              >
                Senvia OS v{APP_VERSION}
              </NavLink>
              <span className="block text-[9px] text-sidebar-muted/40">
                {typeof window !== 'undefined' ? window.location.host : ''}
              </span>
            </div>
          )}
        </div>
      </aside>

      <UpgradeModal
        open={upgradeModal.open}
        onOpenChange={(open) => setUpgradeModal(prev => ({ ...prev, open }))}
        featureName={upgradeModal.feature}
        requiredPlan={upgradeModal.plan}
      />
    </>
  );
}
