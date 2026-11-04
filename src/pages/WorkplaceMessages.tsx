import { useAuth } from '@/contexts/AuthContext';
import { ChatWorkspace } from '@/features/workplace/chat/ChatWorkspace';
import { useLanguage } from '@/i18n';

export default function WorkplaceMessages() {
  const { t } = useLanguage();
  const { user, organization } = useAuth();
  if (!user || !organization) return <p className="p-6 text-muted-foreground">{t('Selecione uma organização para abrir as Mensagens.')}</p>;
  return <ChatWorkspace key={`${user.id}:${organization.id}`} organizationId={organization.id} userId={user.id} />;
}
