import { LogOut, Settings, UserRound } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuCheckboxItem } from '@/components/ui/dropdown-menu';
import { useInterfaceStore } from '@/stores/useInterfaceStore';

export function WorkplaceAccountMenu({ userName, organizationName }: { readonly userName?: string; readonly organizationName?: string }) {
  const { profile, signOut } = useAuth();
  const legacy = useInterfaceStore(state => state.legacy);
  const setLegacy = useInterfaceStore(state => state.setLegacy);
  const navigate = useNavigate();
  const name = profile?.full_name || userName || 'Utilizador';
  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <button type="button" className="workplace-account-trigger" aria-label={`Abrir menu de ${name}`}>
        <Avatar className="h-9 w-9"><AvatarImage src={profile?.avatar_url ?? undefined} alt="" /><AvatarFallback className="bg-blue-100 text-xs font-semibold text-blue-800">{name.trim().charAt(0).toUpperCase()}</AvatarFallback></Avatar>
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="w-64">
      <DropdownMenuLabel><span className="block truncate">{name}</span><span className="block truncate text-xs font-normal text-muted-foreground">{organizationName || 'Organização'}</span></DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => navigate('/settings?og=account&os=account-profile')}><UserRound className="mr-2 h-4 w-4" />O meu perfil</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => navigate('/settings')}><Settings className="mr-2 h-4 w-4" />Definições</DropdownMenuItem>
      <DropdownMenuCheckboxItem checked={legacy} onCheckedChange={setLegacy}>Versão antiga</DropdownMenuCheckboxItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => { void signOut().then(() => navigate('/')); }}><LogOut className="mr-2 h-4 w-4" />Terminar sessão</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>;
}
