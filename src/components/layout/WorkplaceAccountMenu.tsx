import { Building2, Check, Compass, Languages, LogOut, Settings, Sparkles, UserRound } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuCheckboxItem,
  DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';
import { useSubscription } from '@/hooks/useSubscription';
import { useUserOrganizations } from '@/hooks/useUserOrganizations';
import { useInterfaceStore } from '@/stores/useInterfaceStore';
import { LANGUAGES, useLanguage } from '@/i18n';
import { useIsMobile } from '@/hooks/use-mobile';
import { startSenvia2Guide } from '@/components/otto/Senvia2Guide';

export function WorkplaceAccountMenu({ userName, organizationName }: { readonly userName?: string; readonly organizationName?: string }) {
  const { user, profile, signOut, organization, switchOrganization } = useAuth();
  const { data: organizations = [] } = useUserOrganizations();
  const { canUseFeature } = useSubscription();
  const legacy = useInterfaceStore(state => state.legacy);
  const setLegacy = useInterfaceStore(state => state.setLegacy);
  const navigate = useNavigate();
  const { t, language, setLanguage } = useLanguage();
  const isMobile = useIsMobile();
  const name = profile?.full_name || userName || t('Utilizador');
  // Only people in more than one company get to switch, as the sidebar switcher did.
  const canSwitch = canUseFeature('multi_org') && organizations.length > 1;
  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <button type="button" data-otto-target="guide-account" className="workplace-account-trigger" aria-label={t('Abrir menu de {{name}}', { name })}>
        <Avatar className="h-9 w-9"><AvatarImage src={profile?.avatar_url ?? undefined} alt="" /><AvatarFallback className="bg-blue-100 text-xs font-semibold text-blue-800">{name.trim().charAt(0).toUpperCase()}</AvatarFallback></Avatar>
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="w-64">
      <DropdownMenuLabel><span className="block truncate">{name}</span><span className="block truncate text-xs font-normal text-muted-foreground">{organizationName || t('Organização')}</span></DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => navigate('/settings?og=account&os=account-profile')}><UserRound className="mr-2 h-4 w-4" />{t('O meu perfil')}</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => navigate('/settings')}><Settings className="mr-2 h-4 w-4" />{t('Definições')}</DropdownMenuItem>
      {!legacy && <DropdownMenuItem onSelect={() => startSenvia2Guide(user?.id, isMobile)}><Compass className="mr-2 h-4 w-4" />{t('Guia do Senvia 2.0')}</DropdownMenuItem>}
      {!legacy && <DropdownMenuItem onSelect={() => navigate('/novidades')}><Sparkles className="mr-2 h-4 w-4" />{t('Novidades')}</DropdownMenuItem>}
      {canSwitch && (
        <DropdownMenuSub>
          <DropdownMenuSubTrigger><Building2 className="mr-2 h-4 w-4" />{t('Mudar de empresa')}</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-60">
            {organizations.map((org) => (
              <DropdownMenuItem key={org.organization_id} className="flex items-center justify-between gap-2"
                onSelect={() => { if (org.organization_id !== organization?.id) void switchOrganization(org.organization_id); }}>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate font-medium">{org.organization_name}</span>
                  {org.organization_code && <span className="text-xs text-muted-foreground">{org.organization_code}</span>}
                </span>
                {organization?.id === org.organization_id && <Check className="h-4 w-4 shrink-0 text-primary" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      )}
      <DropdownMenuSub>
        <DropdownMenuSubTrigger><Languages className="mr-2 h-4 w-4" />{t('Idioma')}<span className="ml-auto pl-2 text-xs text-muted-foreground">{LANGUAGES.find(l => l.code === language)?.short}</span></DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="w-56">
          {LANGUAGES.map(l => (
            <DropdownMenuItem key={l.code} className="flex items-center justify-between gap-2" onSelect={() => setLanguage(l.code)}>
              {l.label}{language === l.code && <Check className="h-4 w-4 shrink-0 text-primary" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuCheckboxItem checked={legacy} onCheckedChange={setLegacy}>{t('Versão antiga')}</DropdownMenuCheckboxItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => { void signOut().then(() => navigate('/')); }}><LogOut className="mr-2 h-4 w-4" />{t('Terminar sessão')}</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>;
}
