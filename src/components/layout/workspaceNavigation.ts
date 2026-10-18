import {
  CalendarDays, FileText, LayoutDashboard, Mail, MessageSquare,
  Search, Settings, Shield, ShoppingBag, Building2, UserCheck, Users, Wallet, Workflow,
  type LucideIcon,
} from 'lucide-react';
import type { EnabledModules } from '@/hooks/useModules';

export interface WorkspaceNavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  group: 'Visão geral' | 'Comercial' | 'Operação';
  moduleKey?: keyof EnabledModules;
  ottoTarget?: string;
}

export const workspaceNavigation: WorkspaceNavItem[] = [
  { to: '/dashboard', label: 'Painel', icon: LayoutDashboard, group: 'Visão geral' },
  { to: '/inbox', label: 'Caixa de entrada', icon: MessageSquare, group: 'Visão geral', moduleKey: 'inbox' },
  { to: '/calendar', label: 'Agenda', icon: CalendarDays, group: 'Visão geral', moduleKey: 'calendar' },
  { to: '/leads', label: 'Leads', icon: Users, group: 'Comercial', ottoTarget: 'sidebar-leads' },
  { to: '/clients', label: 'Clientes', icon: UserCheck, group: 'Comercial', moduleKey: 'clients' },
  { to: '/proposals', label: 'Propostas', icon: FileText, group: 'Comercial', moduleKey: 'proposals' },
  { to: '/sales', label: 'Vendas', icon: ShoppingBag, group: 'Comercial', moduleKey: 'sales' },
  { to: '/financeiro', label: 'Financeiro', icon: Wallet, group: 'Comercial', moduleKey: 'finance' },
  { to: '/marketing', label: 'Marketing', icon: Mail, group: 'Operação', moduleKey: 'marketing' },
  { to: '/automacoes', label: 'Automações', icon: Workflow, group: 'Operação' },
  { to: '/prospects', label: 'Prospects', icon: Search, group: 'Operação', moduleKey: 'prospects' },
  { to: '/settings', label: 'Definições', icon: Settings, group: 'Operação', ottoTarget: 'sidebar-settings' },
];

const extraPages: Record<string, Pick<WorkspaceNavItem, 'label' | 'icon'>> = {
  '/novidades': { label: 'Novidades', icon: MessageSquare },
  '/portal-total-link': { label: 'Portal Total Link', icon: Building2 },
  '/system-admin': { label: 'Administração', icon: Shield },
};

export function getWorkspacePage(pathname: string): Pick<WorkspaceNavItem, 'label' | 'icon'> & { key: string } {
  const key = `/${pathname.split('/').filter(Boolean)[0] ?? 'dashboard'}`;
  const item = workspaceNavigation.find((entry) => entry.to === key) ?? extraPages[key];
  return { key, label: item?.label ?? 'Senvia', icon: item?.icon ?? LayoutDashboard };
}
