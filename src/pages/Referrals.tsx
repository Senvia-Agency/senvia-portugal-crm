import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { Clapperboard, Gift, Sparkles } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { ReferralProgram } from "@/components/settings/ReferralProgram";
import { ReferralOfferCard } from "@/components/referrals/ReferralOfferCard";
import { VideoReviewCard } from "@/components/referrals/VideoReviewCard";
import { usePermissions } from "@/hooks/usePermissions";
import { useReferralDashboard } from "@/hooks/useReferralDashboard";
import { REVIEW_DISCOUNT_PERCENT, REVIEW_INSTAGRAM_HANDLE, REVIEW_MIN_SECONDS, useVideoReview, type ReviewStatus } from "@/hooks/useVideoReview";
import { useLanguage } from "@/i18n";

const VIDEO_STATE: Record<ReviewStatus | "none", string> = {
  none: "Vídeo por enviar",
  pending: "Vídeo em análise",
  video_approved: "Vídeo aprovado: falta o Instagram",
  post_submitted: "Publicação em confirmação",
  approved: "Desconto do vídeo aplicado",
  rejected: "Vídeo não aprovado: pode reenviar",
};

const FAQ = [
  ["Quando recebo o mês grátis?", "Quando a empresa que indicou faz o primeiro pagamento. Na subscrição mensal, a renovação seguinte sai grátis (plano e utilizadores adicionais). Na anual, a próxima renovação passa um mês para a frente, sem pagar mais."],
  ["Posso indicar várias empresas?", "Sim, sem limite. Cada empresa que pague vale mais um mês grátis, e os meses acumulam."],
  ["Como funciona a avaliação em vídeo?", "Grave {{s}} segundos ou mais a contar como o Senvia OS ajudou a sua empresa (pode ser no telemóvel). A Senvia aprova o vídeo, publica-o no seu Instagram a marcar {{handle}} e envia o link. Depois de a Senvia confirmar, ganha {{n}}% na mensalidade seguinte (na subscrição anual, {{n}}% do valor de um mês, descontado na próxima fatura)."],
  ["E se o vídeo não for aprovado?", "Recebe o motivo e pode enviar um vídeo novo. O desconto do vídeo é dado uma vez por empresa."],
  ["Os dois prémios acumulam?", "Sim. Pode ganhar meses grátis por indicações e o desconto do vídeo, também na subscrição anual: cada indicação adia a renovação um mês, logo que a empresa indicada paga."],
] as const;

/** Indicações: a banner with the two offers and what you have earned, the two cards to act, then the details. */
export default function Referrals() {
  const { t } = useLanguage();
  const { hash } = useLocation();
  const { isAdmin } = usePermissions();
  const { totals } = useReferralDashboard();
  const { data: video } = useVideoReview();
  useEffect(() => { if (hash) window.setTimeout(() => document.querySelector(hash)?.scrollIntoView({ behavior: "smooth", block: "start" }), 300); }, [hash]);

  const months = totals ? totals.available + totals.reserved : null;
  const videoState = VIDEO_STATE[video?.review?.status ?? "none"];
  const vars = { s: REVIEW_MIN_SECONDS, handle: REVIEW_INSTAGRAM_HANDLE, n: REVIEW_DISCOUNT_PERCENT };

  return (
    <div className="crm-page">
      <div className="mx-auto max-w-5xl p-4 pb-nav-safe sm:p-6 lg:py-7">
        <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-violet-700 via-fuchsia-600 to-rose-500 px-6 pb-20 pt-8 text-white shadow-lg sm:px-10 sm:pb-24 sm:pt-10">
          <Gift className="pointer-events-none absolute -right-8 -top-10 h-64 w-64 rotate-12 text-white/10" aria-hidden="true" />
          <div className="relative grid gap-6 md:grid-cols-[1fr_auto] md:items-center">
            <div className="max-w-xl">
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-white/80"><Sparkles className="h-4 w-4" aria-hidden="true" />{t("Programa de recompensas")}</p>
              <h1 className="mt-3 text-3xl font-bold leading-tight sm:text-4xl">{t("Ajude a Senvia a crescer e ganhe em troca.")}</h1>
              <p className="mt-3 text-sm text-white/85 sm:text-base">{t("Escolha uma das duas formas, ou as duas: indicar uma empresa ou contar a sua história em vídeo.")}</p>
              <div className="mt-5 flex flex-wrap gap-2 text-sm font-semibold">
                <span className="inline-flex items-center gap-2 rounded-full bg-white/20 px-4 py-1.5 backdrop-blur"><Gift className="h-4 w-4" aria-hidden="true" />{t("1 mês grátis por indicação")}</span>
                <span className="inline-flex items-center gap-2 rounded-full bg-white/20 px-4 py-1.5 backdrop-blur"><Clapperboard className="h-4 w-4" aria-hidden="true" />{t("{{n}}% por avaliação em vídeo", { n: REVIEW_DISCOUNT_PERCENT })}</span>
              </div>
            </div>
            {/* What this company has earned so far, at a glance. */}
            <div className="rounded-2xl bg-white/15 p-5 ring-1 ring-white/25 backdrop-blur md:min-w-[15rem]">
              <p className="text-xs font-semibold uppercase tracking-widest text-white/75">{t("Os seus ganhos")}</p>
              {months !== null && (
                <p className="mt-2 flex items-baseline gap-2"><span className="text-4xl font-bold tabular-nums">{months}</span><span className="text-sm text-white/85">{t(months === 1 ? "mês grátis disponível" : "meses grátis disponíveis")}</span></p>
              )}
              <p className="mt-2 flex items-center gap-2 text-sm text-white/90"><Clapperboard className="h-4 w-4 shrink-0" aria-hidden="true" />{t(videoState)}</p>
            </div>
          </div>
        </section>

        <div data-otto-target="guide-referrals-offers" className="relative -mt-12 grid gap-4 px-2 sm:-mt-14 sm:px-6 lg:grid-cols-2">
          <ReferralOfferCard />
          <VideoReviewCard />
        </div>

        {isAdmin && <div className="mt-8"><ReferralProgram embedded /></div>}

        <section className="mt-8 rounded-2xl border bg-card px-5 py-2 shadow-sm">
          <h2 className="pt-3 text-base font-semibold">{t("Perguntas frequentes")}</h2>
          <Accordion type="single" collapsible>
            {FAQ.map(([q, a]) => (
              <AccordionItem key={q} value={q} className="last:border-b-0">
                <AccordionTrigger className="text-left text-sm">{t(q)}</AccordionTrigger>
                <AccordionContent className="text-sm text-muted-foreground">{t(a, vars)}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </section>
      </div>
    </div>
  );
}
