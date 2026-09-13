import { Bell } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useAnnouncements } from '@/hooks/useAnnouncements';
import { isPerfect2GetherOrg } from '@/lib/perfect2gether';
import { cn } from '@/lib/utils';

interface WhatsNewButtonProps {
  className?: string;
  /** Sidebar colours differ from the mobile header's. */
  variant?: 'sidebar' | 'header';
}

/**
 * Links to the release history even when there is no active popup announcement.
 */
export function WhatsNewButton({ className, variant = 'header' }: WhatsNewButtonProps) {
  const { organization } = useAuth();
  const { hasUnread } = useAnnouncements();

  if (isPerfect2GetherOrg(organization?.id)) return null;

  return (
    <Link
      to="/novidades"
      title="O que há de novo"
      aria-label={hasUnread ? 'O que há de novo (novidades por ler)' : 'O que há de novo'}
      className={cn(
        'relative rounded-lg p-2 transition-colors',
        variant === 'sidebar'
          ? 'text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
        className,
      )}
    >
      <Bell className="h-5 w-5" />
      {hasUnread && (
        <span className="absolute right-1.5 top-1.5 flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-60" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-background" />
        </span>
      )}
    </Link>
  );
}
