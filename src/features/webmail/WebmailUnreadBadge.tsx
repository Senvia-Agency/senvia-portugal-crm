import { cn } from '@/lib/utils';
import { useMailAccounts, useWebmailUnread } from './useWebmail';
import { countLabel } from './webmail-model';

/** Unread in the Inbox folders of the caixas this person can open, for the "Email" menu item. */
export function WebmailUnreadBadge({ className }: { className?: string }) {
  const { accounts } = useMailAccounts();
  const { total } = useWebmailUnread(accounts);
  if (total <= 0) return null;
  return <span className={cn('flex h-5 min-w-[20px] items-center justify-center rounded-full bg-amber-500 px-1.5 text-[10px] font-semibold text-white', className)}>
    {total > 99 ? '99+' : countLabel(total)}
  </span>;
}
