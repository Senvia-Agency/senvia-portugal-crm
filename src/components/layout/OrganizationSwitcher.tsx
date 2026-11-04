import { useState } from 'react';
import { Building2, Check, ChevronsUpDown, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/contexts/AuthContext';
import { useUserOrganizations } from '@/hooks/useUserOrganizations';
import { useSubscription } from '@/hooks/useSubscription';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/i18n';

export function OrganizationSwitcher() {
  const { organization, switchOrganization, signOut } = useAuth();
  const { data: organizations = [], isLoading } = useUserOrganizations();
  const { canUseFeature } = useSubscription();
  const [open, setOpen] = useState(false);
  const { t } = useLanguage();

  // If multi_org is disabled OR only 1 org, show name only (no dropdown)
  if ((!canUseFeature('multi_org') || organizations.length <= 1) && !isLoading) {
    return (
      <div className="flex items-center gap-2 px-2 py-1.5">
        <Building2 className="h-4 w-4 shrink-0 text-sidebar-foreground" />
        <span className="truncate text-sm font-medium text-sidebar-foreground">
          {organization?.name || t('A Minha Empresa')}
        </span>
      </div>
    );
  }

  const handleSwitch = async (orgId: string) => {
    if (orgId !== organization?.id) {
      await switchOrganization(orgId);
    }
    setOpen(false);
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-between gap-2 px-2"
        >
          <div className="flex items-center gap-2 truncate">
            <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate text-sm font-medium text-sidebar-foreground">
              {organization?.name || t('Selecionar empresa')}
            </span>
          </div>
          <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[240px]">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          {t("Mudar de empresa")}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {organizations.map((org) => (
          <DropdownMenuItem
            key={org.organization_id}
            onClick={() => handleSwitch(org.organization_id)}
            className="flex items-center justify-between gap-2"
          >
            <div className="flex flex-col gap-0.5 truncate">
              <span className="truncate font-medium">{org.organization_name}</span>
              <span className="text-xs text-muted-foreground">{org.organization_code}</span>
            </div>
            {organization?.id === org.organization_id && (
              <Check className="h-4 w-4 shrink-0 text-primary" />
            )}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => signOut()}
          className="text-destructive focus:text-destructive"
        >
          <LogOut className="mr-2 h-4 w-4" />
          {t("Terminar sessão")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
