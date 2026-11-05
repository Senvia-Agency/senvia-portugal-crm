import {
  CalendarClock, CalendarDays, Gift, ListTodo, MessagesSquare, Newspaper, FileText, LayoutDashboard, Mail, MessageSquare,
  Search, Settings, Shield, ShoppingBag, Building2, Sparkles, UserCheck, Users, Wallet, Workflow, AtSign,
  type LucideIcon,
} from 'lucide-react';
import type { EnabledModules } from '@/hooks/useModules';
import { tr } from '@/i18n';

/** The WebMail (/webmail) replaces the email section of the Inbox (Senvia 2.0, live everywhere). */
export const WEBMAIL_ENABLED = true;

export interface WorkspaceNavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  group: 'Visão geral' | 'Comunicação' | 'Trabalho' | 'Comercial' | 'Gestão';
  moduleKey?: keyof EnabledModules;
  /** Only organization admins see it (the referral dashboard is theirs). */
  adminOnly?: boolean;
  ottoTarget?: string;
}

export const workspaceNavigationGroups = ['Visão geral', 'Comunicação', 'Trabalho', 'Comercial', 'Gestão'] as const;

export const workspaceNavigation: WorkspaceNavItem[] = [
  { to: '/feed', label: 'Feed', icon: Newspaper, group: 'Comunicação', ottoTarget: 'guide-feed' },
  { to: '/tasks', label: 'Tarefas', icon: ListTodo, group: 'Trabalho', ottoTarget: 'guide-tasks' },
  { to: '/dashboard', label: 'Painel', icon: LayoutDashboard, group: 'Visão geral' },
  { to: '/indicacoes', label: 'Indicações', icon: Gift, group: 'Visão geral', adminOnly: true, ottoTarget: 'guide-referrals-nav' },
  { to: '/inbox', label: 'Caixa de entrada', icon: MessageSquare, group: 'Comunicação', moduleKey: 'inbox', ottoTarget: 'guide-inbox' },
  // WebMail: the email caixas leave the Inbox.
  ...(WEBMAIL_ENABLED ? [{ to: '/webmail', label: 'Email', icon: AtSign, group: 'Comunicação' as const, moduleKey: 'inbox' as const, ottoTarget: 'guide-email' }] : []),
  { to: '/calendar', label: 'Agenda', icon: CalendarDays, group: 'Trabalho', moduleKey: 'calendar' },
  { to: '/ponto', label: 'Ponto', icon: CalendarClock, group: 'Trabalho' },
  { to: '/leads', label: 'Leads', icon: Users, group: 'Comercial', ottoTarget: 'sidebar-leads' },
  { to: '/clients', label: 'Clientes', icon: UserCheck, group: 'Comercial', moduleKey: 'clients' },
  { to: '/proposals', label: 'Propostas', icon: FileText, group: 'Comercial', moduleKey: 'proposals' },
  { to: '/sales', label: 'Vendas', icon: ShoppingBag, group: 'Comercial', moduleKey: 'sales' },
  { to: '/financeiro', label: 'Financeiro', icon: Wallet, group: 'Gestão', moduleKey: 'finance' },
  { to: '/automacoes', label: 'Automações', icon: Workflow, group: 'Gestão', ottoTarget: 'guide-automations' },
  { to: '/automacoes/feed', label: 'Feed das automações', icon: Newspaper, group: 'Gestão' },
  // Campaigns are occasional work: kept low in the menu, out of the daily Comunicação group.
  { to: '/marketing', label: 'Marketing', icon: Mail, group: 'Gestão', moduleKey: 'marketing' },
  { to: '/prospects', label: 'Prospects', icon: Search, group: 'Comercial', moduleKey: 'prospects' },
  { to: '/settings', label: 'Definições', icon: Settings, group: 'Gestão', ottoTarget: 'sidebar-settings' },
];

const extraPages: Record<string, Pick<WorkspaceNavItem, 'label' | 'icon'>> = {
  // Novidades opens from the top bar, not the menu.
  '/novidades': { label: 'Novidades', icon: Sparkles },
  // Internal messages live in the Inbox; the standalone page stays reachable for old links and tabs.
  '/mensagens': { label: 'Mensagens', icon: MessagesSquare },
  '/portal-total-link': { label: 'Portal Total Link', icon: Building2 },
  '/system-admin': { label: 'Administração', icon: Shield },
};

export function getWorkspacePage(pathname: string): Pick<WorkspaceNavItem, 'label' | 'icon'> & { key: string } {
  const key = `/${pathname.split('/').filter(Boolean)[0] ?? 'dashboard'}`;
  const item = workspaceNavigation.find((entry) => entry.to === key) ?? extraPages[key];
  return { key, label: item?.label ? tr(item.label) : 'Senvia', icon: item?.icon ?? LayoutDashboard };
}
