import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";
import { getBaseUrl } from "@/lib/constants";
import { referralTotals, type ReferralDashboard } from "@/lib/referral-dashboard";

/**
 * The organization's referral link and months, for the places that remind admins
 * they can invite (top bar, Painel, menu). Only admins can read it (get_referral_dashboard).
 */
export function useReferralDashboard() {
  const { organization, user } = useAuth();
  const { isAdmin } = usePermissions();
  const query = useQuery({
    queryKey: ["referral-program", organization?.id, user?.id],
    enabled: !!organization?.id && !!user?.id && isAdmin,
    retry: false,
    staleTime: 60_000,
    queryFn: async () => {
      const result = await supabase.rpc("get_referral_dashboard" as never, { _organization_id: organization!.id } as never);
      if (result.error) throw result.error;
      return result.data as unknown as ReferralDashboard;
    },
  });
  const data = query.data;
  return {
    ...query,
    isAdmin,
    link: data ? referralLink(data.code) : null,
    totals: data ? referralTotals(data.referrals) : null,
  };
}

export const referralLink = (code: string) => `${getBaseUrl()}/login?tab=signup&ref=${code}`;

/** What goes with the link when it is shared. */
export const REFERRAL_MESSAGE =
  "Uso o Senvia OS para gerir leads, vendas e o financeiro da empresa num só sítio. Experimenta com o meu link:";
