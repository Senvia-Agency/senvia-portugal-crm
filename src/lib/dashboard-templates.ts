import { 
  Users, 
  TrendingUp, 
  Target, 
  FileText, 
  CheckCircle, 
  Calendar,
  Heart,
  Hammer,
  ShoppingCart,
  Home,
  Phone,
  Euro,
  Clock,
  Package,
  BarChart3,
  Zap,
  type LucideIcon
} from "lucide-react";

export type WidgetType = 
  // Generic - all niches
  | 'leads_total'
  | 'leads_trend'
  | 'leads_by_source'
  | 'leads_social'
  | 'leads_direct'
  | 'conversion_rate'
  | 'sales_delivered'
  | 'sales_active'
  | 'proposals_open'
  | 'proposals_accepted'
  // Clinic specific
  | 'appointments_today'
  | 'patients_in_treatment'
  | 'treatments_completed'
  // Construction specific
  | 'active_projects'
  | 'pending_quotes'
  | 'completed_projects'
  // E-commerce specific
  | 'orders_today'
  | 'revenue_today'
  | 'low_stock_products'
  // Real estate specific
  | 'visits_this_week'
  | 'active_listings'
  | 'deals_closing'
  // Telecom specific
  | 'pending_installations'
  | 'active_customers'
  | 'monthly_commissions'
  // Panel widgets
  | 'team_performance_table'
  | 'commitment_panel'
  | 'telecom_lifecycle_panel'
  | 'sales_performance_panel'
  | 'metrics_panel'
  | 'activations_panel'
  | 'fidelization_alerts_widget'
  | 'calendar_alerts_widget'
  | 'tasks_widget'
  | 'commissions_widget';

export type ChartType = 'area' | 'bar' | 'donut' | 'pie' | 'progress' | 'none';

export interface WidgetTemplate {
  type: WidgetType;
  title: string;
  titleByNiche?: Partial<Record<NicheType, string>>;
  icon: LucideIcon;
  defaultVisible: boolean;
  requiredModule?: 'proposals' | 'calendar' | 'sales' | 'ecommerce' | 'clients' | 'inbox' | 'finance' | 'energy';
  chartType: ChartType;
  description?: string;
}

export type NicheType = 
  | 'generic'
  | 'clinic'
  | 'dental'
  | 'aesthetic'
  | 'construction'
  | 'real_estate'
  | 'telecom'
  | 'ecommerce'
  | 'energy'
  | 'education'
  | 'automotive';

