import {
  CalendarDays, ListTodo, Newspaper, FileText, LayoutDashboard, Mail, MessageSquare,
  Search, Settings, Shield, ShoppingBag, Building2, UserCheck, Users, Wallet, Workflow,
  type LucideIcon,
} from 'lucide-react';
import type { EnabledModules } from '@/hooks/useModules';

export interface WorkspaceNavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  group: 'Visão geral' | 'Comunicação' | 'Trabalho' | 'Comercial' | 'Gestão';
  moduleKey?: keyof EnabledModules;
  ottoTarget?: string;
}

export const workspaceNavigationGroups = ['Visão geral', 'Comunicação', 'Trabalho', 'Comercial', 'Gestão'] as const;

export const workspaceNavigation: WorkspaceNavItem[] = [
  ...((import.meta.env.DEV || import.meta.env.MODE === "local-preview") ? [{ to: '/feed', label: 'Feed', icon: Newspaper, group: 'Comunicação' as const }, { to: '/tasks', label: 'Tarefas', icon: ListTodo, group: 'Trabalho' as const }] : []),
  { to: '/dashboard', label: 'Painel', icon: LayoutDashboard, group: 'Visão geral' },
  { to: '/inbox', label: 'Caixa de entrada', icon: MessageSquare, group: 'Comunicação', moduleKey: 'inbox' },
  { to: '/calendar', label: 'Agenda', icon: CalendarDays, group: 'Trabalho', moduleKey: 'calendar' },
  { to: '/leads', label: 'Leads', icon: Users, group: 'Comercial', ottoTarget: 'sidebar-leads' },
  { to: '/clients', label: 'Clientes', icon: UserCheck, group: 'Comercial', moduleKey: 'clients' },
  { to: '/proposals', label: 'Propostas', icon: FileText, group: 'Comercial', moduleKey: 'proposals' },
  { to: '/sales', label: 'Vendas', icon: ShoppingBag, group: 'Comercial', moduleKey: 'sales' },
  { to: '/financeiro', label: 'Financeiro', icon: Wallet, group: 'Gestão', moduleKey: 'finance' },
  { to: '/marketing', label: 'Marketing', icon: Mail, group: 'Comunicação', moduleKey: 'marketing' },
  { to: '/automacoes', label: 'Automações', icon: Workflow, group: 'Gestão' },
  { to: '/prospects', label: 'Prospects', icon: Search, group: 'Comercial', moduleKey: 'prospects' },
  { to: '/settings', label: 'Definições', icon: Settings, group: 'Gestão', ottoTarget: 'sidebar-settings' },
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
