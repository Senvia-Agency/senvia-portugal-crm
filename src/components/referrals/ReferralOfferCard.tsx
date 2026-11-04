import { Gift } from "lucide-react";
import { ReferralShare } from "@/components/referrals/ReferralShare";
import { useReferralDashboard } from "@/hooks/useReferralDashboard";
import { useLanguage } from "@/i18n";

/** "Indique uma empresa": the reward, the link to share, and where you stand, in one card. */
export function ReferralOfferCard() {
  const { t } = useLanguage();
  const { isAdmin, link, totals } = useReferralDashboard();
  const available = totals ? totals.available + totals.reserved : 0;

  return (
    <section className="flex h-full flex-col rounded-2xl border border-t-4 border-t-violet-500 bg-gradient-to-b from-violet-50/80 via-card to-card p-5 shadow-xl dark:from-violet-950/30">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300"><Gift className="h-5 w-5" /></span>
        <h2 className="text-base font-semibold">{t("Indique uma empresa")}</h2>
      </div>
      <p className="mt-4 text-3xl font-bold tracking-tight text-violet-700 dark:text-violet-300">{t("1 mês grátis")}</p>
      <p className="mt-1 text-sm text-muted-foreground">{t("por cada empresa que se registe com o seu link e faça o primeiro pagamento. Sem limite.")}</p>
      <div className="mt-5 flex-1">
        {isAdmin && link
          ? <ReferralShare link={link} compact />
          : <p className="text-sm text-muted-foreground">{t("O link e os meses grátis são geridos pelos administradores da empresa. Peça-lhes o link para partilhar.")}</p>}
      </div>
      {totals && (
        <p className="mt-4 border-t pt-3 text-xs text-muted-foreground">
          {t("{{available}} disponíveis · {{pending}} a aguardar pagamento · {{used}} já usados", { available, pending: totals.pending, used: totals.used })}
        </p>
      )}
    </section>
  );
}
