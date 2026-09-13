import { NavLink, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, Users, Settings, LogOut, Shield, X, Building2,
  Calendar, FileText, ShoppingBag, Store, UserCheck, Mail, Wallet, Search, MessageSquare, Workflow,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useModules, EnabledModules } from "@/hooks/useModules";
import { usePermissions } from "@/hooks/usePermissions";
import { useSubscription } from "@/hooks/useSubscription";
import { APP_VERSION } from "@/lib/constants";
import type { AppRole } from "@/types";
import { Button } from "@/components/ui/button";
import { hasPerfect2GetherAccess } from "@/lib/perfect2gether";

// Same set as the desktop sidebar so the mobile menu is never missing pages.
const allNavItems: { to: string; icon: React.ElementType; label: string; moduleKey?: keyof EnabledModules }[] = [
  { to: "/dashboard", icon: LayoutDashboard, label: "Painel" },
  { to: "/leads", icon: Users, label: "Leads" },
  { to: "/inbox", icon: MessageSquare, label: "Caixa de Entrada", moduleKey: 'inbox' },
  { to: "/clients", icon: UserCheck, label: "Clientes", moduleKey: 'clients' },
  { to: "/proposals", icon: FileText, label: "Propostas", moduleKey: 'proposals' },
  { to: "/sales", icon: ShoppingBag, label: "Vendas", moduleKey: 'sales' },
  { to: "/financeiro", icon: Wallet, label: "Financeiro", moduleKey: 'finance' },
  { to: "/calendar", icon: Calendar, label: "Agenda", moduleKey: 'calendar' },
  { to: "/marketing", icon: Mail, label: "Marketing", moduleKey: 'marketing' },
  { to: "/automacoes", icon: Workflow, label: "Automações" },
  { to: "/prospects", icon: Search, label: "Prospects", moduleKey: 'prospects' },
  { to: "/settings", icon: Settings, label: "Definições" },
];

const getRoleLabel = (roles: AppRole[]): string => {
  if (roles.includes('super_admin')) return 'Super Admin';
  if (roles.includes('admin')) return 'Administrador';
  if (roles.includes('viewer')) return 'Visualizador';
  return 'Colaborador';
};

interface MobileMenuProps {
  isOpen: boolean;
  onClose: () => void;
  userName?: string;
  organizationName?: string;
}

export function MobileMenu({ isOpen, onClose, userName = "Utilizador", organizationName = "A Minha Empresa" }: MobileMenuProps) {
  const navigate = useNavigate();
  const { signOut, roles, isSuperAdmin, organization, organizations } = useAuth();
  const { modules } = useModules();
  const { canViewModule } = usePermissions();
  const { isModuleLocked } = useSubscription();
  const hasPerfect2GetherModuleAccess = hasPerfect2GetherAccess({
    organizationId: organization?.id,
    memberships: organizations,
    isSuperAdmin,
  });

  // Same visibility rule as the desktop sidebar (module enabled + viewable).
  const navItems = allNavItems.filter((item) => {
    if (!item.moduleKey) return true;
    if (isModuleLocked(item.moduleKey)) return false;
    if (!modules[item.moduleKey]) return false;
    if (!canViewModule(item.moduleKey)) return false;
    return true;
  });

  const handleLogout = async () => {
    await signOut();
    navigate('/');
    onClose();
  };

  const handleNavClick = () => {
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-40 bg-background animate-in slide-in-from-left duration-200">
      {/* Close button area - respects safe area */}
      <div className="flex items-center justify-end px-4" style={{ paddingTop: 'calc(clamp(20px, env(safe-area-inset-top, 0px), 50px) + 0.5rem)', minHeight: '3.5rem' }}>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="h-5 w-5" />
        </Button>
      </div>

      <div className="flex flex-col h-[calc(100%-3.5rem)] px-6 pb-safe">
        {/* User Info */}
        <div className="flex items-center gap-4 py-6 border-b border-border">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-lg font-semibold text-primary">
            {userName.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 overflow-hidden">
            <p className="truncate font-medium text-foreground">
              {userName}
            </p>
            <p className="text-sm text-muted-foreground">{getRoleLabel(roles)}</p>
            <p className="text-xs text-muted-foreground/70 truncate mt-0.5">
              {organizationName}
            </p>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-6 space-y-2">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={handleNavClick}
              className={({ isActive }) => cn(
                "flex items-center gap-4 rounded-xl px-4 py-3.5 text-base font-medium transition-colors",
                isActive
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <item.icon className="h-5 w-5" />
              {item.label}
            </NavLink>
          ))}
          
          {hasPerfect2GetherModuleAccess && (
            <NavLink
              to="/portal-total-link"
              onClick={handleNavClick}
              className={({ isActive }) => cn(
                "flex items-center gap-4 rounded-xl px-4 py-3.5 text-base font-medium transition-colors",
                isActive
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <Building2 className="h-5 w-5" />
              Portal Total Link
            </NavLink>
          )}

          {isSuperAdmin && (
            <NavLink
              to="/system-admin"
              onClick={handleNavClick}
              className={({ isActive }) => cn(
                "flex items-center gap-4 rounded-xl px-4 py-3.5 text-base font-medium transition-colors",
                isActive
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <Shield className="h-5 w-5" />
              System Admin
            </NavLink>
          )}
        </nav>

        {/* Logout & Version */}
        <div className="py-6 border-t border-border space-y-4">
          <button 
            onClick={handleLogout}
            className="flex items-center gap-4 w-full rounded-xl px-4 py-3.5 text-base font-medium text-destructive hover:bg-destructive/10 transition-colors"
          >
            <LogOut className="h-5 w-5" />
            Terminar Sessão
          </button>
          
          <p className="text-center text-xs text-muted-foreground/50 leading-tight">
            Senvia OS v{APP_VERSION}
            <span className="block text-[10px] text-muted-foreground/40">
              {typeof window !== 'undefined' ? window.location.host : ''}
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}
