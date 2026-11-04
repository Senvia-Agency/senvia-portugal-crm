import { Link } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { ModuleNavIcon } from './ModuleNavIcon';
import { useAuth } from '@/contexts/AuthContext';
import { useAnnouncements } from '@/hooks/useAnnouncements';
import { isPerfect2GetherOrg } from '@/lib/perfect2gether';
import { useLanguage } from '@/i18n';

/** Novidades in the top bar, with a dot while there is a release note not seen yet. */
export function NewsTopbarButton() {
  const { t } = useLanguage();
  const { organization } = useAuth();
  const { hasUnread } = useAnnouncements();
  if (isPerfect2GetherOrg(organization?.id)) return null;

  return (
    <Link to="/novidades" data-otto-target="guide-news" className="workplace-admin-link relative"
      aria-label={hasUnread ? t('Novidades (há novidades por ler)') : t('Novidades')}>
      {/* The same yellow tile as the menu entry, so both read as one thing. */}
      <ModuleNavIcon icon={Sparkles} to="/novidades" className="-ml-1 h-6 w-6 rounded-md [&_svg]:h-3.5 [&_svg]:w-3.5" />
      <span>{t('Novidades')}</span>
      {hasUnread && (
        <span className="absolute -right-0.5 -top-0.5 flex h-2.5 w-2.5" aria-hidden="true">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-yellow-400 opacity-75" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-yellow-400 ring-2 ring-[#10172a]" />
        </span>
      )}
    </Link>
  );
}
