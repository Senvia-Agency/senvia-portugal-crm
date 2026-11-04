import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, CreditCard, Loader2, Unplug } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { useStripeConnection } from '@/hooks/useStripeConnection';
import { useLanguage } from '@/i18n';

// Motivos devolvidos pelo callback da edge function. Traduzidos aqui para que o
// utilizador leia uma frase e não um código.
const CALLBACK_REASONS: Record<string, string> = {
  estado_invalido: 'O pedido de ligação expirou ou já tinha sido usado. Tente novamente.',
  pedido_incompleto: 'O Stripe devolveu um pedido incompleto.',
  conta_nao_devolvida: 'O Stripe não devolveu a conta ligada.',
  troca_falhou: 'Não foi possível concluir a autenticação no Stripe.',
  gravacao_falhou: 'A ligação foi autorizada mas não ficou guardada. Tente novamente.',
  access_denied: 'Autorização recusada no Stripe.',
};

export function StripeIntegrationCard() {
  const { connection, isLoading, connect, isConnecting, disconnect, isDisconnecting, refresh } =
    useStripeConnection();
  const [searchParams, setSearchParams] = useSearchParams();
  const { t } = useLanguage();

  // O callback do Stripe devolve o utilizador a /settings?stripe=… . Lemos o
  // resultado, avisamos, e limpamos o query string para que um refresh não
  // repita a mensagem.
  const outcome = searchParams.get('stripe');
  useEffect(() => {
    if (!outcome) return;
    if (outcome === 'connected') {
      toast.success(t('Stripe ligado com sucesso'));
      refresh();
    } else {
      const reason = searchParams.get('stripe_reason') ?? '';
      toast.error(t(CALLBACK_REASONS[reason] ?? 'Não foi possível ligar o Stripe'));
    }
    const next = new URLSearchParams(searchParams);
    next.delete('stripe');
    next.delete('stripe_reason');
    setSearchParams(next, { replace: true });
  }, [outcome, searchParams, setSearchParams, refresh]);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">{t('A verificar ligação...')}</span>
      </div>
    );
  }

  const restricted = connection.status === 'restricted';

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-primary/10 p-3">
                <CreditCard className="h-6 w-6 text-primary" />
              </div>
              <div>
                <p className="font-medium">
                  {connection.connected ? t('Conta Stripe ligada') : t('Nenhuma conta Stripe ligada')}
                </p>
                <p className="text-sm text-muted-foreground">
                  {connection.connected
                    ? connection.accountMasked
                    : t('Ligue a conta da sua empresa para cobrar subscrições automaticamente.')}
                </p>
              </div>
            </div>
            {connection.connected && (
              <div className="flex flex-col items-end gap-1 shrink-0">
                <Badge
                  variant="outline"
                  className={
                    restricted
                      ? 'bg-amber-500/10 text-amber-600 border-amber-500/20'
                      : 'bg-green-500/10 text-green-600 border-green-500/20'
                  }
                >
                  {restricted ? t('Com restrições') : t('Ativa')}
                </Badge>
                {connection.mode === 'test' && (
                  <Badge variant="outline" className="bg-muted/50 text-muted-foreground text-[10px]">
                    {t('Modo de teste')}
                  </Badge>
                )}
              </div>
            )}
          </div>

          {restricted && (
            <div className="flex gap-2 rounded-md border border-amber-500/20 bg-amber-500/5 p-3">
              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-sm text-muted-foreground">
                {t('O Stripe ainda não permite cobranças nesta conta. Complete a verificação no painel do Stripe — normalmente faltam dados da empresa ou a conta bancária.')}
              </p>
            </div>
          )}

          {connection.lastError && (
            <p className="text-sm text-destructive">{connection.lastError}</p>
          )}

          {connection.connected && !restricted && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              {t('Pronta a receber pagamentos de subscrições.')}
            </div>
          )}

          <div className="flex gap-2 pt-2">
            {connection.connected ? (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" disabled={isDisconnecting} className="gap-2">
                    {isDisconnecting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Unplug className="h-4 w-4" />
                    )}
                    {t('Desligar')}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t('Desligar o Stripe?')}</AlertDialogTitle>
                    <AlertDialogDescription>
                      {t('As subscrições existentes deixam de ser renovadas automaticamente e os pagamentos deixam de entrar no CRM. O histórico de pagamentos já registado mantém-se intacto. Pode voltar a ligar a mesma conta depois.')}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t('Cancelar')}</AlertDialogCancel>
                    <AlertDialogAction onClick={() => disconnect()}>{t('Desligar')}</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : (
              <Button onClick={() => connect()} disabled={isConnecting} className="gap-2">
                {isConnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
                {t('Ligar conta Stripe')}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        {t('A ligação usa o Stripe Connect. Os pagamentos entram diretamente na conta da sua empresa — o Senvia OS nunca recebe nem guarda dados de cartão.')}
      </p>
    </div>
  );
}
