import { Link } from "react-router-dom";
import { Package, ShoppingCart, Users, Truck, Tag, BarChart3, AlertTriangle, ChevronRight, Store } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useEcommerceStats } from "@/hooks/ecommerce";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency } from "@/lib/format";
import { SEO } from "@/components/SEO";

import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/i18n";

export default function Ecommerce() {
  const { profile, organization } = useAuth();
  const { data: stats, isLoading } = useEcommerceStats();
  const { t } = useLanguage();

  const modules = [
    {
      title: "Produtos",
      description: "Gerir catálogo, variantes e imagens",
      icon: Package,
      href: "/ecommerce/products",
      color: "bg-blue-500/10 text-blue-500",
      stat: stats?.total_products,
    },
    {
      title: "Pedidos",
      description: "Acompanhar e processar encomendas",
      icon: ShoppingCart,
      href: "/ecommerce/orders",
      color: "bg-green-500/10 text-green-500",
      stat: stats?.total_orders,
    },
    {
      title: "Clientes",
      description: "Base de dados de clientes B2C",
      icon: Users,
      href: "/ecommerce/customers",
      color: "bg-purple-500/10 text-purple-500",
      stat: stats?.total_customers,
    },
    {
      title: "Inventário",
      description: "Gestão de stock e movimentos",
      icon: Truck,
      href: "/ecommerce/inventory",
      color: "bg-orange-500/10 text-orange-500",
      stat: stats?.low_stock_products,
      statLabel: "Stock baixo",
    },
    {
      title: "Descontos",
      description: "Códigos promocionais e cupões",
      icon: Tag,
      href: "/ecommerce/discounts",
      color: "bg-pink-500/10 text-pink-500",
      stat: null,
    },
    {
      title: "Relatórios",
      description: "Análise de vendas e métricas",
      icon: BarChart3,
      href: "/ecommerce/reports",
      color: "bg-cyan-500/10 text-cyan-500",
      stat: null,
    },
  ];

  return (
    <>
      <SEO
        title="E-commerce | Senvia OS"
        description={t("Gestão completa da sua loja online")}
      />
      
      <div className="space-y-6 p-4 md:p-6 pb-nav-safe md:pb-6">
        <PageHeader icon={Store} title="E-commerce" subtitle={t("Gestão completa da sua loja online")} />

        {/* Quick Stats */}
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>{t("Receita Total")}</CardDescription>
              {isLoading ? (
                <Skeleton className="h-8 w-24" />
              ) : (
                <CardTitle className="text-2xl">
                  {formatCurrency(stats?.total_revenue || 0)}
                </CardTitle>
              )}
            </CardHeader>
          </Card>
          
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>{t("Pedidos Hoje")}</CardDescription>
              {isLoading ? (
                <Skeleton className="h-8 w-12" />
              ) : (
                <CardTitle className="text-2xl">
                  {stats?.orders_today || 0}
                </CardTitle>
              )}
            </CardHeader>
          </Card>
          
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>{t("Pedidos Pendentes")}</CardDescription>
              {isLoading ? (
                <Skeleton className="h-8 w-12" />
              ) : (
                <CardTitle className="text-2xl">
                  {stats?.pending_orders || 0}
                </CardTitle>
              )}
            </CardHeader>
          </Card>
          
          <Card>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-1">
                <AlertTriangle className="h-3 w-3 text-amber-500" />
                {t("Stock Baixo")}
              </CardDescription>
              {isLoading ? (
                <Skeleton className="h-8 w-12" />
              ) : (
                <CardTitle className="text-2xl">
                  <span className={stats?.low_stock_products ? "text-amber-500" : ""}>
                    {stats?.low_stock_products || 0}
                  </span>
                </CardTitle>
              )}
            </CardHeader>
          </Card>
        </div>

        {/* Module Cards */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {modules.map((module) => (
            <Link to={module.href} key={module.title}>
              <Card className="relative overflow-hidden transition-all hover:shadow-md hover:border-primary/50 h-full">
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${module.color}`}>
                      <module.icon className="h-5 w-5" />
                    </div>
                    <div className="flex-1">
                      <CardTitle className="text-base">{t(module.title)}</CardTitle>
                      <CardDescription className="text-sm">
                        {t(module.description)}
                      </CardDescription>
                    </div>
                    <ChevronRight className="h-5 w-5 text-muted-foreground" />
                  </div>
                </CardHeader>
                
                <CardContent>
                  {module.stat !== null && (
                    <div className="flex items-center gap-2">
                      {isLoading ? (
                        <Skeleton className="h-8 w-12" />
                      ) : (
                        <>
                          <span className="text-2xl font-bold">{module.stat}</span>
                          {module.statLabel && (
                            <span className="text-sm text-muted-foreground">{t(module.statLabel)}</span>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>

        {/* Info Banner */}
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="flex items-center gap-4 py-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <Package className="h-6 w-6 text-primary" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold">{t("Módulo E-commerce Ativo")}</h3>
              <p className="text-sm text-muted-foreground">
                {t("Faça a gestão de produtos, pedidos e clientes numa plataforma integrada.")}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
