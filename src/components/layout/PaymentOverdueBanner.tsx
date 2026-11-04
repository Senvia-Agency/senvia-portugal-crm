import { AlertTriangle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { useLanguage, intlLocale } from '@/i18n';

interface PaymentOverdueBannerProps {
  /** Whole days left before access is suspended. */
  daysUntilBlock: number;
  /** When access will be suspended (ISO). Shown in the copy when present. */
  blockAt?: string | null;
  /** Length of the grace window, for the progress bar. */
  totalDays?: number;
}

export function PaymentOverdueBanner({ daysUntilBlock, blockAt, totalDays = 3 }: PaymentOverdueBannerProps) {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const elapsed = Math.max(0, totalDays - daysUntilBlock);
  const progress = Math.min(100, Math.round((elapsed / totalDays) * 100));
  const blockDate = blockAt ? new Date(blockAt) : null;
  const daysLabel = t(daysUntilBlock === 1 ? '{{n}} dia' : '{{n}} dias', { n: daysUntilBlock });

  return (
    <div className="bg-destructive/10 border-b border-destructive/20 px-4 py-2.5">
      <div className="flex items-center gap-3 sm:gap-4 flex-wrap sm:flex-nowrap">
        {/* Left: icon + text */}
        <div className="flex items-center gap-2 shrink-0">
          <AlertTriangle className="h-4 w-4 text-destructive" />
          <span className="text-xs font-semibold text-destructive">
            {t("Pagamento em atraso — regulariza em {{days}}", { days: daysLabel })}
            {blockDate && (
              <span className="font-normal">
                {' '}{t("(até {{date}})", { date: blockDate.toLocaleDateString(intlLocale(), { day: '2-digit', month: 'long' }) })}
              </span>
            )}
            {' '}{t("ou o acesso será suspenso.")}
          </span>
        </div>

        {/* Center: progress bar */}
        <Progress value={progress} className="h-1.5 flex-1 min-w-[80px] bg-destructive/15 [&>div]:bg-destructive" />

        {/* Right: CTA button */}
        <Button
          variant="destructive"
          size="sm"
          className="h-7 text-xs px-3 shrink-0"
          onClick={() => navigate('/settings?tab=billing')}
        >
          {t("Regularizar")}
        </Button>
      </div>
    </div>
  );
}
