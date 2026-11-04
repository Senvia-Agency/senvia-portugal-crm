import { useState } from 'react';
import { Eye, Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useHomeOrganization } from '@/hooks/useHomeOrganization';
import { useLanguage } from '@/i18n';

/**
 * Shown while a super admin is inside an organization they do not belong to,
 * after switching into it from System Admin.
 *
 * Two reasons it exists: the sidebar switcher only lists the user's own
 * memberships, so there may be no way back; and editing a client's data while
 * believing you are in your own org is an easy and expensive mistake.
 */
export function SuperAdminVisitBanner() {
  const { organization, isSuperAdmin, switchOrganization } = useAuth();
  const { home, isVisiting } = useHomeOrganization();
  const [switching, setSwitching] = useState(false);
  const { t } = useLanguage();

  if (!isSuperAdmin || !isVisiting || !home) return null;

  const goHome = async () => {
    setSwitching(true);
    await switchOrganization(home.organization_id);
  };

  return (
    <div className="flex items-center justify-center gap-2 bg-amber-500/10 px-4 py-1.5 text-center text-xs text-amber-700 dark:text-amber-400">
      <Eye className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">
        {t("Estás a ver")} <strong className="font-semibold">{organization?.name}</strong> {t("como super admin.")}
      </span>
      <button
        type="button"
        onClick={goHome}
        disabled={switching}
        className="inline-flex shrink-0 items-center gap-1 font-semibold underline underline-offset-2 hover:no-underline disabled:opacity-60"
      >
        {switching && <Loader2 className="h-3 w-3 animate-spin" />}
        {t("Voltar a {{org}}", { org: home.organization_name })}
      </button>
    </div>
  );
}
