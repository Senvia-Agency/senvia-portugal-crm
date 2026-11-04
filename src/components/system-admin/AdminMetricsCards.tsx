import { DollarSign, Users, Clock, AlertTriangle, CreditCard } from "lucide-react";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { useLanguage } from "@/i18n";

interface Organization {
  id: string;
  plan: string | null;
  trial_ends_at: string | null;
  billing_exempt: boolean | null;
}

interface StripeStats {
  mrr: number;
  paying_count: number;
  total_subscriptions: number;
}

interface AdminMetricsCardsProps {
  organizations: Organization[];
  stripeStats?: StripeStats | null;
  stripeLoading?: boolean;
}

export function AdminMetricsCards({ organizations, stripeStats, stripeLoading }: AdminMetricsCardsProps) {
  const now = new Date();
  const { t } = useLanguage();

  const isInTrial = (o: Organization) =>
    !o.billing_exempt && o.trial_ends_at && new Date(o.trial_ends_at) > now;

  const inTrial = organizations.filter((o) => isInTrial(o)).length;

  const expired = organizations.filter(
    (o) =>
      !o.billing_exempt &&
      !isInTrial(o) &&
      (!o.plan || o.plan === "basic")
  ).length;

  // Use Stripe real data when available, fallback to local calculation
  const mrr = stripeStats?.mrr ?? 0;
  const paying = stripeStats?.paying_count ?? 0;

  return (
    <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
      <MetricCard
        title="MRR"
        value={stripeLoading ? "..." : `€${mrr}`}
        subtitle={stripeStats ? t("Dados reais Stripe") : t("A carregar...")}
        icon={<DollarSign className="h-5 w-5 text-primary" />}
      />
      <MetricCard
        title={t("Clientes Pagantes")}
        value={stripeLoading ? "..." : paying}
        subtitle={stripeStats ? t("Subscrição ativa Stripe") : t("A carregar...")}
        icon={<CreditCard className="h-5 w-5 text-primary" />}
      />
      <MetricCard
        title={t("Em Trial")}
        value={inTrial}
        subtitle={t("Trial ativo")}
        icon={<Clock className="h-5 w-5 text-primary" />}
      />
      <MetricCard
        title={t("Trials Expirados")}
        value={expired}
        subtitle={t("Sem plano pago")}
        icon={<AlertTriangle className="h-5 w-5 text-primary" />}
      />
    </div>
  );
}
