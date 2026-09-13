import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { detectLeadSource } from '@/lib/source-detection';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PhoneInput } from '@/components/ui/phone-input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Check, X } from 'lucide-react';
import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';
import { PENDING_ORG_STORAGE_KEY } from '@/components/auth/CompleteOrganizationSetup';
import senviaLogo from "@/assets/senvia-logo.png";
import { hardGo } from '@/lib/nav';

const loginSchema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(6, 'A palavra-passe deve ter pelo menos 6 caracteres'),
});

const signupSchema = z.object({
  fullName: z.string().min(2, 'O nome deve ter pelo menos 2 caracteres'),
  email: z.string().email('Email inválido'),
  password: z.string().min(6, 'A palavra-passe deve ter pelo menos 6 caracteres'),
  confirmPassword: z.string().min(6, 'A palavra-passe deve ter pelo menos 6 caracteres'),
  organizationName: z.string().min(2, 'O nome da empresa deve ter pelo menos 2 caracteres'),
  organizationSlug: z.string()
    .min(2, 'O código da empresa deve ter pelo menos 2 caracteres')
    .max(50, 'O código da empresa deve ter no máximo 50 caracteres')
    .regex(/^[a-z0-9-]+$/, 'O código só pode conter letras minúsculas, números e hífens'),
  contactPhone: z.string().min(9, 'O WhatsApp deve ter pelo menos 9 caracteres'),
}).refine((data) => data.password === data.confirmPassword, {
  message: 'As palavras-passe não coincidem',
  path: ['confirmPassword'],
});

// Helper to generate slug from company name
const generateSlug = (name: string): string => {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove accents
    .replace(/[^a-z0-9\s-]/g, '') // Remove special chars
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Remove duplicate hyphens
    .replace(/^-|-$/g, ''); // Remove leading/trailing hyphens
};

