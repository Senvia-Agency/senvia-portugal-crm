import { useLocation } from "react-router-dom";
import {
  Target, BarChart3, FileText, Users, CalendarDays, Settings,
  UserPlus, Import, ArrowRightLeft, Columns3, Bell, Clock,
  Receipt, CreditCard, RefreshCw, Wallet, Building2,
  Megaphone, MailPlus, Upload, ShoppingBag, Package, Ticket,
  LayoutDashboard, Eye, Plug, UsersRound, Kanban, BadgeDollarSign,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useLanguage } from "@/i18n";

interface QuickAction {
  label: string;
  icon: LucideIcon;
}

const PAGE_ACTIONS: Record<string, QuickAction[]> = {
  "/dashboard": [
    { label: "Resumo do negócio", icon: BarChart3 },
    { label: "Personalizar dashboard", icon: LayoutDashboard },
    { label: "Ver leads recentes", icon: Eye },
  ],
  "/leads": [
    { label: "Como criar um lead?", icon: UserPlus },
    { label: "Configurar pipeline", icon: Kanban },
    { label: "Importar leads", icon: Upload },
    { label: "Mover lead de etapa", icon: ArrowRightLeft },
  ],
  "/clients": [
    { label: "Criar cliente", icon: UserPlus },
    { label: "Campos personalizados", icon: Columns3 },
    { label: "Converter lead em cliente", icon: ArrowRightLeft },
  ],
  "/calendar": [
    { label: "Agendar reunião", icon: CalendarDays },
    { label: "Criar lembrete", icon: Bell },
    { label: "Tipos de evento", icon: Clock },
  ],
  "/proposals": [
    { label: "Criar proposta", icon: FileText },
    { label: "Enviar por email", icon: MailPlus },
    { label: "Converter em venda", icon: ArrowRightLeft },
  ],
  "/sales": [
    { label: "Criar venda", icon: Receipt },
    { label: "Emitir fatura", icon: FileText },
    { label: "Registar pagamento", icon: CreditCard },
    { label: "Vendas recorrentes", icon: RefreshCw },
  ],
  "/financeiro": [
    { label: "Registar despesa", icon: Wallet },
    { label: "Configurar contas", icon: Building2 },
    { label: "Sincronizar faturas", icon: RefreshCw },
  ],
  "/marketing": [
    { label: "Criar campanha", icon: Megaphone },
    { label: "Gerir templates", icon: MailPlus },
    { label: "Importar contactos", icon: Upload },
  ],
  "/ecommerce": [
    { label: "Adicionar produto", icon: ShoppingBag },
    { label: "Gerir encomendas", icon: Package },
    { label: "Códigos de desconto", icon: Ticket },
  ],
  "/settings": [
    { label: "Integrações", icon: Plug },
    { label: "Gerir equipa", icon: UsersRound },
    { label: "Pipeline", icon: Kanban },
    { label: "Plano e faturação", icon: BadgeDollarSign },
  ],
};

const DEFAULT_ACTIONS: QuickAction[] = [
  { label: "Como criar um lead?", icon: Target },
  { label: "Gerir pipeline", icon: BarChart3 },
  { label: "Enviar proposta", icon: FileText },
  { label: "Configurações", icon: Settings },
];

function getActionsForPath(pathname: string): QuickAction[] {
  if (PAGE_ACTIONS[pathname]) return PAGE_ACTIONS[pathname];
  const prefix = Object.keys(PAGE_ACTIONS).find((k) => pathname.startsWith(k));
  return prefix ? PAGE_ACTIONS[prefix] : DEFAULT_ACTIONS;
}

interface OttoQuickActionsProps {
  onSelect: (text: string) => void;
}

export function OttoQuickActions({ onSelect }: OttoQuickActionsProps) {
  const { t } = useLanguage();
  const { pathname } = useLocation();
  const actions = getActionsForPath(pathname);

  return (
    <div className="space-y-2">
      <p className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("Sugestões para esta página")}</p>
      <div className="grid grid-cols-2 gap-2">
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            className="group flex min-h-[4.5rem] flex-col items-start gap-2 rounded-xl border border-border bg-card p-3 text-left text-sm transition-colors hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => onSelect(t(action.label))}
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
              <action.icon className="h-3.5 w-3.5" />
            </span>
            <span className="font-medium leading-snug">{t(action.label)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
