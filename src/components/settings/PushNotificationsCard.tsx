import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Bell, BellOff, Loader2 } from "lucide-react";
import { supabase } from '@/integrations/supabase/client';
import { useToast } from "@/hooks/use-toast";
import { Link } from "react-router-dom";
import { useLanguage } from "@/i18n";

// iPhone, iPod, or an iPad (which reports itself as a Mac with a touch screen).
function isAppleMobile(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

interface PushNotificationsCardProps {
  organizationId?: string;
  pushNotifications: {
    isSupported: boolean;
    isSubscribed: boolean;
    isLoading: boolean;
    subscribe: () => Promise<boolean>;
    unsubscribe: () => Promise<boolean>;
  };
}

export const PushNotificationsCard = ({ organizationId, pushNotifications }: PushNotificationsCardProps) => {
  const { toast } = useToast();
  const { t } = useLanguage();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell className="h-5 w-5" />
          {t('Notificações Push')}
        </CardTitle>
        <CardDescription>
          {t('Receba alertas instantâneos quando chegarem novos leads.')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!pushNotifications.isSupported ? (
          <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-4">
            {isAppleMobile() ? (
              // On iPhone/iPad no browser has push in a tab, Chrome included: only
              // the Senvia added to the Home Screen can receive notifications.
              <p className="text-sm text-amber-600 dark:text-amber-400">
                {t('No iPhone e no iPad, as notificações só funcionam com a Senvia no ecrã principal (iOS 16.4 ou mais recente). No Safari, toque em Partilhar → Adicionar ao ecrã principal, abra a Senvia a partir do novo ícone e ative-as aqui.')}{' '}
                <Link to="/install" className="font-medium underline underline-offset-2">{t('Ver instruções')}</Link>
              </p>
            ) : (
              <p className="text-sm text-amber-600 dark:text-amber-400">
                {t('O seu browser não suporta notificações push. Tente usar Chrome, Safari ou Firefox.')}
              </p>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-sm font-medium">
                {pushNotifications.isSubscribed ? t('Notificações ativas') : t('Notificações desativadas')}
              </p>
              <p className="text-xs text-muted-foreground">
                {pushNotifications.isSubscribed 
                  ? t('Vai receber alertas para novos leads.') 
                  : t('Ative para receber alertas instantâneos.')}
              </p>
            </div>
            <div className="flex gap-2">
              {pushNotifications.isSubscribed && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    if (!organizationId) return;
                    try {
                      const { data, error } = await supabase.functions.invoke('send-push-notification', {
                        body: {
                          organization_id: organizationId,
                          title: t('🔔 Teste de Notificação'),
                          body: t('Se vês isto, as notificações estão a funcionar!'),
                          url: '/settings',
                          tag: 'test-notification',
                        },
                      });
                      if (error) throw error;
                      // Say what actually happened per device — "enviado" alone
                      // hid a tablet that the push service had already dropped.
                      const sent = Number(data?.sent ?? 0);
                      const total = Number(data?.total ?? 0);
                      const failed = (data?.results ?? []).filter((r: { success: boolean }) => !r.success);
                      toast({
                        title: total === 0 ? t('Nenhum dispositivo registado') : t(total === 1 ? 'Enviado para {{sent}} de {{total}} dispositivo' : 'Enviado para {{sent}} de {{total}} dispositivos', { sent, total }),
                        description: failed.length > 0
                          ? t('{{n}} falhou ({{codes}}) — esse aparelho foi removido; abre a app nele para o registar de novo.', { n: failed.length, codes: failed.map((r: { status?: number }) => r.status ?? t('erro')).join(', ') })
                          : total === 0 ? t('Ativa as notificações neste aparelho primeiro.') : t('Aguarda a notificação nos dispositivos.'),
                        variant: failed.length > 0 ? 'destructive' : undefined,
                      });
                    } catch (err) {
                      toast({ title: t('Erro'), description: t('Não foi possível enviar o teste.'), variant: 'destructive' });
                    }
                  }}
                >
                  {t('Testar')}
                </Button>
              )}
              <Button
                variant={pushNotifications.isSubscribed ? "outline" : "default"}
                size="sm"
                onClick={pushNotifications.isSubscribed ? pushNotifications.unsubscribe : pushNotifications.subscribe}
                disabled={pushNotifications.isLoading}
              >
                {pushNotifications.isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : pushNotifications.isSubscribed ? (
                  <>
                    <BellOff className="h-4 w-4 mr-2" />
                    {t('Desativar')}
                  </>
                ) : (
                  <>
                    <Bell className="h-4 w-4 mr-2" />
                    {t('Ativar')}
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
