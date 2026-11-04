import { Link } from "react-router-dom";
import { ArrowRight, Clapperboard, Gift, X } from "lucide-react";
import { REVIEW_DISCOUNT_PERCENT } from "@/hooks/useVideoReview";
import { Button } from "@/components/ui/button";
import { usePersistedState } from "@/hooks/usePersistedState";
import { useReferralDashboard } from "@/hooks/useReferralDashboard";
import { ReferralShare } from "./ReferralShare";
import { useLanguage } from "@/i18n";

const SNOOZE_MS = 14 * 24 * 3600 * 1000;

/**
 * The Painel's reminder that inviting a company is worth a free month.
 * Closing it hides it for 14 days, then it comes back: the point is that it is not forgotten.
 */
export function ReferralBanner() {
  const { t } = useLanguage();
  const { isAdmin, link, totals } = useReferralDashboard();
  const [hiddenAt, setHiddenAt] = usePersistedState<number>("referral-banner-hidden-v1", 0);
  if (!isAdmin || !link || !totals || Date.now() - hiddenAt < SNOOZE_MS) return null;
  const available = totals.available + totals.reserved;

  return (
    <section className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-violet-600 via-fuchsia-600 to-pink-500 p-5 text-white shadow-sm sm:p-6">
      <Gift className="pointer-events-none absolute -right-6 -top-6 h-40 w-40 rotate-12 text-white/10" aria-hidden="true" />
      <button type="button" onClick={() => setHiddenAt(Date.now())} aria-label={t("Esconder durante 14 dias")}
        title={t("Esconder durante 14 dias")} className="absolute right-3 top-3 rounded-full p-1.5 text-white/80 hover:bg-white/15 hover:text-white">
        <X className="h-4 w-4" />
      </button>
      <div className="relative grid gap-4 lg:grid-cols-[1fr_minmax(0,26rem)] lg:items-center">
        <div>
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-white/85"><Gift className="h-4 w-4" />{t("Programa de indicações")}</p>
          <h2 className="mt-1 text-xl font-bold sm:text-2xl">{t("Conhece outra empresa? Ganhe 1 mês grátis.")}</h2>
          <p className="mt-1 max-w-xl text-sm text-white/85">
            {t("Partilhe o seu link. Quando a empresa se registar e fizer o primeiro pagamento, a sua próxima mensalidade fica por nossa conta. Os meses acumulam.")}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            {available > 0 && <span className="rounded-full bg-white/20 px-3 py-1 font-semibold">{t(available === 1 ? "{{n}} mês grátis disponível" : "{{n}} meses grátis disponíveis", { n: available })}</span>}
            {totals.pending > 0 && <span className="rounded-full bg-white/15 px-3 py-1">{t("{{n}} a aguardar pagamento", { n: totals.pending })}</span>}
            <Button asChild size="sm" variant="secondary" className="h-8 bg-white text-violet-700 hover:bg-white/90">
              <Link to="/indicacoes">{t("Ver indicações")} <ArrowRight className="ml-1 h-3.5 w-3.5" /></Link>
            </Button>
            <Link to="/indicacoes#avaliacao" className="inline-flex h-8 items-center gap-1.5 rounded-full bg-white/20 px-3 text-xs font-semibold hover:bg-white/30">
              <Clapperboard className="h-3.5 w-3.5" />{t("Avalie em vídeo: {{n}}% na mensalidade", { n: REVIEW_DISCOUNT_PERCENT })}
            </Link>
          </div>
        </div>
        <div className="rounded-xl bg-white p-3 text-foreground shadow-lg">
          <ReferralShare link={link} compact />
        </div>
      </div>
    </section>
  );
}