// All available widgets with their configurations
export const WIDGET_DEFINITIONS: Record<WidgetType, WidgetTemplate> = {
  // Generic widgets
  leads_total: {
    type: 'leads_total',
    title: 'Total de Leads',
    titleByNiche: {
      clinic: 'Novos Pacientes',
      dental: 'Novos Pacientes',
      aesthetic: 'Novos Pacientes',
      real_estate: 'Interessados',
      education: 'Novos Alunos',
    },
    icon: Users,
    defaultVisible: true,
    chartType: 'area',
    description: 'Total de leads captados',
  },
  leads_trend: {
    type: 'leads_trend',
    title: 'Tendência de Leads',
    icon: TrendingUp,
    defaultVisible: true,
    chartType: 'area',
    description: 'Evolução de leads ao longo do tempo',
  },
  leads_by_source: {
    type: 'leads_by_source',
    title: 'Leads por Canal',
    icon: BarChart3,
    defaultVisible: false,
    chartType: 'donut',
    description: 'Distribuição por origem',
  },
  leads_social: {
    type: 'leads_social',
    title: 'Leads Redes Sociais',
    icon: TrendingUp,
    defaultVisible: true,
    chartType: 'donut',
    description: 'Leads vindos de Instagram, Facebook, LinkedIn, TikTok',
  },
  leads_direct: {
    type: 'leads_direct',
    title: 'Leads do Site',
    icon: Phone,
    defaultVisible: true,
    chartType: 'donut',
    description: 'Leads vindos do website e outras fontes diretas',
  },
  conversion_rate: {
    type: 'conversion_rate',
    title: 'Taxa de Conversão',
    icon: Target,
    defaultVisible: true,
    chartType: 'progress',
    description: 'Percentagem de leads convertidos',
  },
  sales_delivered: {
    type: 'sales_delivered',
    title: 'Vendas Concluídas',
    titleByNiche: {
      clinic: 'Tratamentos Concluídos',
      dental: 'Tratamentos Concluídos',
      aesthetic: 'Procedimentos Concluídos',
      construction: 'Obras Entregues',
      real_estate: 'Imóveis Vendidos',
    },
    icon: CheckCircle,
    defaultVisible: true,
    requiredModule: 'sales',
    chartType: 'bar',
    description: 'Vendas com status entregue',
  },
  sales_active: {
    type: 'sales_active',
    title: 'Vendas Ativas',
    titleByNiche: {
      clinic: 'Tratamentos em Curso',
      dental: 'Tratamentos em Curso',
      aesthetic: 'Procedimentos em Curso',
      construction: 'Obras em Curso',
      real_estate: 'Negócios em Andamento',
    },
    icon: Zap,
    defaultVisible: true,
    requiredModule: 'sales',
    chartType: 'bar',
    description: 'Vendas pendentes ou em progresso',
  },
  proposals_open: {
    type: 'proposals_open',
    title: 'Propostas Abertas',
    titleByNiche: {
      construction: 'Orçamentos Pendentes',
      real_estate: 'Propostas Pendentes',
    },
    icon: FileText,
    defaultVisible: true,
    requiredModule: 'proposals',
    chartType: 'none',
    description: 'Propostas à espera de resposta',
  },
  proposals_accepted: {
    type: 'proposals_accepted',
    title: 'Propostas Aceites',
    titleByNiche: {
      construction: 'Orçamentos Aceites',
    },
    icon: CheckCircle,
    defaultVisible: true,
    requiredModule: 'proposals',
    chartType: 'none',
    description: 'Propostas convertidas em venda',
  },
  // Clinic specific
  appointments_today: {
    type: 'appointments_today',
    title: 'Consultas Hoje',
    icon: Calendar,
    defaultVisible: true,
    requiredModule: 'calendar',
    chartType: 'progress',
    description: 'Agendamentos para hoje',
  },
  patients_in_treatment: {
    type: 'patients_in_treatment',
    title: 'Pacientes em Tratamento',
    icon: Heart,
    defaultVisible: true,
    chartType: 'bar',
    description: 'Clientes com vendas ativas',
  },
  treatments_completed: {
    type: 'treatments_completed',
    title: 'Tratamentos Concluídos',
    icon: CheckCircle,
    defaultVisible: false,
    requiredModule: 'sales',
    chartType: 'area',
    description: 'Total de tratamentos finalizados',
  },
  // Construction specific
  active_projects: {
    type: 'active_projects',
    title: 'Obras Ativas',
    icon: Hammer,
    defaultVisible: true,
    requiredModule: 'sales',
    chartType: 'bar',
    description: 'Projetos em execução',
  },
  pending_quotes: {
    type: 'pending_quotes',
    title: 'Orçamentos Pendentes',
    icon: FileText,
    defaultVisible: true,
    requiredModule: 'proposals',
    chartType: 'donut',
    description: 'Orçamentos à espera de aprovação',
  },
  completed_projects: {
    type: 'completed_projects',
    title: 'Obras Concluídas',
    icon: CheckCircle,
    defaultVisible: false,
    requiredModule: 'sales',
    chartType: 'area',
    description: 'Total de obras entregues',
  },
  // E-commerce specific
  orders_today: {
    type: 'orders_today',
    title: 'Encomendas Hoje',
    icon: ShoppingCart,
    defaultVisible: true,
    requiredModule: 'ecommerce',
    chartType: 'none',
    description: 'Pedidos recebidos hoje',
  },
  revenue_today: {
    type: 'revenue_today',
    title: 'Faturação Hoje',
    icon: Euro,
    defaultVisible: true,
    requiredModule: 'ecommerce',
    chartType: 'area',
    description: 'Receita do dia',
  },
  low_stock_products: {
    type: 'low_stock_products',
    title: 'Produtos em Falta',
    icon: Package,
    defaultVisible: true,
    requiredModule: 'ecommerce',
    chartType: 'none',
    description: 'Produtos com stock baixo',
  },
  // Real estate specific
  visits_this_week: {
    type: 'visits_this_week',
    title: 'Visitas Esta Semana',
    icon: Calendar,
    defaultVisible: true,
    requiredModule: 'calendar',
    chartType: 'bar',
    description: 'Agendamentos de visita',
  },
  active_listings: {
    type: 'active_listings',
    title: 'Imóveis Disponíveis',
    icon: Home,
    defaultVisible: true,
    chartType: 'none',
    description: 'Propriedades à venda',
  },
  deals_closing: {
    type: 'deals_closing',
    title: 'Negócios a Fechar',
    icon: Target,
    defaultVisible: true,
    requiredModule: 'proposals',
    chartType: 'none',
    description: 'Propostas em fase final',
  },
  // Telecom specific
  pending_installations: {
    type: 'pending_installations',
    title: 'Instalações Pendentes',
    icon: Clock,
    defaultVisible: true,
    requiredModule: 'sales',
    chartType: 'bar',
    description: 'Serviços à espera de instalação',
  },
  active_customers: {
    type: 'active_customers',
    title: 'Clientes Ativos',
    icon: Users,
    defaultVisible: true,
    chartType: 'area',
    description: 'Base de clientes ativa',
  },
  monthly_commissions: {
    type: 'monthly_commissions',
    title: 'Comissões',
    icon: Euro,
    defaultVisible: true,
    requiredModule: 'sales',
    chartType: 'bar',
    description: 'Total de comissões acumuladas',
  },
  // Panel widgets
  team_performance_table: {
    type: 'team_performance_table',
    title: 'Performance da Equipa',
    icon: Users,
    defaultVisible: false,
    chartType: 'none',
    description: 'Tabela com leads, propostas, vendas e comissões por colaborador',
  },
  commitment_panel: {
    type: 'commitment_panel',
    title: 'Compromisso Mensal',
    icon: Target,
    defaultVisible: false,
    chartType: 'none',
    description: 'Metas mensais definidas por cada colaborador (NIFs, instalações, comissão)',
  },
  telecom_lifecycle_panel: {
    type: 'telecom_lifecycle_panel',
    title: 'Análise do Mês',
    icon: BarChart3,
    defaultVisible: false,
    chartType: 'none',
    description: 'Estado das vendas telecom do mês: ativos, por instalar, anulados, cancelados',
  },
  sales_performance_panel: {
    type: 'sales_performance_panel',
    title: 'Performance de Vendas',
    icon: TrendingUp,
    defaultVisible: false,
    chartType: 'none',
    description: 'Evolução de vendas ao longo do período',
  },
  metrics_panel: {
    type: 'metrics_panel',
    title: 'Métricas',
    icon: BarChart3,
    defaultVisible: false,
    chartType: 'none',
    description: 'Indicadores-chave configuráveis do negócio',
  },
  activations_panel: {
    type: 'activations_panel',
    title: 'Ativações',
    icon: Zap,
    defaultVisible: false,
    chartType: 'none',
    description: 'Instalações ativadas recentemente',
  },
  fidelization_alerts_widget: {
    type: 'fidelization_alerts_widget',
    title: 'Alertas de Fidelização',
    icon: Heart,
    defaultVisible: false,
    requiredModule: 'clients',
    chartType: 'none',
    description: 'Clientes a aproximar-se do fim de fidelização',
  },
  calendar_alerts_widget: {
    type: 'calendar_alerts_widget',
    title: 'Alertas de Calendário',
    icon: Calendar,
    defaultVisible: false,
    requiredModule: 'calendar',
    chartType: 'none',
    description: 'Eventos e compromissos próximos',
  },
  tasks_widget: {
    type: 'tasks_widget',
    title: 'Tarefas',
    icon: CheckCircle,
    defaultVisible: false,
    requiredModule: 'inbox',
    chartType: 'none',
    description: 'Tarefas pendentes atribuídas',
  },
  commissions_widget: {
    type: 'commissions_widget',
    title: 'Resumo de Comissões',
    icon: Euro,
    defaultVisible: false,
    chartType: 'none',
    description: 'Resumo de comissões da equipa',
  },
};

