import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { useChatConversations } from './useChat';

/** Unread internal messages for the menu (muted and archived conversations do not count). */
export function ChatUnreadBadge({ className }: { className?: string }) {
  const { user, organization } = useAuth();
  const { data = [] } = useChatConversations(organization?.id, user?.id);
  const total = data.filter(conversation => !conversation.isMuted && !conversation.isArchived).reduce((sum, conversation) => sum + conversation.unread, 0);
  if (total === 0) return null;
  return <span className={cn('flex h-5 min-w-[20px] items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-semibold text-white', className)}>
    {total > 99 ? '99+' : total}
  </span>;
}
