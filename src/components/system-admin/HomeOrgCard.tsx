import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Building2, Loader2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/AuthContext";
import { useHomeOrganization } from "@/hooks/useHomeOrganization";
import { useLanguage } from "@/i18n";

interface HomeOrgCardProps {
  /** Member count for the home org, when already loaded by the page. */
  memberCount?: number;
  loading?: boolean;
}

/**
 * The operator's own organization, kept out of the clients list.
 *
 * It used to sit in the same table as every customer, distinguishable only by
 * an "atual" badge, which made the one org you actually work in the hardest to
 * find.
 */
export function HomeOrgCard({ memberCount, loading }: HomeOrgCardProps) {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { switchOrganization } = useAuth();
  const { home, isAtHome, isLoading } = useHomeOrganization();
  const [switching, setSwitching] = useState(false);

  if (isLoading || loading) {
    return <Skeleton className="h-[86px] w-full rounded-xl" />;
  }
  if (!home) return null;

  const enter = async () => {
    if (isAtHome) {
      navigate("/");
      return;
    }
    setSwitching(true);
    await switchOrganization(home.organization_id);
  };

  return (
    <div className="flex flex-wrap items-center gap-4 rounded-xl border border-primary/25 bg-primary/[0.03] p-4">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
        <Building2 className="h-5 w-5 text-primary" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-semibold">{home.organization_name}</span>
          <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
            {t("a tua conta")}
          </span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          <span>{home.organization_code}</span>
          {memberCount != null && (
            <span className="inline-flex items-center gap-1">
              <Users className="h-3 w-3" />
              {t(memberCount === 1 ? "{{n}} membro" : "{{n}} membros", { n: memberCount })}
            </span>
          )}
        </div>
      </div>

      <Button size="sm" onClick={enter} disabled={switching} className="shrink-0">
        {switching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
        {isAtHome ? t("Abrir painel") : t("Entrar", { context: "org" })}
        {!switching && <ArrowRight className="ml-2 h-4 w-4" />}
      </Button>
    </div>
  );
}