// Default widgets by niche
export const NICHE_DEFAULT_WIDGETS: Record<NicheType, WidgetType[]> = {
  generic: [
    'leads_total',
    'leads_social',
    'leads_direct',
    'leads_trend',
    'conversion_rate',
    'sales_delivered',
    'sales_active',
    'proposals_open',
    'proposals_accepted',
  ],
  clinic: [
    'appointments_today',
    'patients_in_treatment',
    'leads_total',
    'conversion_rate',
    'sales_delivered',
    'proposals_open',
  ],
  dental: [
    'appointments_today',
    'patients_in_treatment',
    'leads_total',
    'conversion_rate',
    'sales_delivered',
    'proposals_open',
  ],
  aesthetic: [
    'appointments_today',
    'patients_in_treatment',
    'leads_total',
    'conversion_rate',
    'sales_delivered',
    'proposals_open',
  ],
  construction: [
    'active_projects',
    'pending_quotes',
    'leads_total',
    'conversion_rate',
    'completed_projects',
    'proposals_accepted',
  ],
  real_estate: [
    'visits_this_week',
    'active_listings',
    'leads_total',
    'deals_closing',
    'conversion_rate',
    'proposals_accepted',
  ],
  telecom: [
    'pending_installations',
    'active_customers',
    'leads_total',
    'conversion_rate',
    'monthly_commissions',
    'sales_active',
    'commitment_panel',
    'telecom_lifecycle_panel',
    'sales_performance_panel',
    'metrics_panel',
    'activations_panel',
    'fidelization_alerts_widget',
    'calendar_alerts_widget',
    'tasks_widget',
    'commissions_widget',
  ],
  ecommerce: [
    'orders_today',
    'revenue_today',
    'low_stock_products',
    'leads_total',
    'conversion_rate',
    'sales_delivered',
  ],
  energy: [
    'leads_total',
    'pending_quotes',
    'conversion_rate',
    'active_projects',
    'proposals_open',
    'sales_delivered',
  ],
  education: [
    'leads_total',
    'conversion_rate',
    'proposals_open',
    'sales_active',
    'appointments_today',
    'proposals_accepted',
  ],
  automotive: [
    'leads_total',
    'conversion_rate',
    'proposals_open',
    'sales_delivered',
    'sales_active',
    'proposals_accepted',
  ],
};

