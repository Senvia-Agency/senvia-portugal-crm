import { useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { LayoutDashboard, Users, Settings, LogOut, Shield, Calendar, FileText, ShoppingBag, Store, UserCheck, Mail, Wallet, Lock, Search, Building2, MessageSquare, PanelLeftClose, PanelLeftOpen, Percent, Workflow } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useOttoStore } from "@/stores/useOttoStore";
import { useSidebarStore } from "@/stores/useSidebarStore";
import { useModules, EnabledModules } from "@/hooks/useModules";
import { usePermissions } from "@/hooks/usePermissions";
import { useActivationProgress } from "@/hooks/useActivationProgress";
import { useSubscription } from "@/hooks/useSubscription";
import { APP_VERSION } from "@/lib/constants";
import type { AppRole } from "@/types";
import { OrganizationSwitcher } from "./OrganizationSwitcher";
import { WhatsNewButton } from "@/components/announcements/WhatsNewButton";
import { InboxUnreadBadge } from "./InboxUnreadBadge";
import { UpgradeModal } from "@/components/shared/UpgradeModal";
import { hasPerfect2GetherAccess } from "@/lib/perfect2gether";

interface NavItem {
  to: string;
  icon: React.ElementType;
  label: string;
  moduleKey?: keyof EnabledModules;
  ottoTarget?: string;
}

const allNavItems: NavItem[] = [
  { to: "/dashboard", icon: LayoutDashboard, label: "Painel" },
  { to: "/leads", icon: Users, label: "Leads", ottoTarget: "sidebar-leads" },
  { to: "/inbox", icon: MessageSquare, label: "Caixa de Entrada", moduleKey: 'inbox' },
  { to: "/clients", icon: UserCheck, label: "Clientes", moduleKey: 'clients' },
  { to: "/proposals", icon: FileText, label: "Propostas", moduleKey: 'proposals' },
  { to: "/sales", icon: ShoppingBag, label: "Vendas", moduleKey: 'sales' },
  { to: "/financeiro", icon: Wallet, label: "Financeiro", moduleKey: 'finance' },
  { to: "/calendar", icon: Calendar, label: "Agenda", moduleKey: 'calendar' },
  { to: "/marketing", icon: Mail, label: "Marketing", moduleKey: 'marketing' },
  { to: "/automacoes", icon: Workflow, label: "Automações" },
  { to: "/prospects", icon: Search, label: "Prospects", moduleKey: 'prospects' },
  { to: "/settings", icon: Settings, label: "Definições", ottoTarget: "sidebar-settings" },
];

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
  userName?: string;
  organizationName?: string;
}

export function AppSidebar({
  userName = "Utilizador",
  organizationName = "A Minha Empresa"
}: AppSidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { signOut, roles, isSuperAdmin, organization, organizations } = useAuth();
  const { setOpen: setOttoOpen } = useOttoStore();
  const collapsed = useSidebarStore((s) => s.collapsed);
  const toggleCollapsed = useSidebarStore((s) => s.toggle);
  const { modules } = useModules();
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

  const navItems = allNavItems.filter(item => {
    if (!item.moduleKey) return true;
    if (isModuleLocked(item.moduleKey)) return true;
    if (!modules[item.moduleKey]) return false;
    if (!canViewModule(item.moduleKey)) return false;
    return true;
  });

  const handleLogout = async () => {
    await signOut();
    navigate('/');
  };

  const handleLockedClick = (e: React.MouseEvent, item: NavItem) => {
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
        "fixed left-0 top-0 z-40 h-dvh gradient-sidebar border-r border-sidebar-border transition-[width] duration-200",
        collapsed ? "w-16" : "w-64",
      )}>
        <div className="flex h-full flex-col">
          <div className={cn("flex h-16 items-center border-b border-sidebar-border", collapsed ? "justify-center px-2" : "justify-between px-4")}>
            {!collapsed && (
              <img
                alt={organization?.name || "SENVIA"}
                className="h-10 w-40 object-contain"
                src={organization?.logo_url || "/lovable-uploads/a73ec7d1-f1a3-458c-8d12-82bca71d2d34.png"}
              />
            )}
            <div className="flex items-center gap-0.5">
              {!collapsed && <WhatsNewButton variant="sidebar" />}
              <button
                type="button"
                onClick={toggleCollapsed}
                title={collapsed ? "Expandir menu" : "Recolher menu"}
                className="rounded-lg p-2 text-sidebar-muted transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
              >
                {collapsed ? <PanelLeftOpen className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
              </button>
            </div>
          </div>

          {!collapsed && (
            <div className="border-b border-sidebar-border px-3 py-3">
              <OrganizationSwitcher />
            </div>
          )}

          <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
            {navItems.map(item => {
              const locked = item.moduleKey ? isModuleLocked(item.moduleKey) : false;
              const isActive = location.pathname === item.to || item.to !== "/dashboard" && location.pathname.startsWith(item.to);

              return (
                <NavLink
                  key={item.to}
                  to={locked ? "#" : item.to}
                  data-otto-target={item.ottoTarget}
                  onClick={(e) => handleLockedClick(e, item)}
                  title={collapsed ? item.label : undefined}
                  className={cn(
                    "group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200",
                    collapsed && "justify-center",
                    locked
                      ? "cursor-pointer text-sidebar-muted/50 hover:bg-sidebar-accent/30"
                      : isActive
                        ? "bg-sidebar-accent text-sidebar-foreground"
                        : "text-sidebar-muted hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                  )}
                >
                  <item.icon className="h-5 w-5 shrink-0" />
                  {!collapsed && <span className="flex-1">{item.label}</span>}
                  {item.to === "/inbox" && !locked && (
                    <span className={cn(collapsed && "absolute right-0.5 top-0.5 scale-90")}>
                      <InboxUnreadBadge />
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
                title={collapsed ? "Portal Total Link" : undefined}
                className={cn(
                  "group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200",
                  collapsed && "justify-center",
                  location.pathname.startsWith("/portal-total-link")
                    ? "bg-sidebar-accent text-sidebar-foreground"
                    : "text-sidebar-muted hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                )}
              >
                <Building2 className="h-5 w-5 shrink-0" />
                {!collapsed && "Portal Total Link"}
                {collapsed && <CollapsedTooltip label="Portal Total Link" />}
              </NavLink>
            )}

            {isSuperAdmin && (
              <NavLink
                to="/system-admin"
                title={collapsed ? "System Admin" : undefined}
                className={cn(
                  "group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200",
                  collapsed && "justify-center",
                  location.pathname.startsWith("/system-admin")
                    ? "bg-sidebar-accent text-sidebar-foreground"
                    : "text-sidebar-muted hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                )}
              >
                <Shield className="h-5 w-5 shrink-0" />
                {!collapsed && "System Admin"}
                {collapsed && <CollapsedTooltip label="System Admin" />}
              </NavLink>
            )}
          </nav>

          <div className={cn("border-t border-sidebar-border", collapsed ? "p-2" : "p-4")}>
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
