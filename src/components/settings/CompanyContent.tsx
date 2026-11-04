import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import { Building, User, Loader2, Save, Copy, Check } from "lucide-react";
import { PLAN_LABELS, OrganizationPlan } from "@/types";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import { BillingDetailsCard } from "./BillingDetailsCard";
import { useLanguage } from "@/i18n";

// Organization identity + GDPR (extracted from the former GeneralContent). Lives
// under "A Minha Conta" › Dados da Empresa — institutional data, edited by admins.
// Kept as its own tab (separate from the personal Perfil tab).
interface CompanyContentProps {
  organization: {
    id: string;
    name: string;
    plan: string | null;
    slug?: string;
    trial_ends_at?: string;
    billing_exempt?: boolean;
  } | null;
  isAdmin: boolean;
  orgName: string;
  setOrgName: (value: string) => void;
  handleSaveOrgName: () => void;
  updateOrganizationIsPending: boolean;
}

export const CompanyContent = ({
  organization,
  isAdmin,
  orgName,
  setOrgName,
  handleSaveOrgName,
  updateOrganizationIsPending,
}: CompanyContentProps) => {
  const { toast } = useToast();
  const { t } = useLanguage();
  const [copiedSlug, setCopiedSlug] = useState(false);

  const isOnTrial = (() => {
    if (!organization) return false;
    if (organization.billing_exempt) return false;
    if (!organization.trial_ends_at) return false;
    return new Date(organization.trial_ends_at).getTime() > Date.now();
  })();

  const handleCopySlug = async () => {
    if (!organization?.slug) return;
    try {
      await navigator.clipboard.writeText(organization.slug);
      setCopiedSlug(true);
      toast({ title: t('Copiado!'), description: t('Código da empresa copiado para a área de transferência.') });
      setTimeout(() => setCopiedSlug(false), 2000);
    } catch (err) {
      toast({ title: t('Erro'), description: t('Não foi possível copiar.'), variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Building className="h-5 w-5" />{t('Organização')}</CardTitle>
          <CardDescription>{t('Informações da sua organização.')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="org-name">{t('Nome')}</Label>
              {isAdmin ? (
                <div className="flex gap-2">
                  <Input
                    id="org-name"
                    data-otto-target="settings-company-name"
                    value={orgName}
                    onChange={(e) => setOrgName(e.target.value)}
                    placeholder={t('Nome da organização')}
                  />
                  <Button
                    size="icon"
                    onClick={handleSaveOrgName}
                    disabled={updateOrganizationIsPending || orgName === organization?.name}
                  >
                    {updateOrganizationIsPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  </Button>
                </div>
              ) : (
                <p className="text-foreground font-medium">{organization?.name || '-'}</p>
              )}
            </div>
            <div>
              <Label>{t('Plano')}</Label>
              <div className="flex items-center gap-2 mt-2">
                <Badge variant={isOnTrial ? 'outline' : (organization?.plan === 'elite' || organization?.plan === 'pro' ? 'default' : 'secondary')}>
                  {isOnTrial ? t('Trial') : (organization?.plan ? PLAN_LABELS[organization.plan as OrganizationPlan] : 'Starter')}
                </Badge>
              </div>
            </div>
          </div>

          <Separator />

          <div className="space-y-2">
            <Label htmlFor="org-slug">{t('Código da Empresa')}</Label>
            <div className="flex gap-2">
              <Input
                id="org-slug"
                value={organization?.slug || ''}
                readOnly
                className="bg-muted font-mono"
              />
              <Button
                variant="outline"
                size="icon"
                onClick={handleCopySlug}
                disabled={!organization?.slug}
              >
                {copiedSlug ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {t('Partilhe este código para convidar colaboradores para a sua empresa.')}
            </p>
          </div>
        </CardContent>
      </Card>

      {isAdmin && <BillingDetailsCard />}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><User className="h-5 w-5" />{t('RGPD')}</CardTitle>
          <CardDescription>{t('Informações sobre proteção de dados.')}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {t('Todos os leads registados nesta plataforma consentiram explicitamente o tratamento dos seus dados pessoais para fins comerciais, conforme exigido pelo RGPD. Os dados são armazenados de forma segura e podem ser eliminados a pedido do titular.')}
          </p>
        </CardContent>
      </Card>
    </div>
  );
};
