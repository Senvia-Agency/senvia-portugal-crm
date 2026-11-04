import { useCallback, useEffect, useState } from 'react';
import { Chrome, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/i18n';

// Pairing handshake for the "Senvia OS — WhatsApp" Chrome extension.
//
// The extension injects a content script on this origin. We hand the session
// over through window.postMessage (same-origin) rather than chrome.runtime
// messaging, so the page never needs to know the extension's id — which changes
// on every unpacked reload during development.
//
// Nothing is sent anywhere: the tokens go to a local extension, same machine.

type State = 'idle' | 'pairing' | 'done' | 'error';

export default function ExtensionAuth() {
  const { t } = useLanguage();
  const { user, organization } = useAuth();
  const [detected, setDetected] = useState(false);
  const [state, setState] = useState<State>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const data = event.data as { source?: string; type?: string; ok?: boolean; error?: string };
      if (data?.source !== 'senvia-extension') return;

      if (data.type === 'PRESENT') {
        setDetected(true);
        return;
      }
      if (data.type === 'PAIR_RESULT') {
        if (data.ok) {
          setState('done');
        } else {
          setState('error');
          setError(data.error ?? 'Não foi possível ligar a extensão.');
        }
      }
    };
    window.addEventListener('message', onMessage);
    // The content script may have announced itself before this page mounted.
    window.postMessage({ source: 'senvia-crm', type: 'PING' }, window.location.origin);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const pair = useCallback(async () => {
    setState('pairing');
    setError(null);

    const { data, error: sessionError } = await supabase.auth.getSession();
    const session = data.session;
    if (sessionError || !session) {
      setState('error');
      setError('Sessão não encontrada. Volte a entrar na sua conta.');
      return;
    }
    if (!organization?.id) {
      setState('error');
      setError('Nenhuma organização ativa selecionada.');
      return;
    }

    window.postMessage(
      {
        source: 'senvia-crm',
        type: 'PAIR',
        session: {
          accessToken: session.access_token,
          refreshToken: session.refresh_token,
          organizationId: organization.id,
          organizationName: organization.name ?? null,
          userEmail: user?.email ?? null,
          pairedAt: Date.now(),
        },
      },
      window.location.origin,
    );

    // If no content script answers, the extension isn't installed/enabled.
    window.setTimeout(() => {
      setState((prev) => {
        if (prev !== 'pairing') return prev;
        setError('A extensão não respondeu. Confirme que está instalada e ativa, e recarregue esta página.');
        return 'error';
      });
    }, 3000);
  }, [organization?.id, organization?.name, user?.email]);

  return (
    <div className="mx-auto max-w-2xl p-4 md:p-6">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-muted p-2.5">
              <Chrome className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <CardTitle>{t('Extensão para o WhatsApp Web')}</CardTitle>
              <CardDescription>
                {t('Mostra a ficha do CRM ao lado das conversas em web.whatsapp.com')}
              </CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-5">
          <div className="rounded-lg border bg-muted/30 p-3 text-sm">
            <p className="font-medium">{t('Vai ligar esta conta:')}</p>
            <p className="mt-1 text-muted-foreground">
              {user?.email ?? '—'} · {organization?.name ?? t('sem organização')}
            </p>
          </div>

          {state === 'done' ? (
            <div className="flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-medium">{t('Extensão ligada.')}</p>
                <p className="mt-0.5 opacity-90">
                  {t('Abra o web.whatsapp.com — o painel Senvia aparece à direita.')}
                </p>
              </div>
            </div>
          ) : (
            <>
              <Button onClick={pair} disabled={state === 'pairing' || !organization?.id} className="w-full sm:w-auto">
                {state === 'pairing' ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t('A ligar…')}
                  </>
                ) : (
                  t('Ligar extensão')
                )}
              </Button>

              {!detected && state === 'idle' && (
                <p className="text-xs text-muted-foreground">
                  {t('Ainda não detetámos a extensão nesta página. Se já a instalou, recarregue.')}
                </p>
              )}

              {state === 'error' && error && (
                <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <p>{t(error)}</p>
                </div>
              )}
            </>
          )}

          <div className="border-t pt-4 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">{t('O que a extensão vê')}</p>
            <p className="mt-1">
              {t('Apenas o número de telefone da conversa aberta, para procurar a ficha correspondente no seu CRM. O conteúdo das mensagens nunca é lido nem enviado.')}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
