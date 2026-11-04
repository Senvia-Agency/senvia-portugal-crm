import { useNavigate } from 'react-router-dom';
import { AlertTriangle, CreditCard, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/i18n';

interface TrialExpiredBlockerProps {
  trialEndsAt?: string;
}

export function TrialExpiredBlocker({ trialEndsAt }: TrialExpiredBlockerProps) {
  const navigate = useNavigate();
  const { t } = useLanguage();

  // Calculate days until data deletion (60 days after trial end)
  let daysUntilDeletion = 60;
  if (trialEndsAt) {
    const trialEnd = new Date(trialEndsAt);
    const deletionDate = new Date(trialEnd.getTime() + 60 * 24 * 60 * 60 * 1000);
    const now = new Date();
    daysUntilDeletion = Math.max(0, Math.ceil((deletionDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
  }

  return (
    <div className="fixed inset-0 z-[100] bg-background flex items-center justify-center p-4 pt-safe pb-safe">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="mx-auto w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center">
          <AlertTriangle className="h-8 w-8 text-destructive" />
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight">
            {t("O seu período de teste terminou")}
          </h1>
          <p className="text-muted-foreground text-sm">
            {t("Os 14 dias de teste gratuito chegaram ao fim. Para continuar a usar o sistema, escolha um plano.")}
          </p>
        </div>

        <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-4">
          <div className="flex items-center justify-center gap-2 text-destructive">
            <Clock className="h-4 w-4" />
            <span className="text-sm font-semibold">
              {daysUntilDeletion > 0
                ? t(daysUntilDeletion === 1 ? "{{n}} dia restante antes de os dados serem eliminados" : "{{n}} dias restantes antes de os dados serem eliminados", { n: daysUntilDeletion })
                : t('Os seus dados serão eliminados em breve')}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            {t("Se não escolher um plano dentro de 60 dias após o fim do teste, todos os seus dados serão permanentemente apagados.")}
          </p>
        </div>

        <Button
          size="lg"
          className="w-full gap-2"
          onClick={() => navigate('/settings?tab=billing')}
        >
          <CreditCard className="h-4 w-4" />
          {t("Escolher Plano")}
        </Button>
      </div>
    </div>
  );
}
