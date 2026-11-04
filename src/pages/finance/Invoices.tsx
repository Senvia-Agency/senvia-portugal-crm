import { Button } from "@/components/ui/button";
import { ArrowLeft, FileText } from "lucide-react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { usesFinanceTabs } from "@/lib/finance-tabs";
import { InvoicesContent } from "@/components/finance/InvoicesContent";
import { useLanguage } from "@/i18n";

export default function FinanceInvoices() {
  const navigate = useNavigate();
  const { organization } = useAuth();
  const { t } = useLanguage();
  // The documents now live in the finance page's Faturas tab.
  if (organization && usesFinanceTabs(organization.niche)) return <Navigate to="/financeiro?tab=faturas" replace />;

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6 pb-20 md:pb-6">
      <div className="flex items-center gap-4">
        <Button 
          variant="ghost" 
          size="icon" 
          onClick={() => navigate('/financeiro')}
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <FileText className="h-5 w-5 shrink-0 text-primary" />
            {t("Faturas")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("Referências de faturas emitidas")}
          </p>
        </div>
      </div>

      <InvoicesContent />
    </div>
  );
}
