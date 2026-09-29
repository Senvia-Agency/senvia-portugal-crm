import { Building, UsersRound, Package, Link2, Bell, Receipt, Shield, GitBranch, LayoutGrid, FileText, List, KeyRound, UserCog, Network, BellRing, AlertTriangle, Calculator, ShoppingCart, CreditCard, Calendar, Mail, LifeBuoy, User, FormInput, TrendingUp, Plug, Radio, Gift } from "lucide-react";
import { SettingsCard } from "./SettingsCard";

// Settings information architecture: 8 balanced top-level groups, 2 navigation
// levels (group card -> tabbed content). Reorganized from the former 9-group /
// 3-level layout where "Definições Gerais" was an overloaded 7-subsection bucket.
export type SettingsSection =
  | "account" | "modules" | "capture" | "sales" | "team" | "integrations" | "finance" | "alerts";

export type SettingsSubSection =
  | "account-profile" | "account-security" | "account-company" | "account-plan" | "account-referrals" | "account-support"
  | "modules-list" | "modules-fields" | "modules-documents"
  | "capture-forms"
  | "sales-pipeline" | "sales-rules" | "sales-commissions" | "sales-products" | "sales-operators"
  | "team-access" | "team-profiles" | "team-teams"
  | "integrations-connect"
  | "finance-fiscal" | "finance-expenses"
  | "alerts-push" | "alerts-calendar" | "alerts-email" | "alerts-fidelization";

interface MobileSettingsNavProps {
  activeSection: SettingsSection | null;
  onSelectSection: (section: SettingsSection) => void;
  canManageTeam: boolean;
  canManageIntegrations: boolean;
  isTelecom?: boolean;
}

interface SectionItem {
  id: SettingsSection;
  label: string;
  icon: any;
  description: string;
  tint: string;
  iconColor: string;
  requiresTeam?: boolean;
  requiresIntegrations?: boolean;
}

const sections: SectionItem[] = [
  { id: "account", label: "A Minha Conta", icon: User, description: "Perfil, empresa, plano e suporte", tint: "bg-blue-500/10", iconColor: "text-blue-600" },
  { id: "modules", label: "Módulos e Campos", icon: LayoutGrid, description: "Funcionalidades e campos do CRM", tint: "bg-violet-500/10", iconColor: "text-violet-600" },
  { id: "capture", label: "Formulários de Captação", icon: FormInput, description: "Formulários públicos de leads", tint: "bg-teal-500/10", iconColor: "text-teal-600" },
  { id: "sales", label: "Vendas e Comissões", icon: TrendingUp, description: "Pipeline, regras, comissões e produtos", tint: "bg-green-500/10", iconColor: "text-green-600" },
  { id: "team", label: "Equipa e Acessos", icon: UsersRound, description: "Colaboradores, perfis e equipas", tint: "bg-orange-500/10", iconColor: "text-orange-600", requiresTeam: true },
  { id: "integrations", label: "Integrações", icon: Plug, description: "WhatsApp, email, webhooks e faturação", tint: "bg-pink-500/10", iconColor: "text-pink-600", requiresIntegrations: true },
  { id: "finance", label: "Financeiro", icon: Receipt, description: "IVA, séries e tipos de despesas", tint: "bg-amber-500/10", iconColor: "text-amber-600", requiresIntegrations: true },
  { id: "alerts", label: "Notificações e Alertas", icon: Bell, description: "Push, calendário, email e fidelização", tint: "bg-red-500/10", iconColor: "text-red-600" },
];

export function MobileSettingsNav({
  activeSection,
  onSelectSection,
  canManageTeam,
  canManageIntegrations,
  isTelecom = false,
}: MobileSettingsNavProps) {
  const visibleSections = sections.filter(item => {
    if (item.requiresTeam && !canManageTeam) return false;
    if (item.requiresIntegrations && !canManageIntegrations) return false;
    return true;
  });

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {visibleSections.map((section) => (
        <SettingsCard
          key={section.id}
          icon={section.icon}
          title={section.label}
          description={section.description}
          onClick={() => onSelectSection(section.id)}
          tint={section.tint}
          iconColor={section.iconColor}
        />
      ))}
    </div>
  );
}

// Sub-section definitions per group. Optional requires* flags gate individual
// tabs (e.g. Produtos needs the integrations permission even though its group
// does not). alerts-fidelization is telecom-only (filtered in getVisibleSubSections).
export interface SubSectionItem {
  id: SettingsSubSection;
  label: string;
  icon: any;
  description: string;
  requiresTeam?: boolean;
  requiresIntegrations?: boolean;
  requiresTelecom?: boolean;
}

