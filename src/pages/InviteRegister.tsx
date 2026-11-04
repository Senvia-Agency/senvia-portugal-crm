import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Loader2, UserPlus, AlertCircle, CheckCircle2, Building, LogOut } from 'lucide-react';
import { useLanguage } from '@/i18n';

interface InviteData {
  id: string;
  email: string;
  role: string;
  organization_id: string;
  organization_name?: string;
  token: string;
}

const ROLE_LABELS: Record<string, string> = {
  admin: 'Administrador',
  viewer: 'Visualizador',
};

export default function InviteRegister() {
  const { token } = useParams<{ token: string }>();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [invite, setInvite] = useState<InviteData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [shouldRedirect, setShouldRedirect] = useState(false);
  const [currentSession, setCurrentSession] = useState<boolean | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Handle redirect with proper cleanup
  useEffect(() => {
    if (shouldRedirect) {
      const timer = setTimeout(() => navigate('/dashboard'), 2000);
      return () => clearTimeout(timer);
    }
  }, [shouldRedirect, navigate]);

  // Check for existing session
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setCurrentSession(!!session);
    });
  }, []);

  const handleLogout = async () => {
    setLoggingOut(true);
    await supabase.auth.signOut();
    setCurrentSession(false);
    setLoggingOut(false);
    toast({
      title: t('Sessão terminada'),
      description: t('Pode agora criar uma nova conta.'),
    });
  };

  useEffect(() => {
    async function validateInvite() {
      if (!token) {
        setError('Link de convite inválido.');
        setLoading(false);
        return;
      }

      try {
        // Fetch invite data
        const { data: inviteData, error: inviteError } = await supabase
          .from('organization_invites')
          .select('id, email, role, organization_id, token')
          .eq('token', token)
          .eq('status', 'pending')
          .gt('expires_at', new Date().toISOString())
          .single();

        if (inviteError || !inviteData) {
          setError('Este convite é inválido ou já expirou.');
          setLoading(false);
          return;
        }

        // Get organization name using RPC function (bypasses RLS)
        const { data: orgName } = await supabase.rpc('get_org_name_by_invite_token', {
          _token: token
        });

        setInvite({
          ...inviteData,
          organization_name: orgName || t('Organização'),
        });
      } catch {
        setError('Ocorreu um erro ao validar o convite.');
      }

      setLoading(false);
    }

    validateInvite();
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!invite || !fullName.trim() || !password) {
      toast({
        title: t('Campos obrigatórios'),
        description: t('Preencha todos os campos.'),
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

    if (password.length < 6) {
      toast({
        title: t('Palavra-passe muito curta'),
        description: t('A palavra-passe deve ter pelo menos 6 caracteres.'),
        variant: 'destructive',
      });
      return;
    }

    setIsSubmitting(true);

    try {
      // Create user account with emailRedirectTo
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: invite.email,
        password,
        options: {
          data: {
            full_name: fullName.trim(),
          },
          emailRedirectTo: `${window.location.origin}/dashboard`,
        },
      });

      if (authError) throw authError;
      if (!authData.user) throw new Error(t('Não foi possível criar a conta.'));

      // Accept invite (this updates profile and adds role)
      const { data: accepted, error: acceptError } = await supabase.rpc('accept_invite', {
        _token: invite.token,
        _user_id: authData.user.id,
      });

      if (acceptError) throw acceptError;
      if (!accepted) throw new Error(t('Não foi possível aceitar o convite.'));

      setSuccess(true);
      toast({
        title: t('Conta criada com sucesso!'),
        description: t('A redirecionar para o dashboard...'),
      });

      // Trigger redirect via useEffect
      setShouldRedirect(true);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : t('Ocorreu um erro ao criar a conta.');
      toast({
        title: t('Erro'),
        description: errorMessage,
        variant: 'destructive',
      });
    }

    setIsSubmitting(false);
  };

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
            <CardTitle className="text-white">{t('Convite Inválido')}</CardTitle>
            <CardDescription>{t(error)}</CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <Button asChild>
              <Link to="/">{t('Ir para Login')}</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Show warning if user is already logged in
  if (currentSession === true) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-4">
        <Card className="max-w-md w-full bg-slate-900/50 border-slate-800">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 w-12 h-12 rounded-full bg-amber-500/10 flex items-center justify-center">
              <LogOut className="h-6 w-6 text-amber-500" />
            </div>
            <CardTitle className="text-white">{t('Já está autenticado')}</CardTitle>
            <CardDescription>
              {t('Para aceitar este convite e criar uma nova conta, precisa primeiro terminar a sessão atual.')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="p-4 rounded-lg bg-slate-800/50 border border-slate-700">
              <div className="flex items-center gap-2 text-sm">
                <Building className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium text-white">{invite?.organization_name}</span>
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                {t('Convite para: {{email}}', { email: invite?.email })}
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <Button 
                onClick={handleLogout} 
                disabled={loggingOut}
                className="w-full"
              >
                {loggingOut && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t('Terminar Sessão e Continuar')}
              </Button>
              <Button variant="outline" asChild className="w-full">
                <Link to="/dashboard">{t('Voltar ao Dashboard')}</Link>
              </Button>
            </div>
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
            <CardTitle className="text-white">{t('Conta Criada!')}</CardTitle>
            <CardDescription>
              {t('A sua conta foi criada e já está associada à organização.')}
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
            <p className="text-sm text-muted-foreground mt-2">{t('A redirecionar...')}</p>
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
            <UserPlus className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-white">{t('Criar Conta')}</CardTitle>
          <CardDescription>
            {t('Foi convidado para se juntar a uma organização.')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-6 p-4 rounded-lg bg-slate-800/50 border border-slate-700 space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <Building className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium text-white">{invite?.organization_name}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">{t('Perfil:')}</span>
              <Badge variant="secondary">
                {invite?.role ? t(ROLE_LABELS[invite.role] ?? invite.role) : invite?.role}
              </Badge>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-slate-200">Email</Label>
              <Input
                id="email"
                type="email"
                value={invite?.email || ''}
                disabled
                className="bg-slate-800/50 border-slate-700 text-slate-400"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="fullName" className="text-slate-200">{t('Nome Completo')}</Label>
              <Input
                id="fullName"
                type="text"
                placeholder={t('O seu nome')}
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="bg-slate-800/50 border-slate-700 text-white placeholder:text-slate-500"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" className="text-slate-200">{t('Palavra-passe')}</Label>
              <Input
                id="password"
                type="password"
                placeholder={t('Mínimo 6 caracteres')}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="bg-slate-800/50 border-slate-700 text-white placeholder:text-slate-500"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword" className="text-slate-200">{t('Confirmar Palavra-passe')}</Label>
              <Input
                id="confirmPassword"
                type="password"
                placeholder={t('Repita a palavra-passe')}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="bg-slate-800/50 border-slate-700 text-white placeholder:text-slate-500"
                required
              />
            </div>

            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('Criar Conta e Juntar-me')}
            </Button>
          </form>

          <p className="text-xs text-muted-foreground text-center mt-4">
            {t('Já tem conta?')}{' '}
            <Link to="/" className="text-primary hover:underline">
              {t('Faça login')}
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