export default function Login() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { signIn, user, session, isLoading: authLoading } = useAuth();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  
  // Tab state - default to signup if query param is set
  const defaultTab = searchParams.get('tab') === 'signup' ? 'signup' : 'login';
  const [activeTab, setActiveTab] = useState(defaultTab);

  // Capture Meta tracking params from URL (fbclid → fbc for CAPI attribution)
  const fbclid = searchParams.get('fbclid');
  const fbc = fbclid ? `fb.1.${Date.now()}.${fbclid}` : (searchParams.get('fbc') || null);
  const fbp = searchParams.get('fbp') || null;
  const externalId = (() => {
    const key = 'senvia_external_id';
    const fromUrl = searchParams.get('external_id');
    const cookieMatch = document.cookie.match(new RegExp('(?:^|; )' + key + '=([^;]+)'));
    const fromCookie = cookieMatch ? decodeURIComponent(cookieMatch[1]) : '';
    const value = fromUrl || localStorage.getItem(key) || fromCookie || (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
    localStorage.setItem(key, value);
    document.cookie = `${key}=${encodeURIComponent(value)}; path=/; domain=.senvia.pt; max-age=31536000; SameSite=Lax; Secure`;
    return value;
  })();

  // De onde veio quem se está a registar. O bloco acima só serve o Pixel/CAPI e
  // só olha para os parâmetros do URL; isto lê tudo o resto (utm_*, gclid, o
  // referrer e os cookies _fbc/_fbp que provam um clique num anúncio mesmo
  // quando o fbclid já não está no endereço) — a mesma deteção dos formulários
  // públicos. Vai nos metadados do signUp para o notify-new-trials poder
  // carimbar a lead do trial com a origem real: até aqui, todos os trials
  // entravam no CRM como "Trial SENVIA OS", sem qualquer atribuição, e por
  // isso nunca contavam como tráfego pago por muito que se gastasse em
  // anúncios. Os dados existiam no browser e eram deitados fora.
  const signupDetection = useMemo(() => detectLeadSource(), []);

  // Login form state
  const [loginCompanyCode, setLoginCompanyCode] = useState('');
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  
  // Signup form state
  const [signupFullName, setSignupFullName] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [signupConfirmPassword, setSignupConfirmPassword] = useState('');
  const [organizationName, setOrganizationName] = useState('');
  const [organizationSlug, setOrganizationSlug] = useState('');
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [contactPhone, setContactPhone] = useState('');
  
  
  // Slug availability state
  const [isCheckingSlug, setIsCheckingSlug] = useState(false);
  const [isSlugAvailable, setIsSlugAvailable] = useState<boolean | null>(null);

  // Auto-generate slug when organization name changes
  useEffect(() => {
    if (!slugManuallyEdited && organizationName) {
      const generatedSlug = generateSlug(organizationName);
      setOrganizationSlug(generatedSlug);
    }
  }, [organizationName, slugManuallyEdited]);

  // Check slug availability with debounce
  useEffect(() => {
    if (organizationSlug.length < 2) {
      setIsSlugAvailable(null);
      return;
    }

    const timeoutId = setTimeout(async () => {
      setIsCheckingSlug(true);
      try {
        const { data, error } = await supabase.rpc('is_slug_available', { _slug: organizationSlug });
        if (!error) {
          setIsSlugAvailable(data);
        }
      } catch (e) {
        console.error('Error checking slug:', e);
      } finally {
        setIsCheckingSlug(false);
      }
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [organizationSlug]);

  // Redirect if already logged in - verificar user E session
  useEffect(() => {
    if (user && session && !authLoading) {
      navigate('/dashboard', { replace: true });
    }
  }, [user, session, authLoading, navigate]);

  // Show loading only during initial auth check
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const companyCode = loginCompanyCode.toLowerCase().trim();
    const email = loginEmail.toLowerCase().trim();
    
    const result = loginSchema.safeParse({ 
      email: loginEmail, 
      password: loginPassword,
      companyCode 
    });
    if (!result.success) {
      toast({
        title: 'Erro de validação',
        description: result.error.errors[0].message,
        variant: 'destructive',
      });
      return;
    }

    setIsLoading(true);

    try {
      // 1. Verify organization and membership BEFORE login (avoids RLS race condition)
      const { data: membershipCheck, error: checkError } = await supabase
        .rpc('verify_user_org_membership', { 
          p_email: email,
          p_org_slug: companyCode 
        });

      if (checkError) {
        console.error('Membership check error:', checkError);
        toast({
          title: 'Erro de verificação',
          description: 'Não foi possível verificar o acesso. Tente novamente.',
          variant: 'destructive',
        });
        setIsLoading(false);
        return;
      }

      const membership = membershipCheck?.[0];
      const codeRejected = !membership || !membership.is_member;

      // The company code did not resolve to an organization this account
      // belongs to. That is normally a wrong code — but it is also exactly what
      // an account whose organization was never created looks like (signup
      // interrupted at the email-confirmation step). Telling that second group
      // their own company code "does not exist" locked them out permanently
      // with no way back, so authenticate first and tell the two apart: an
      // account belonging to NO organization is let through to finish setup;
      // everyone else is signed out again and gets the error.
      if (codeRejected) {
        const { error: preAuthError } = await signIn(loginEmail, loginPassword);
        if (preAuthError) {
          toast({
            title: 'Dados inválidos',
            description: 'O código da empresa, o email ou a palavra-passe não estão corretos.',
            variant: 'destructive',
          });
          setIsLoading(false);
          return;
        }

        const { data: authUser } = await supabase.auth.getUser();
        const { data: memberships } = await supabase
          .from('organization_members')
          .select('organization_id')
          .eq('user_id', authUser.user?.id ?? '')
          .eq('is_active', true)
          .limit(1);

        if (!memberships || memberships.length === 0) {
          localStorage.removeItem('senvia_active_organization_id');
          hardGo('/dashboard');
          return;
        }

        await supabase.auth.signOut();
        toast({
          title: membership ? 'Acesso negado' : 'Dados inválidos',
          description: membership
            ? 'Não tem acesso a esta empresa. Verifique o código ou contacte o administrador.'
            : 'O código da empresa ou email não existe.',
          variant: 'destructive',
        });
        setIsLoading(false);
        return;
      }

      // 2. Now we can safely authenticate - membership is confirmed
      const { error: authError } = await signIn(loginEmail, loginPassword);

      if (authError) {
        toast({
          title: 'Erro ao iniciar sessão',
          description: authError.message === 'Invalid login credentials' 
            ? 'Email ou palavra-passe incorretos' 
            : authError.message,
          variant: 'destructive',
        });
        setIsLoading(false);
        return;
      }

      // 3. Set active organization and redirect
      localStorage.setItem('senvia_active_organization_id', membership.organization_id);

      toast({
        title: 'Bem-vindo!',
        description: `Sessão iniciada em ${membership.organization_name}`,
      });
      
      // Force reload to ensure AuthContext picks up the active org
      hardGo('/dashboard');
      
    } catch (error: any) {
      console.error('Login error:', error);
      toast({
        title: 'Erro',
        description: error.message || 'Ocorreu um erro inesperado.',
        variant: 'destructive',
      });
      setIsLoading(false);
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const result = signupSchema.safeParse({ 
      fullName: signupFullName, 
      email: signupEmail, 
      password: signupPassword,
      confirmPassword: signupConfirmPassword,
      organizationName,
      organizationSlug,
      contactPhone,
    });
    
    if (!result.success) {
      toast({
        title: 'Erro de validação',
        description: result.error.errors[0].message,
        variant: 'destructive',
      });
      return;
    }

    if (isSlugAvailable === false) {
      toast({
        title: 'Código indisponível',
        description: 'Este código já está em uso. Por favor, escolha outro.',
        variant: 'destructive',
      });
      return;
    }

    // Um registo repetido do mesmo número dentro de 24h é quase sempre a mesma
    // pessoa a tentar outra vez — tipicamente por ter errado o email na
    // primeira. Sem este aviso ficam duas contas e duas empresas, e a primeira
    // nunca mais é usada. O trigger handle_new_user recusa na mesma; isto existe
    // para dar uma mensagem clara, porque o GoTrue devolve "Database error
    // saving new user" quando um trigger falha.
    try {
      const { data: repetido } = await supabase.rpc('recent_signup_exists' as never, {
        _phone: contactPhone,
      } as never);
      if (repetido === true) {
        toast({
          title: 'Já existe um registo com este número',
          description:
            'Foi criada uma conta com este WhatsApp nas últimas 24 horas. Entra com essa conta ou usa "Esqueci-me da palavra-passe". Se precisares de ajuda, fala connosco.',
          variant: 'destructive',
        });
        return;
      }
    } catch {
      // Verificação indisponível — deixa seguir; o trigger continua a proteger.
    }

    setIsLoading(true);

    try {
      // 1. Create the user account
      const redirectUrl = `${window.location.origin}/`;
      // The company details travel WITH the account: handle_new_user creates the
      // organization in the same transaction as the auth user, so an account can
      // never exist without its company — including when email confirmation is
      // required and no session comes back here.
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: signupEmail,
        password: signupPassword,
        options: {
          emailRedirectTo: redirectUrl,
          data: {
            referral_code: searchParams.get('ref') || undefined,
            full_name: signupFullName,
            organization_name: organizationName,
            organization_slug: organizationSlug,
            contact_phone: contactPhone,
            // Lido pelo notify-new-trials ao criar a lead do trial. Vive no
            // raw_user_meta_data (JSONB livre), por isso não precisa de
            // alteração de schema, e sobrevive à confirmação de email — fica
            // preso ao utilizador, não a este separador do browser.
            signup_source: signupDetection.source,
            signup_tracking: signupDetection.tracking,
          },
        },
      });

      if (authError) throw authError;
      if (!authData.user) throw new Error('Não foi possível criar o utilizador');

      // O Supabase NÃO devolve erro quando o email já tem conta. Para não
      // revelar quem está registado na plataforma, responde sucesso com um
      // utilizador falso, não cria nada e não envia email nenhum. Como vem
      // sempre sem sessão, sem esta verificação seguíamos para o ramo do
      // "confirma o teu email" e mostrávamos "Conta criada com sucesso!" por
      // uma conta que não existe — a pessoa fica à espera de um email que nunca
      // chega. O sinal documentado deste caso é o identities vir vazio.
      if (authData.user.identities?.length === 0) {
        throw new Error('already registered');
      }

      // Check if email confirmation is required (no session means confirmation needed)
      if (!authData.session) {
        // No session means we cannot call create_organization_for_current_user
        // yet, and this handler is about to return — so stash what the user
        // typed. CompleteOrganizationSetup picks it up the moment they come
        // back with a session and finishes the registration for them. Without
        // this the company name and code were lost with the page, leaving an
        // account that could never log in.
        try {
          localStorage.setItem(
            PENDING_ORG_STORAGE_KEY,
            JSON.stringify({ name: organizationName, slug: organizationSlug, contactPhone })
          );
        } catch { /* private mode / storage full — the setup screen will ask again */ }

        // Fire Meta Pixel Lead event (client-side) with eventID for deduplication
        const capiEventId = `signup-${authData.user.id}`;
        if (typeof window.fbq === 'function') {
          window.fbq('init', '2027821837745963', { external_id: externalId });
          window.fbq('trackSingle', '2027821837745963', 'Lead', {
            content_name: 'Senvia OS Registration',
            content_category: 'signup',
          }, { eventID: capiEventId });
        }
        // Fire Meta CAPI Lead event (server-side, non-blocking)
        try {
          const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
          fetch(`https://${projectId}.supabase.co/functions/v1/meta-capi-event`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}` },
            body: JSON.stringify({
              pixel_id: '2027821837745963',
              event_name: 'Lead',
              event_id: `signup-${authData.user.id}`,
              event_source_url: window.location.href,
              user_data: { em: signupEmail, fbc: fbc || undefined, fbp: fbp || undefined, external_id: externalId, client_user_agent: navigator.userAgent },
              custom_data: { content_name: 'Senvia OS Registration', content_category: 'signup' },
            }),
          }).catch(() => {});
        } catch {}

        toast({
          title: 'Confirme o seu email',
          description: 'Enviámos um email de confirmação. Confirme o seu email e depois faça login.',
        });

        setActiveTab('login');
        setLoginEmail(signupEmail);
        setIsLoading(false);
        return;
      }

      // 2. The organization was already created by handle_new_user, atomically
      // with the account. This call is only a fallback for accounts created
      // before that trigger existed — "already belongs" means the trigger did
      // its job and is the expected outcome, not an error.
      const { error: orgError } = await supabase.rpc('create_organization_for_current_user', {
        _name: organizationName,
        _slug: organizationSlug,
        _contact_phone: contactPhone,
      } as any);

      if (orgError && !orgError.message.includes('already belongs to an organization')) {
        if (orgError.message.includes('Slug already exists')) {
          toast({
            title: 'Código indisponível',
            description: 'Este código de empresa já está em uso. Por favor, escolha outro.',
            variant: 'destructive',
          });
          setIsLoading(false);
          return;
        }
        throw orgError;
      }

      // Fire Meta Pixel Lead event (client-side) with eventID for deduplication
      const capiEventId2 = `signup-${authData.user!.id}`;
      if (typeof window.fbq === 'function') {
        window.fbq('init', '2027821837745963', { external_id: externalId });
        window.fbq('trackSingle', '2027821837745963', 'Lead', {
          content_name: 'Senvia OS Registration',
          content_category: 'signup',
        }, { eventID: capiEventId2 });
      }
      // Fire Meta CAPI Lead event (server-side, non-blocking)
      try {
        const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
        fetch(`https://${projectId}.supabase.co/functions/v1/meta-capi-event`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}` },
          body: JSON.stringify({
              pixel_id: '2027821837745963',
              event_name: 'Lead',
              event_id: `signup-${authData.user!.id}`,
              event_source_url: window.location.href,
              user_data: { em: signupEmail, fbc: fbc || undefined, fbp: fbp || undefined, external_id: externalId, client_user_agent: navigator.userAgent },
              custom_data: { content_name: 'Senvia OS Registration', content_category: 'signup' },
          }),
        }).catch(() => {});
      } catch {}

      toast({
        title: 'Conta criada com sucesso!',
        description: 'Bem-vindo ao SENVIA. A redirecionar para o dashboard...',
      });

      // Force page reload to ensure AuthContext picks up all data
      hardGo('/dashboard');
      
    } catch (error: any) {
      let message = error.message;
      if (error.message.includes('already registered')) {
        message =
          'Este email já tem conta. Entre com ela, ou use "Esqueci-me da password" para recuperar o acesso.';
      } else if (
        // The signup transaction now also creates the organization, so a slug
        // taken between the availability check and submit aborts the whole
        // signUp. Supabase reports that as a generic database error.
        error.message.includes('Recent signup exists for this phone')
      ) {
        message =
          'Já foi criada uma conta com este WhatsApp nas últimas 24 horas. Entra com essa conta em vez de criar outra.';
      } else if (
        // The signup transaction now also creates the organization, so a slug
        // taken between the availability check and submit aborts the whole
        // signUp. Supabase reports that as a generic database error.
        error.message.includes('Database error saving new user') ||
        error.message.includes('Slug already exists')
      ) {
        message = 'Este código de empresa já está em uso. Escolha outro e tente novamente.';
      }
      toast({
        title: 'Erro ao criar conta',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSlugChange = (value: string) => {
    setSlugManuallyEdited(true);
    // Sanitize slug input in real-time
    const sanitized = value.toLowerCase().replace(/[^a-z0-9-]/g, '');
    setOrganizationSlug(sanitized);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <img src={senviaLogo} alt="SENVIA" className="h-12 w-48 object-contain mx-auto" width={192} height={48} fetchPriority="high" loading="eager" decoding="async" />
        </div>

        <Card className="border-slate-800 bg-slate-900/50 backdrop-blur">
          <CardHeader className="text-center">
            <CardTitle className="text-white">
              {activeTab === 'signup' ? 'Comece o seu teste grátis' : 'Aceder à Plataforma'}
            </CardTitle>
            <CardDescription className="text-slate-400">
              {activeTab === 'signup' ? (
                <span className="inline-flex items-center gap-1.5 bg-primary/10 text-primary border border-primary/20 rounded-full px-3 py-1 text-xs font-medium mt-1">
                  ✨ 14 dias grátis · Sem cartão de crédito
                </span>
              ) : (
                'Entre na sua conta ou crie uma nova'
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <TabsList className="grid w-full grid-cols-2 bg-slate-800">
                <TabsTrigger value="login" className="data-[state=active]:bg-primary data-[state=active]:text-white">
                  Entrar
                </TabsTrigger>
                <TabsTrigger value="signup" className="data-[state=active]:bg-primary data-[state=active]:text-white">
                  Registar
                </TabsTrigger>
              </TabsList>
              
              {/* Login Tab */}
              <TabsContent value="login">
                <form onSubmit={handleLogin} className="space-y-4 mt-4">
                  <div className="space-y-2">
                    <Label htmlFor="login-company-code" className="text-slate-300">Código da Empresa</Label>
                    <Input
                      id="login-company-code"
                      type="text"
                      placeholder="minha-empresa"
                      value={loginCompanyCode}
                      onChange={(e) => setLoginCompanyCode(e.target.value.toLowerCase())}
                      className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 font-mono"
                      required
                    />
                    <p className="text-xs text-slate-500">
                      Código fornecido pelo administrador da empresa
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="login-email" className="text-slate-300">Email</Label>
                    <Input
                      id="login-email"
                      type="email"
                      placeholder="seu@email.com"
                      value={loginEmail}
                      onChange={(e) => setLoginEmail(e.target.value)}
                      className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="login-password" className="text-slate-300">Palavra-passe</Label>
                    <Input
                      id="login-password"
                      type="password"
                      placeholder="••••••••"
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
                      required
                    />
                  </div>
                  <div className="text-right">
                    <button
                      type="button"
                      onClick={() => {
                        if (!loginEmail) {
                          toast({
                            title: 'Email necessário',
                            description: 'Insira o seu email para recuperar a palavra-passe.',
                            variant: 'destructive',
                          });
                          return;
                        }
                        supabase.auth.resetPasswordForEmail(loginEmail, {
                          redirectTo: `${window.location.origin}/reset-password`,
                        }).then(({ error }) => {
                          if (error) {
                            toast({
                              title: 'Erro',
                              description: error.message,
                              variant: 'destructive',
                            });
                          } else {
                            toast({
                              title: 'Email enviado',
                              description: 'Verifique o seu email para redefinir a palavra-passe.',
                            });
                          }
                        });
                      }}
                      className="text-sm text-primary hover:underline"
                    >
                      Esqueceu a palavra-passe?
                    </button>
                  </div>
                  <Button
                    type="submit" 
                    className="w-full bg-primary hover:bg-primary/90"
                    disabled={isLoading}
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        A entrar...
                      </>
                    ) : (
                      'Entrar'
                    )}
                  </Button>
                </form>
              </TabsContent>

              {/* Signup Tab */}
              <TabsContent value="signup">
                <form onSubmit={handleSignup} className="space-y-4 mt-4">
                  <div className="space-y-2">
                    <Label htmlFor="signup-name" className="text-slate-300">Nome Completo</Label>
                    <Input
                      id="signup-name"
                      type="text"
                      placeholder="João Silva"
                      value={signupFullName}
                      onChange={(e) => setSignupFullName(e.target.value)}
                      className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-email" className="text-slate-300">Email</Label>
                    <Input
                      id="signup-email"
                      type="email"
                      placeholder="seu@email.com"
                      value={signupEmail}
                      onChange={(e) => setSignupEmail(e.target.value)}
                      className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-password" className="text-slate-300">Palavra-passe</Label>
                    <Input
                      id="signup-password"
                      type="password"
                      placeholder="••••••••"
                      value={signupPassword}
                      onChange={(e) => setSignupPassword(e.target.value)}
                      className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-confirm-password" className="text-slate-300">Confirmar Palavra-passe</Label>
                    <Input
                      id="signup-confirm-password"
                      type="password"
                      placeholder="••••••••"
                      value={signupConfirmPassword}
                      onChange={(e) => setSignupConfirmPassword(e.target.value)}
                      className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
                      required
                    />
                  </div>
                  
                  <div className="border-t border-slate-700 pt-4 mt-4">
                    <p className="text-sm text-slate-400 mb-3">Dados da sua empresa</p>
                    
                    <div className="space-y-2">
                      <Label htmlFor="org-name" className="text-slate-300">Nome da Empresa</Label>
                      <Input
                        id="org-name"
                        type="text"
                        placeholder="Minha Empresa Lda"
                        value={organizationName}
                        onChange={(e) => setOrganizationName(e.target.value)}
                        className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
                        required
                      />
                    </div>
                    
                    <div className="space-y-2 mt-3">
                      <Label htmlFor="org-slug" className="text-slate-300">
                        Código da Empresa
                      </Label>
                      <div className="relative">
                        <Input
                          id="org-slug"
                          type="text"
                          placeholder="minha-empresa"
                          value={organizationSlug}
                          onChange={(e) => handleSlugChange(e.target.value)}
                          className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 pr-10"
                          required
                        />
                        <div className="absolute right-3 top-1/2 -translate-y-1/2">
                          {isCheckingSlug && (
                            <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                          )}
                          {!isCheckingSlug && isSlugAvailable === true && (
                            <Check className="h-4 w-4 text-green-500" />
                          )}
                          {!isCheckingSlug && isSlugAvailable === false && (
                            <X className="h-4 w-4 text-red-500" />
                          )}
                        </div>
                      </div>
                      <p className="text-xs text-slate-500">
                        senvia.app/<span className="text-primary">{organizationSlug || 'a-tua-empresa'}</span>
                      </p>
                      {isSlugAvailable === false && (
                        <p className="text-xs text-red-400">Este código já está em uso</p>
                      )}
                    </div>

                    <div className="space-y-2 mt-3">
                      <Label className="text-slate-300">WhatsApp da Empresa *</Label>
                      <PhoneInput
                        value={contactPhone}
                        onChange={setContactPhone}
                        placeholder="912 345 678"
                        className="[&_button]:h-12 [&_button]:bg-slate-800 [&_button]:border-slate-700 [&_button]:text-white [&_button]:hover:bg-slate-700 [&_input]:h-12 [&_input]:bg-slate-800 [&_input]:border-slate-700 [&_input]:text-white [&_input]:placeholder:text-slate-500"
                      />
                      <p className="text-xs text-slate-500">
                        Escolhe o país e introduz o número. Usado para contacto e mensagens de WhatsApp.
                      </p>
                    </div>
                    
                  </div>

                  <Button
                    type="submit" 
                    className="w-full bg-primary hover:bg-primary/90"
                    disabled={isLoading || isSlugAvailable === false}
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        A criar conta...
                      </>
                    ) : (
                      'Criar Conta'
                    )}
                  </Button>
                </form>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

      </div>
    </div>
  );
}
