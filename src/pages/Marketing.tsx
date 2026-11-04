import { Mail, Send, BarChart3, ArrowRight, Users, Megaphone } from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/layout/PageHeader";
import { useLanguage } from "@/i18n";

const modules = [
  {
    title: "Templates de Email",
    description: "Crie e gira templates de email reutilizáveis com variáveis dinâmicas",
    icon: Mail,
    href: "/marketing/templates",
    available: true,
    tint: "bg-blue-500/10",
    iconColor: "text-blue-600",
    border: "hover:border-blue-400/50",
    strip: "bg-blue-500/10",
  },
  {
    title: "Campanhas",
    description: "Envie emails em massa para clientes e leads segmentados",
    icon: Send,
    href: "/marketing/campaigns",
    available: true,
    tint: "bg-violet-500/10",
    iconColor: "text-violet-600",
    border: "hover:border-violet-400/50",
    strip: "bg-violet-500/10",
  },
  {
    title: "Listas",
    description: "Gira listas de contactos e importe ficheiros XLSX/CSV",
    icon: Users,
    href: "/marketing/lists",
    available: true,
    tint: "bg-teal-500/10",
    iconColor: "text-teal-600",
    border: "hover:border-teal-400/50",
    strip: "bg-teal-500/10",
  },
  {
    title: "Relatórios",
    description: "Acompanhe métricas de abertura, cliques e conversões",
    icon: BarChart3,
    href: "/marketing/reports",
    available: true,
    tint: "bg-orange-500/10",
    iconColor: "text-orange-600",
    border: "hover:border-orange-400/50",
    strip: "bg-orange-500/10",
  },
];

export default function Marketing() {
  const { t } = useLanguage();
  return (
    <div className="space-y-6 p-4 md:p-6 pb-nav-safe md:pb-6">
      <PageHeader icon={Megaphone} title={t("Marketing")} subtitle={t("Gestão de templates de email e campanhas de marketing")} />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {modules.map((module) => (
          module.available ? (
            <Link
              key={module.title}
              to={module.href}
              className={cn(
                "group rounded-2xl border bg-card overflow-hidden shadow-sm hover:shadow-md transition-all",
                module.border
              )}
            >
              <div className={cn("px-5 pt-5 pb-4 flex items-start gap-4", module.strip)}>
                <div className={cn("flex h-12 w-12 items-center justify-center rounded-2xl bg-white/80 dark:bg-black/30 shadow-sm shrink-0", module.tint)}>
                  <module.icon className={cn("h-6 w-6", module.iconColor)} />
                </div>
                <div className="flex-1 min-w-0 pt-0.5">
                  <h3 className="font-bold text-sm">{t(module.title)}</h3>
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{t(module.description)}</p>
                </div>
              </div>
              <div className="flex items-center justify-end gap-1 px-5 py-3 border-t text-xs font-medium text-muted-foreground group-hover:text-foreground transition-colors">
                {t("Abrir")} <ArrowRight className="h-3.5 w-3.5 group-hover:translate-x-0.5 transition-transform" />
              </div>
            </Link>
          ) : (
            <div
              key={module.title}
              className="rounded-2xl border bg-card overflow-hidden opacity-60 shadow-sm"
            >
              <div className="px-5 pt-5 pb-4 flex items-start gap-4 bg-muted/30">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted shadow-sm shrink-0">
                  <module.icon className="h-6 w-6 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0 pt-0.5">
                  <h3 className="font-bold text-sm">{t(module.title)}</h3>
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{t(module.description)}</p>
                </div>
              </div>
              <div className="flex items-center justify-end px-5 py-3 border-t">
                <span className="text-[11px] font-semibold text-muted-foreground bg-muted rounded-full px-2.5 py-0.5">{t("Em breve")}</span>
              </div>
            </div>
          )
        ))}
      </div>
    </div>
  );
}
