import { Link, useLocation } from "react-router-dom";
import { Gift } from "lucide-react";
import { useReferralDashboard } from "@/hooks/useReferralDashboard";
import { useLanguage } from "@/i18n";

/**
 * The gift in the top bar: one click to the Indicações page, where the invite
 * link, the free months and the video review all live. It shows the free months
 * already earned, so the reward stays in sight.
 */
export function ReferralTopbarButton() {
  const { isAdmin, link, totals } = useReferralDashboard();
  const { pathname } = useLocation();
  const { t } = useLanguage();
  if (!isAdmin || !link || !totals) return null;
  const available = totals.available + totals.reserved;

  return (
    <Link
      to="/indicacoes"
      data-otto-target="guide-referrals"
      className="workplace-referral-button"
      aria-current={pathname === "/indicacoes" ? "page" : undefined}
      aria-label={t("Indicações: convide uma empresa e ganhe 1 mês grátis")}
    >
      <Gift className="h-4 w-4" aria-hidden="true" />
      <span className="workplace-referral-label">{t("Ganhe meses grátis")}</span>
      {available > 0 && <span className="workplace-referral-count">{available}</span>}
    </Link>
  );
}
