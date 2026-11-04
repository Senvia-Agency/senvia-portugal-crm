import { Link } from "react-router-dom";
import { ArrowLeft, Boxes } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SEO } from "@/components/SEO";


import { InventoryTable } from "@/components/ecommerce/InventoryTable";
import { useLanguage } from "@/i18n";

export default function EcommerceInventory() {
  const { t } = useLanguage();

  return (
    <>
      <SEO title={`${t("Inventário")} | E-commerce | Senvia OS`} description={t("Gerir stock e movimentos")} />

      <div className="space-y-6 p-4 md:p-6 pb-nav-safe md:pb-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link to="/ecommerce">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
              <Boxes className="h-5 w-5 shrink-0 text-primary" />
              {t("Inventário")}
            </h1>
            <p className="text-sm text-muted-foreground">{t("Gerir stock e movimentos")}</p>
          </div>
        </div>

        <InventoryTable />
      </div>
    </>
  );
}
