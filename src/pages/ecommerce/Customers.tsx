import { Link } from "react-router-dom";
import { ArrowLeft, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SEO } from "@/components/SEO";


import { CustomersTable } from "@/components/ecommerce/CustomersTable";
import { useLanguage } from "@/i18n";

export default function EcommerceCustomers() {
  const { t } = useLanguage();

  return (
    <>
      <SEO title={`${t("Clientes")} | E-commerce | Senvia OS`} description={t("Gerir base de clientes")} />

      <div className="space-y-6 p-4 md:p-6 pb-nav-safe md:pb-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link to="/ecommerce">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
              <Users className="h-5 w-5 shrink-0 text-primary" />
              {t("Clientes")}
            </h1>
            <p className="text-sm text-muted-foreground">{t("Gerir base de clientes")}</p>
          </div>
        </div>

        <CustomersTable />
      </div>
    </>
  );
}
