import { Link } from "react-router-dom";
import { ArrowLeft, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SEO } from "@/components/SEO";


import { OrdersTable } from "@/components/ecommerce/OrdersTable";
import { useLanguage } from "@/i18n";

export default function EcommerceOrders() {
  const { t } = useLanguage();

  return (
    <>
      <SEO title={`${t("Pedidos")} | E-commerce | Senvia OS`} description={t("Gerir pedidos da loja")} />

      <div className="space-y-6 p-4 md:p-6 pb-nav-safe md:pb-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link to="/ecommerce">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
              <ShoppingCart className="h-5 w-5 shrink-0 text-primary" />
              {t("Pedidos")}
            </h1>
            <p className="text-sm text-muted-foreground">{t("Gerir encomendas e estados")}</p>
          </div>
        </div>

        <OrdersTable />
      </div>
    </>
  );
}
