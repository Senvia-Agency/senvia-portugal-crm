import { useState } from 'react';
import { Building2, ArrowRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { UserOrganization } from '@/hooks/useUserOrganizations';
import { useLanguage } from '@/i18n';

interface OrganizationSelectorProps {
  organizations: UserOrganization[];
  onSelect: (orgId: string) => void;
  isLoading?: boolean;
}

export function OrganizationSelector({ 
  organizations, 
  onSelect, 
  isLoading 
}: OrganizationSelectorProps) {
  const { t } = useLanguage();
  const [searchCode, setSearchCode] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const filteredOrgs = searchCode 
    ? organizations.filter(org => 
        org.organization_code.toLowerCase().includes(searchCode.toLowerCase()) ||
        org.organization_name.toLowerCase().includes(searchCode.toLowerCase())
      )
    : organizations;

  const handleSelect = (orgId: string) => {
    setSelectedId(orgId);
    onSelect(orgId);
  };

  return (
    <div className="min-h-dvh flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Building2 className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-xl">{t("Selecionar Empresa")}</CardTitle>
          <CardDescription>
            {t("A sua conta tem acesso a múltiplas empresas. Escolha qual pretende aceder.")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {organizations.length > 3 && (
            <div className="space-y-2">
              <Label htmlFor="search">{t("Pesquisar por código ou nome")}</Label>
              <Input
                id="search"
                placeholder={t("ORG-0001 ou nome...")}
                value={searchCode}
                onChange={(e) => setSearchCode(e.target.value)}
              />
            </div>
          )}
          
          <div className="space-y-2 max-h-[300px] overflow-y-auto">
            {filteredOrgs.map((org) => (
              <button
                key={org.organization_id}
                onClick={() => handleSelect(org.organization_id)}
                disabled={isLoading}
                className="w-full flex items-center justify-between p-4 rounded-lg border bg-card hover:bg-accent/50 transition-colors disabled:opacity-50"
              >
                <div className="flex flex-col items-start gap-0.5">
                  <span className="font-medium">{org.organization_name}</span>
                  <span className="text-xs text-muted-foreground">{org.organization_code}</span>
                </div>
                {isLoading && selectedId === org.organization_id ? (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                ) : (
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                )}
              </button>
            ))}
            
            {filteredOrgs.length === 0 && (
              <p className="text-center text-sm text-muted-foreground py-4">
                {t("Nenhuma empresa encontrada")}
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
