import { useNavigate } from 'react-router-dom';
import { AlertTriangle, CreditCard, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useStripeSubscription } from '@/hooks/useStripeSubscription';
import { useLanguage, intlLocale } from '@/i18n';

interface PaymentOverdueBlockerProps {
  paymentFailedAt?: string;
}

export function PaymentOverdueBlocker({ paymentFailedAt }: PaymentOverdueBlockerProps) {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { openCustomerPortal, isLoading } = useStripeSubscription();

  // `paymentFailedAt` is now the end of the last paid Stripe period (renewal date).
  // Falls back to a generic message if absent.
  const renewalDate = paymentFailedAt ? new Date(paymentFailedAt) : null;

  return (
    <div className="fixed inset-0 z-[100] bg-background flex items-center justify-center p-4 pt-safe pb-safe">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="mx-auto w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center">
          <AlertTriangle className="h-8 w-8 text-destructive" />
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight">
            {t("A tua mensalidade expirou")}
          </h1>
          <p className="text-muted-foreground text-sm">
            {t("Continuas a ser cliente — só precisas de renovar a mensalidade para voltares a aceder ao sistema. Os teus dados ficam intactos.")}
          </p>
        </div>

        <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-4">
          <div className="flex items-center justify-center gap-2 text-destructive">
            <CreditCard className="h-4 w-4" />
            <span className="text-sm font-semibold">
              {t("Acesso suspenso até regularizares o pagamento")}
            </span>
          </div>
          {renewalDate && (
            <p className="text-xs text-muted-foreground mt-2">
              {t("Renovação prevista para")}{' '}
              {renewalDate.toLocaleDateString(intlLocale(), { day: '2-digit', month: 'long', year: 'numeric' })}
            </p>
          )}
        </div>

        <div className="space-y-3">
          <Button
            size="lg"
            className="w-full gap-2"
            onClick={() => openCustomerPortal()}
            disabled={isLoading}
          >
            <CreditCard className="h-4 w-4" />
            {t("Renovar Mensalidade")}
          </Button>

          <Button
            variant="outline"
            size="lg"
            className="w-full gap-2"
            onClick={() => navigate('/settings?tab=billing')}
          >
            <Settings className="h-4 w-4" />
            {t("Ver Faturação")}
          </Button>
        </div>
      </div>
    </div>
  );
}
