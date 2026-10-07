import { useEffect, useState } from 'react';
import { CheckCircle2, Loader2, MailCheck, MessageCircle, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';

interface VerificationStatus {
  email_verified: boolean;
  whatsapp_verified: boolean;
  completed: boolean;
  whatsapp_url: string | null;
}

export default function VerifyLead() {
  const [token, setToken] = useState('');
  const [status, setStatus] = useState<VerificationStatus | null>(null);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  const checkStatus = async (action: 'confirm_email' | 'status', value: string) => {
    const { data, error: invokeError } = await supabase.functions.invoke('verify-lead', {
      body: { action, token: value },
    });
    if (invokeError || data?.error) throw new Error(data?.error || 'Não foi possível verificar agora.');
    setStatus(data as VerificationStatus);
  };

  useEffect(() => {
    const value = new URLSearchParams(window.location.hash.slice(1)).get('token') || '';
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    setToken(value);
    if (!/^[0-9a-f]{64}$/i.test(value)) {
      setError('Este link de confirmação não é válido.');
      setIsLoading(false);
      return;
    }
    checkStatus('status', value)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Não foi possível verificar agora.'))
      .finally(() => setIsLoading(false));
  }, []);

  const confirmEmail = async () => {
    setIsLoading(true);
    setError('');
    try {
      await checkStatus('confirm_email', token);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível confirmar agora.');
    } finally {
      setIsLoading(false);
    }
  };

  const refresh = async () => {
    setIsLoading(true);
    setError('');
    try {
      await checkStatus('status', token);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível verificar agora.');
    } finally {
      setIsLoading(false);
    }
  };

  const completed = status?.completed === true;
  const emailVerified = status?.email_verified === true;
  const whatsappVerified = status?.whatsapp_verified === true;

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <Card className="w-full max-w-lg">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
            {isLoading ? <Loader2 className="h-7 w-7 animate-spin text-primary" />
              : completed ? <CheckCircle2 className="h-7 w-7 text-emerald-600" />
                : error ? <ShieldAlert className="h-7 w-7 text-destructive" />
                  : <MailCheck className="h-7 w-7 text-primary" />}
          </div>
          <CardTitle>{completed ? 'Contacto confirmado' : 'Confirmação de contacto'}</CardTitle>
          <CardDescription>
            {completed
              ? 'Obrigado. A sua mensagem foi recebida e entraremos em contacto.'
              : 'Confirmamos o email e o número de WhatsApp antes de registar o pedido.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && <p className="text-center text-sm text-destructive" role="alert">{error}</p>}
          {!completed && status && (
            <div className="space-y-3 rounded-lg border p-4">
              <p className="flex items-center gap-2 text-sm">
                <MailCheck className={`h-4 w-4 ${emailVerified ? 'text-emerald-600' : 'text-muted-foreground'}`} />
                Email {emailVerified ? 'confirmado' : 'por confirmar'}
              </p>
              <p className="flex items-center gap-2 text-sm">
                <MessageCircle className={`h-4 w-4 ${whatsappVerified ? 'text-emerald-600' : 'text-muted-foreground'}`} />
                WhatsApp {whatsappVerified ? 'confirmado' : 'por confirmar'}
              </p>
            </div>
          )}
          {!completed && !emailVerified && status && (
            <Button className="w-full" onClick={confirmEmail} disabled={isLoading || !token}>
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirmar o meu email
            </Button>
          )}
          {!completed && emailVerified && status?.whatsapp_url && (
            <Button asChild className="w-full bg-[#25D366] text-white hover:bg-[#1fb85a]">
              <a href={status.whatsapp_url} target="_blank" rel="noreferrer">
                <MessageCircle className="mr-2 h-4 w-4" /> Confirmar número no WhatsApp
              </a>
            </Button>
          )}
          {!completed && emailVerified && (!whatsappVerified || !status?.completed) && (
            <Button variant="outline" className="w-full" onClick={refresh} disabled={isLoading || !token}>
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {whatsappVerified ? 'Concluir registo' : 'Já enviei a mensagem, verificar'}
            </Button>
          )}
          {!completed && emailVerified && !whatsappVerified && !status?.whatsapp_url && !isLoading && !error && (
            <p className="text-center text-sm text-muted-foreground">O WhatsApp de confirmação está temporariamente indisponível. Tenta novamente mais tarde.</p>
          )}
          {!emailVerified && !error && !isLoading && (
            <p className="text-center text-sm text-muted-foreground">Clica no botão acima para confirmar que este email te pertence.</p>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
