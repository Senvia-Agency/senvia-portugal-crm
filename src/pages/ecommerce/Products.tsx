import { Link } from "react-router-dom";
import { ArrowLeft, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SEO } from "@/components/SEO";


import { ProductsTable } from "@/components/ecommerce/ProductsTable";
import { CategoriesTable } from "@/components/ecommerce/CategoriesTable";
import { useLanguage } from "@/i18n";

export default function EcommerceProducts() {
  const { t } = useLanguage();

  return (
    <>
      <SEO title={`${t("Produtos")} | E-commerce | Senvia OS`} description={t("Gerir catálogo de produtos")} />

      <div className="space-y-6 p-4 md:p-6 pb-nav-safe md:pb-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link to="/ecommerce">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
              <Package className="h-5 w-5 shrink-0 text-primary" />
              {t("Produtos")}
            </h1>
            <p className="text-sm text-muted-foreground">{t("Gerir catálogo e categorias")}</p>
          </div>
        </div>

        <Tabs defaultValue="products" className="space-y-4">
          <TabsList className="grid w-full grid-cols-2 md:w-auto md:inline-grid">
            <TabsTrigger value="products">{t("Produtos")}</TabsTrigger>
            <TabsTrigger value="categories">{t("Categorias")}</TabsTrigger>
          </TabsList>
          <TabsContent value="products">
            <ProductsTable />
          </TabsContent>
          <TabsContent value="categories">
            <CategoriesTable />
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}
