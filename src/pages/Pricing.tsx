import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { SEO } from "@/components/SEO";
import { PricingPlans, PricingCtaButton } from "@/components/billing/PricingPlans";
import { type BillingPeriod } from "@/lib/stripe-plans";
import { useLanguage } from "@/i18n";

export default function Pricing() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [period, setPeriod] = useState<BillingPeriod>("monthly");

  return (
    <div className="min-h-screen bg-neutral-100 py-8 sm:py-12">
      <SEO
        title={t("Planos e Preços | Senvia OS")}
        description={t("Planos que melhor se adequam ao seu negócio. CRM, vendas, marketing e caixas de entrada multicanal num só lugar.")}
      />

      <PricingPlans
        period={period}
        onPeriodChange={setPeriod}
        className="mx-auto max-w-7xl"
        renderCta={(_plan, { popular }) => (
          <PricingCtaButton popular={popular} onClick={() => navigate("/")}>
            <span className="inline-flex items-center justify-center gap-2">
              {t("Começar agora")} <ArrowRight className="h-4 w-4" />
            </span>
          </PricingCtaButton>
        )}
      />

      <p className="mt-2 text-center text-xs text-gray-500">
        {t("Todos os planos incluem 14 dias grátis, sem cartão. Já tem conta?")}{" "}
        <button onClick={() => navigate("/")} className="font-medium text-blue-600 underline-offset-2 hover:underline">
          {t("Entrar")}
        </button>
      </p>
    </div>
  );
}