// Get widget title based on niche
export function getWidgetTitle(widgetType: WidgetType, niche: NicheType = 'generic'): string {
  const widget = WIDGET_DEFINITIONS[widgetType];
  if (!widget) return widgetType;
  
  return widget.titleByNiche?.[niche] || widget.title;
}

// Get default widgets for a niche
export function getDefaultWidgetsForNiche(niche: NicheType | null | undefined): WidgetType[] {
  return NICHE_DEFAULT_WIDGETS[niche || 'generic'] || NICHE_DEFAULT_WIDGETS.generic;
}

// Get all available widgets for selection
export function getAllAvailableWidgets(): WidgetTemplate[] {
  return Object.values(WIDGET_DEFINITIONS);
}

/**
 * Which niches each widget belongs to. Anything NOT listed here is generic
 * and offered to every niche — kept as an exception list so adding a plain
 * widget needs no entry, and so the mapping is readable in one place instead
 * of scattered across every definition.
 *
 * The telecom panels are listed because Dashboard.tsx only ever renders them
 * inside `{isTelecom && ...}`: offering them to a clinic would let someone
 * tick a box that changes nothing on screen.
 */
const WIDGET_NICHES: Partial<Record<WidgetType, NicheType[]>> = {
  // Clinic family
  appointments_today: ['clinic', 'dental', 'aesthetic', 'education'],
  patients_in_treatment: ['clinic', 'dental', 'aesthetic'],
  treatments_completed: ['clinic', 'dental', 'aesthetic'],
  // Construction / energy projects
  active_projects: ['construction', 'energy'],
  pending_quotes: ['construction', 'energy'],
  completed_projects: ['construction'],
  // E-commerce
  orders_today: ['ecommerce'],
  revenue_today: ['ecommerce'],
  low_stock_products: ['ecommerce'],
  // Real estate
  visits_this_week: ['real_estate'],
  active_listings: ['real_estate'],
  deals_closing: ['real_estate'],
  // Telecom
  pending_installations: ['telecom'],
  active_customers: ['telecom'],
  monthly_commissions: ['telecom'],
  commitment_panel: ['telecom'],
  telecom_lifecycle_panel: ['telecom'],
  sales_performance_panel: ['telecom'],
  metrics_panel: ['telecom'],
  activations_panel: ['telecom'],
  fidelization_alerts_widget: ['telecom'],
};

/** True when this widget is offered in the given niche. */
export function isWidgetForNiche(type: WidgetType, niche: NicheType | null | undefined): boolean {
  const allowed = WIDGET_NICHES[type];
  return !allowed || allowed.includes(niche || 'generic');
}

// Filter widgets by enabled modules
export function filterWidgetsByModules(
  widgets: WidgetType[],
  enabledModules: Record<string, boolean | undefined>
): WidgetType[] {
  return widgets.filter(widgetType => {
    const widget = WIDGET_DEFINITIONS[widgetType];
    if (!widget) return false;
    
    // If widget requires a module, check if it's enabled
    if (widget.requiredModule) {
      return enabledModules[widget.requiredModule] !== false;
    }
    
    return true;
  });
}
