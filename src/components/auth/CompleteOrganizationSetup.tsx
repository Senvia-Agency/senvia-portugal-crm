import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, Building2 } from 'lucide-react';
import { hardGo } from '@/lib/nav';
import { useLanguage } from '@/i18n';

/**
 * Shown to an authenticated user who belongs to no organization.
 *
 * That state is reachable whenever signup creates the account but not the
 * organization — most commonly because Supabase requires email confirmation, so
 * `signUp` returns no session and the signup handler stops before the
 * create-organization step. Previously those users got an empty CRM shell and,
 * on the next login, were told their own company code did not exist.
 *
 * If the signup form managed to stash what the user typed (see
 * PENDING_ORG_STORAGE_KEY in Login.tsx) this finishes the job silently on the
 * first render, so from the user's side the registration simply completes.
 * Otherwise it asks for the details again.
 */

export const PENDING_ORG_STORAGE_KEY = 'senvia_pending_organization';

interface PendingOrg {
  name?: string;
  slug?: string;
  contactPhone?: string;
}

function readPendingOrg(): PendingOrg | null {
  try {
    const raw = localStorage.getItem(PENDING_ORG_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingOrg;
    return parsed?.name && parsed?.slug ? parsed : null;
  } catch {
    return null;
  }
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

export function CompleteOrganizationSetup() {
  const { toast } = useToast();
  const { t } = useLanguage();
  const pending = useRef<PendingOrg | null>(readPendingOrg());

  const [name, setName] = useState(pending.current?.name ?? '');
  const [slug, setSlug] = useState(pending.current?.slug ?? '');
  const [contactPhone, setContactPhone] = useState(pending.current?.contactPhone ?? '');
  const [slugEdited, setSlugEdited] = useState(!!pending.current?.slug);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Starts true when there is stashed data, so the form never flashes before
  // the automatic attempt resolves.
  const [isResuming, setIsResuming] = useState(!!pending.current);

  const createOrganization = useCallback(
    async (orgName: string, orgSlug: string, phone: string): Promise<string | null> => {
      const { error } = await supabase.rpc('create_organization_for_current_user', {
        _name: orgName,
        _slug: orgSlug,
        _contact_phone: phone,
      } as never);

      if (error) return error.message;

      localStorage.removeItem(PENDING_ORG_STORAGE_KEY);
      // Full reload so AuthContext re-reads memberships from scratch.
      hardGo('/dashboard');
      return null;
    },
    []
  );

  // Resume an interrupted signup without bothering the user.
  useEffect(() => {
    const stashed = pending.current;
    if (!stashed?.name || !stashed?.slug) return;

    let cancelled = false;
    (async () => {
      const failure = await createOrganization(stashed.name!, stashed.slug!, stashed.contactPhone ?? '');
      if (cancelled) return;
      if (failure) {
        // The stashed slug is most likely taken by now. Fall back to the form
        // with the values pre-filled instead of failing in front of the user.
        localStorage.removeItem(PENDING_ORG_STORAGE_KEY);
        setIsResuming(false);
      }
    })();

    return () => { cancelled = true; };
  }, [createOrganization]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    const finalSlug = (slugEdited ? slug : slugify(trimmedName)).trim();

    if (trimmedName.length < 2) {
      toast({ title: t('Nome inválido'), description: t('Indique o nome da sua empresa.'), variant: 'destructive' });
      return;
    }
    if (finalSlug.length < 3) {
      toast({ title: t('Código inválido'), description: t('O código da empresa deve ter pelo menos 3 caracteres.'), variant: 'destructive' });
      return;
    }

    setIsSubmitting(true);
    const failure = await createOrganization(trimmedName, finalSlug, contactPhone.trim());
    if (failure) {
      toast({
        title: t('Não foi possível concluir'),
        description: failure.includes('Slug already exists') || failure.includes('already exists')
          ? t('Este código de empresa já está em uso. Escolha outro.')
          : failure,
        variant: 'destructive',
      });
      setIsSubmitting(false);
    }
  };

  if (isResuming) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">{t("A concluir o seu registo…")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-3">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Building2 className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-center">{t("Falta só um passo")}</CardTitle>
          <CardDescription className="text-center">
            {t("Crie a sua empresa para começar a usar o SENVIA.")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="org-name">{t("Nome da empresa")}</Label>
              <Input
                id="org-name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (!slugEdited) setSlug(slugify(e.target.value));
                }}
                placeholder={t("A minha empresa, Lda.")}
                autoFocus
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="org-slug">{t("Código da empresa")}</Label>
              <Input
                id="org-slug"
                value={slugEdited ? slug : slugify(name)}
                onChange={(e) => {
                  setSlugEdited(true);
                  setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''));
                }}
                placeholder={t("a-minha-empresa")}
                required
              />
              <p className="text-xs text-muted-foreground">
                {t("É este o código que usará para entrar. Guarde-o.")}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="org-phone">{t("Telefone de contacto (opcional)")}</Label>
              <Input
                id="org-phone"
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                placeholder="912 345 678"
              />
            </div>

            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {t("Criar empresa")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