export const subSectionsMap: Record<SettingsSection, SubSectionItem[]> = {
  account: [
    { id: "account-profile", label: "Perfil", icon: User, description: "Os seus dados pessoais" },
    { id: "account-security", label: "Segurança", icon: Shield, description: "Palavra-passe e 2FA" },
    { id: "account-company", label: "Dados da Empresa", icon: Building, description: "Nome e código de convite" },
    { id: "account-plan", label: "Plano e Subscrição", icon: CreditCard, description: "Subscrição e pagamentos" },
    { id: "account-referrals", label: "Indicações", icon: Gift, description: "Empresas indicadas e meses gratuitos" },
    { id: "account-support", label: "Suporte", icon: LifeBuoy, description: "Tickets e pedidos de ajuda" },
  ],
  modules: [
    { id: "modules-list", label: "Módulos", icon: LayoutGrid, description: "Funcionalidades ativas no menu" },
    { id: "modules-fields", label: "Campos do CRM", icon: List, description: "Campos por módulo (Leads, Clientes, etc.)" },
    { id: "modules-documents", label: "Documentos de Cliente", icon: FileText, description: "Checklist na ficha do cliente (CTR, ...)", requiresTelecom: true },
  ],
  capture: [
    { id: "capture-forms", label: "Formulários", icon: FileText, description: "Formulários públicos de leads" },
  ],
  sales: [
    { id: "sales-pipeline", label: "Pipeline", icon: GitBranch, description: "Etapas do funil de vendas" },
    { id: "sales-rules", label: "Regras de Vendas", icon: ShoppingCart, description: "Bloqueios e atribuição de leads" },
    { id: "sales-commissions", label: "Matriz de Comissões", icon: Calculator, description: "Cálculo automático de comissões" },
    { id: "sales-operators", label: "Operadoras", icon: Radio, description: "Operadoras de telecom e energia", requiresIntegrations: true, requiresTelecom: true },
    { id: "sales-products", label: "Produtos & Serviços", icon: Package, description: "Catálogo de produtos", requiresIntegrations: true },
  ],
  team: [
    { id: "team-access", label: "Colaboradores", icon: KeyRound, description: "Convites e permissões" },
    { id: "team-profiles", label: "Perfis", icon: UserCog, description: "Níveis de acesso" },
    { id: "team-teams", label: "Equipas", icon: Network, description: "Hierarquia e líderes" },
  ],
  integrations: [
    { id: "integrations-connect", label: "Integrações", icon: Link2, description: "WhatsApp, email, webhooks e faturação" },
  ],
  finance: [
    { id: "finance-fiscal", label: "Fiscal", icon: Calculator, description: "IVA, isenções e séries" },
    { id: "finance-expenses", label: "Tipos de Despesas", icon: Receipt, description: "Categorias de despesas" },
  ],
  alerts: [
    { id: "alerts-push", label: "Notificações Push", icon: BellRing, description: "Alertas neste dispositivo" },
    { id: "alerts-calendar", label: "Calendário", icon: Calendar, description: "Lembretes de eventos e reuniões" },
    { id: "alerts-email", label: "Email", icon: Mail, description: "Alertas por email do sistema" },
    { id: "alerts-fidelization", label: "Fidelização", icon: AlertTriangle, description: "Alertas de contratos CPE/CUI" },
  ],
};

interface SubVisibilityOpts {
  isTelecom?: boolean;
  canManageTeam?: boolean;
  canManageIntegrations?: boolean;
}

// Visible sub-sections of a group for the current user: applies the telecom-only
// filter (Fidelização) and the per-tab permission gates.
export function getVisibleSubSections(
  group: SettingsSection,
  opts: SubVisibilityOpts,
): SubSectionItem[] {
  return (subSectionsMap[group] ?? []).filter(item => {
    if (item.id === 'alerts-fidelization' && !opts.isTelecom) return false;
    if (item.requiresTelecom && !opts.isTelecom) return false;
    if (item.requiresIntegrations && !opts.canManageIntegrations) return false;
    if (item.requiresTeam && !opts.canManageTeam) return false;
    return true;
  });
}

// Section titles (same as the card labels).
export const sectionTitles: Record<SettingsSection, string> = {
  account: "A Minha Conta",
  modules: "Módulos e Campos",
  capture: "Formulários de Captação",
  sales: "Vendas e Comissões",
  team: "Equipa e Acessos",
  integrations: "Integrações",
  finance: "Financeiro",
  alerts: "Notificações e Alertas",
};
