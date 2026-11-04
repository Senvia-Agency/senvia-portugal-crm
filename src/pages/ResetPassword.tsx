import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Loader2, KeyRound, CheckCircle2, AlertCircle } from 'lucide-react';
import { useLanguage } from '@/i18n';

export default function ResetPassword() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isValidSession, setIsValidSession] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check if we have a valid recovery session
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      
      // The user arrives here from a password reset email link
      // Supabase automatically creates a session when the link is clicked
      if (session) {
        setIsValidSession(true);
      } else {
      setError('Link de recuperação inválido ou expirado. Por favor, solicite um novo link.');
      }
      setLoading(false);
    };

    checkSession();

    // Listen for auth state changes (when user clicks the reset link)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' && session) {
        setIsValidSession(true);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const getPasswordStrength = (pass: string): { label: string; color: string; width: string } => {
    if (!pass) return { label: '', color: 'bg-muted', width: '0%' };
    
    let score = 0;
    if (pass.length >= 6) score++;
    if (pass.length >= 8) score++;
    if (/[a-z]/.test(pass) && /[A-Z]/.test(pass)) score++;
    if (/\d/.test(pass)) score++;
    if (/[^a-zA-Z0-9]/.test(pass)) score++;

    if (score <= 2) return { label: 'Fraca', color: 'bg-destructive', width: '33%' };
    if (score <= 3) return { label: 'Média', color: 'bg-yellow-500', width: '66%' };
    return { label: 'Forte', color: 'bg-green-500', width: '100%' };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (password.length < 6) {
      toast({
        title: t('Palavra-passe muito curta'),
        description: t('A palavra-passe deve ter pelo menos 6 caracteres.'),
        variant: 'destructive',
      });
      return;
    }

    if (password !== confirmPassword) {
      toast({
        title: t('Palavras-passe não coincidem'),
        description: t('Verifique se as palavras-passe são iguais.'),
        variant: 'destructive',
      });
      return;
    }

    setIsSubmitting(true);

    try {
      const { error: updateError } = await supabase.auth.updateUser({
        password: password,
      });

      if (updateError) throw updateError;

      setSuccess(true);
      toast({
        title: t('Palavra-passe alterada!'),
        description: t('A sua palavra-passe foi alterada com sucesso.'),
      });

      // Redirect to login after success
      setTimeout(() => {
        navigate('/');
      }, 2000);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : t('Ocorreu um erro ao alterar a palavra-passe.');
      toast({
        title: t('Erro'),
        description: errorMessage,
        variant: 'destructive',
      });
    }

    setIsSubmitting(false);
  };

  const passwordStrength = getPasswordStrength(password);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-4">
        <Card className="max-w-md w-full bg-slate-900/50 border-slate-800">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center">
              <AlertCircle className="h-6 w-6 text-destructive" />
            </div>
            <CardTitle className="text-white">{t('Link Inválido')}</CardTitle>
            <CardDescription>{t(error)}</CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <Button onClick={() => navigate('/')}>
              {t('Voltar ao Login')}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-4">
        <Card className="max-w-md w-full bg-slate-900/50 border-slate-800">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center">
              <CheckCircle2 className="h-6 w-6 text-green-500" />
            </div>
            <CardTitle className="text-white">{t('Palavra-passe Alterada!')}</CardTitle>
            <CardDescription>
              {t('A sua palavra-passe foi alterada com sucesso. A redirecionar para o login...')}
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-4">
      <Card className="max-w-md w-full bg-slate-900/50 border-slate-800">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
            <KeyRound className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-white">{t('Nova Palavra-passe')}</CardTitle>
          <CardDescription>
            {t('Introduza a sua nova palavra-passe.')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password" className="text-slate-200">{t('Nova Palavra-passe')}</Label>
              <Input
                id="password"
                type="password"
                placeholder={t('Mínimo 6 caracteres')}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="bg-slate-800/50 border-slate-700 text-white"
                required
              />
              {password && (
                <div className="space-y-1">
                  <div className="h-1.5 w-full bg-slate-700 rounded-full overflow-hidden">
                    <div 
                      className={`h-full transition-all duration-300 ${passwordStrength.color}`}
                      style={{ width: passwordStrength.width }}
                    />
                  </div>
                  <p className={`text-xs ${
                    passwordStrength.label === 'Fraca' ? 'text-destructive' :
                    passwordStrength.label === 'Média' ? 'text-yellow-500' : 'text-green-500'
                  }`}>
                    {t('Força: {{label}}', { label: t(passwordStrength.label) })}
                  </p>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword" className="text-slate-200">{t('Confirmar Palavra-passe')}</Label>
              <Input
                id="confirmPassword"
                type="password"
                placeholder={t('Repita a palavra-passe')}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="bg-slate-800/50 border-slate-700 text-white"
                required
              />
              {confirmPassword && password !== confirmPassword && (
                <p className="text-xs text-destructive">{t('As palavras-passe não coincidem')}</p>
              )}
            </div>

            <Button 
              type="submit" 
              className="w-full" 
              disabled={isSubmitting || !isValidSession}
            >
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('Alterar Palavra-passe')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
