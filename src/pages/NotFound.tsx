import { useLocation, Link } from "react-router-dom";
import { useEffect } from "react";
import { Home, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SEO } from "@/components/SEO";
import { useLanguage } from "@/i18n";

const NotFound = () => {
  const location = useLocation();
  const { t } = useLanguage();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <>
      <SEO 
        title={t("Página não encontrada")} 
        description={t("A página que procura não existe ou foi movida.")}
        noindex={true}
      />
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-4">
        <div className="text-center max-w-md">
          <div className="mb-8">
            <span className="text-8xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-primary to-blue-400">
              404
            </span>
          </div>
          
          <h1 className="mb-4 text-2xl font-bold text-white">
            {t("Página não encontrada")}
          </h1>
          
          <p className="mb-8 text-slate-400">
            {t("A página que procura não existe ou foi movida para outro endereço.")}
          </p>
          
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button variant="outline" className="border-slate-700" asChild>
              <Link to="/">
                <Home className="mr-2 h-4 w-4" />
                {t("Página Inicial")}
              </Link>
            </Button>
            
            <Button 
              variant="ghost" 
              className="text-slate-400 hover:text-white"
              onClick={() => window.history.back()}
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              {t("Voltar")}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
};

export default NotFound;
