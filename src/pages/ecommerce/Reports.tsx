import { Link } from "react-router-dom";
import { ArrowLeft, TrendingUp, Package, Users, DollarSign, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SEO } from "@/components/SEO";

import { useAuth } from "@/contexts/AuthContext";
import { useEcommerceStats } from "@/hooks/ecommerce/useEcommerceStats";
import { formatCurrency } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { useLanguage } from "@/i18n";

export default function EcommerceReports() {
  const { profile, organization } = useAuth();
  const { data: stats, isLoading } = useEcommerceStats();
  const { t } = useLanguage();

  return (
    <>
      <SEO title={`${t("Relatórios")} | E-commerce | Senvia OS`} description={t("Análise e métricas da loja")} />

      <div className="space-y-6 p-4 md:p-6 pb-nav-safe md:pb-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link to="/ecommerce">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
              <BarChart3 className="h-5 w-5 shrink-0 text-primary" />
              {t("Relatórios")}
            </h1>
            <p className="text-sm text-muted-foreground">{t("Análise e métricas da loja")}</p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{t("Receita Total")}</CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-8 w-24" />
              ) : (
                <div className="text-2xl font-bold">{formatCurrency(stats?.total_revenue || 0)}</div>
              )}
              <p className="text-xs text-muted-foreground">{t("Desde o início")}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{t("Total de Pedidos")}</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <div className="text-2xl font-bold">{stats?.total_orders || 0}</div>
              )}
              <p className="text-xs text-muted-foreground">{t("Todos os pedidos")}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{t("Produtos")}</CardTitle>
              <Package className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <div className="text-2xl font-bold">{stats?.total_products || 0}</div>
              )}
              <p className="text-xs text-muted-foreground">{t("No catálogo")}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{t("Clientes")}</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <div className="text-2xl font-bold">{stats?.total_customers || 0}</div>
              )}
              <p className="text-xs text-muted-foreground">{t("Registados")}</p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{t("Resumo de Atividade")}</CardTitle>
            <CardDescription>{t("Visão geral do desempenho da loja")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b pb-4">
                <div>
                  <p className="font-medium">{t("Pedidos Hoje")}</p>
                  <p className="text-sm text-muted-foreground">{t("Novos pedidos recebidos")}</p>
                </div>
                {isLoading ? (
                  <Skeleton className="h-8 w-12" />
                ) : (
                  <span className="text-2xl font-bold">{stats?.orders_today || 0}</span>
                )}
              </div>

              <div className="flex items-center justify-between border-b pb-4">
                <div>
                  <p className="font-medium">{t("Pedidos Pendentes")}</p>
                  <p className="text-sm text-muted-foreground">{t("A aguardar processamento")}</p>
                </div>
                {isLoading ? (
                  <Skeleton className="h-8 w-12" />
                ) : (
                  <span className="text-2xl font-bold text-amber-500">{stats?.pending_orders || 0}</span>
                )}
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">{t("Produtos com Stock Baixo")}</p>
                  <p className="text-sm text-muted-foreground">{t("Necessitam reposição")}</p>
                </div>
                {isLoading ? (
                  <Skeleton className="h-8 w-12" />
                ) : (
                  <span className={`text-2xl font-bold ${stats?.low_stock_products ? "text-red-500" : ""}`}>
                    {stats?.low_stock_products || 0}
                  </span>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
