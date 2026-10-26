import { useAuth } from '@/contexts/AuthContext';
import { ChatWorkspace } from '@/features/workplace/chat/ChatWorkspace';

export default function WorkplaceMessages() {
  const { user, organization } = useAuth();
  if (!user || !organization) return <p className="p-6 text-muted-foreground">Selecione uma organização para abrir as Mensagens.</p>;
  return <ChatWorkspace key={`${user.id}:${organization.id}`} organizationId={organization.id} userId={user.id} />;
}
