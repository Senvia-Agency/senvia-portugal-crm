import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Shield, CheckCircle2 } from 'lucide-react';
import { useLanguage } from '@/i18n';

interface EnrollMFAProps {
  onSuccess: () => void;
  onCancel: () => void;
}

export function EnrollMFA({ onSuccess, onCancel }: EnrollMFAProps) {
  const { toast } = useToast();
  const { t } = useLanguage();
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [verifyCode, setVerifyCode] = useState('');
  const [isEnrolling, setIsEnrolling] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);

  const handleEnroll = async () => {
    setIsEnrolling(true);
    try {
      // Limpar fatores TOTP não verificados de tentativas anteriores
      const { data: factors } = await supabase.auth.mfa.listFactors();
      const unverifiedFactors = factors?.all?.filter(f => f.factor_type === 'totp' && f.status === 'unverified') || [];
      for (const factor of unverifiedFactors) {
        await supabase.auth.mfa.unenroll({ factorId: factor.id });
      }

      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: 'Authenticator App',
        issuer: 'Senvia OS',
      });

      if (error) throw error;

      setQrCode(data.totp.qr_code);
      setFactorId(data.id);
    } catch (error: any) {
      toast({
        title: t('Erro ao ativar 2FA'),
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setIsEnrolling(false);
    }
  };

  const handleVerify = async () => {
    if (!factorId || verifyCode.length !== 6) return;

    setIsVerifying(true);
    try {
      const { data: challengeData, error: challengeError } = await supabase.auth.mfa.challenge({
        factorId,
      });

      if (challengeError) throw challengeError;

      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId,
        challengeId: challengeData.id,
        code: verifyCode,
      });

      if (verifyError) throw verifyError;

      toast({
        title: t('Autenticação de dois fatores ativada!'),
        description: t('A sua conta está agora protegida com 2FA.'),
      });
      onSuccess();
    } catch (error: any) {
      toast({
        title: t('Código inválido'),
        description: t('Verifique o código e tente novamente.'),
        variant: 'destructive',
      });
      setVerifyCode('');
    } finally {
      setIsVerifying(false);
    }
  };

  if (!qrCode) {
    return (
      <Card className="border-border">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Shield className="h-6 w-6 text-primary" />
          </div>
          <CardTitle>{t("Ativar Autenticação 2FA")}</CardTitle>
          <CardDescription>
            {t("Proteja a sua conta com uma camada extra de segurança usando o Microsoft Authenticator, Google Authenticator ou qualquer app TOTP.")}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Button onClick={handleEnroll} disabled={isEnrolling} className="w-full">
            {isEnrolling ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t("A gerar QR Code...")}</>
            ) : (
              t('Ativar 2FA')
            )}
          </Button>
          <Button variant="outline" onClick={onCancel} className="w-full">
            {t("Cancelar")}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border">
      <CardHeader className="text-center">
        <CardTitle>{t("Digitalizar QR Code")}</CardTitle>
        <CardDescription>
          {t("Abra a sua app de autenticação e digitalize o código abaixo.")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* QR Code */}
        <div className="flex justify-center">
          <div
            className="rounded-lg bg-white p-3"
            dangerouslySetInnerHTML={{ __html: qrCode }}
          />
        </div>

        {/* Verification */}
        <div className="space-y-3">
          <p className="text-sm text-center text-muted-foreground">
            {t("Insira o código de 6 dígitos da sua app:")}
          </p>
          <div className="flex justify-center">
            <InputOTP
              maxLength={6}
              value={verifyCode}
              onChange={setVerifyCode}
            >
              <InputOTPGroup>
                <InputOTPSlot index={0} />
                <InputOTPSlot index={1} />
                <InputOTPSlot index={2} />
                <InputOTPSlot index={3} />
                <InputOTPSlot index={4} />
                <InputOTPSlot index={5} />
              </InputOTPGroup>
            </InputOTP>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <Button
            onClick={handleVerify}
            disabled={isVerifying || verifyCode.length !== 6}
            className="w-full"
          >
            {isVerifying ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t("A verificar...")}</>
            ) : (
              <><CheckCircle2 className="mr-2 h-4 w-4" />{t("Confirmar")}</>
            )}
          </Button>
          <Button variant="outline" onClick={onCancel} className="w-full">
            {t("Cancelar")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
