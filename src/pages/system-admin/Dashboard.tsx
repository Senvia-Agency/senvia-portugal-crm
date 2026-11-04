import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useHomeOrganization } from "@/hooks/useHomeOrganization";
import { Activity, Users, Sparkles, MessageCircle, Clapperboard } from "lucide-react";
import { AdminShell } from "@/components/system-admin/AdminShell";
import { AdminOverview } from "@/components/system-admin/AdminOverview";
import { HomeOrgCard } from "@/components/system-admin/HomeOrgCard";
import { OrganizationsTable } from "@/components/system-admin/OrganizationsTable";
import type { OrgStripeData, AdminContact, OrgFilter } from "@/components/system-admin/OrganizationsTable";
import { useLanguage } from "@/i18n";

interface OrgRow {
  id: string;
  name: string;
  slug: string;
  code: string | null;
  plan: string | null;
  trial_ends_at: string | null;
  billing_exempt: boolean | null;
  created_at: string | null;
  contact_phone: string | null;
  first_paid_at: string | null;
  current_period_end: string | null;
  payment_failed_at: string | null;
  last_active_at: string | null;
  extra_seats: number | null;
}

interface OrgWithMembers extends OrgRow {
  member_count: number;
}

interface StripeStatsResponse {
  mrr: number;
  paying_count: number;
  total_subscriptions: number;
  org_stats: OrgStripeData[];
}

const SECONDARY = [
  { to: "/system-admin/activation", icon: Activity, label: "Ativação" },
  { to: "/system-admin/trial-whatsapp", icon: MessageCircle, label: "WhatsApp" },
  { to: "/system-admin/users", icon: Users, label: "Utilizadores" },
  { to: "/system-admin/announcements", icon: Sparkles, label: "Novidades" },
  { to: "/system-admin/reviews", icon: Clapperboard, label: "Avaliações" },
];

export default function SystemAdminDashboard() {
  const { switchOrganization, organization } = useAuth();
  const { t } = useLanguage();
  const { home } = useHomeOrganization();
  // The attention strip focuses the list below instead of just reporting.
  const [orgFilter, setOrgFilter] = useState<OrgFilter>("all");

  const { data: organizations = [], isLoading } = useQuery({
    queryKey: ["super-admin-all-orgs"],
    queryFn: async (): Promise<OrgWithMembers[]> => {
      // Cast: last_active_at is newer than the generated types.
      const { data: orgs, error } = await (supabase as any)
        .from("organizations")
        .select("id, name, slug, code, plan, trial_ends_at, billing_exempt, created_at, contact_phone, first_paid_at, current_period_end, payment_failed_at, last_active_at, extra_seats")
        .order("created_at", { ascending: false });
      if (error) throw error;

      const { data: members, error: mErr } = await supabase
        .from("organization_members")
        .select("organization_id");
      if (mErr) throw mErr;

      const counts: Record<string, number> = {};
      (members || []).forEach((m) => {
        counts[m.organization_id] = (counts[m.organization_id] || 0) + 1;
      });

      // Fold the latest member login into "última atividade" so an account that
      // is USED (logins, admin work) but doesn't create new entities isn't shown
      // as dead. The stored last_active_at stays creation-only for the activation
      // funnel; this GREATEST is display-only. Non-fatal if the RPC is unavailable.
      const loginMap: Record<string, string> = {};
      try {
        const { data: logins } = await (supabase as any).rpc("admin_org_last_sign_in");
        (logins || []).forEach((r: any) => {
          if (r.org_id && r.last_login) loginMap[r.org_id] = r.last_login;
        });
      } catch { /* fall back to last_active_at */ }

      return (orgs || []).map((o: any) => {
        const candidates = [o.last_active_at, loginMap[o.id]].filter(Boolean) as string[];
        const lastActive = candidates.length ? candidates.sort().pop()! : o.last_active_at;
        return { ...o, last_active_at: lastActive, member_count: counts[o.id] || 0 };
      });
    },
  });

  const { data: adminInfo = {} } = useQuery({
    queryKey: ["super-admin-admin-info"],
    queryFn: async (): Promise<Record<string, AdminContact>> => {
      const { data, error } = await supabase
        .from("organization_members")
        .select("organization_id, user_id, role")
        .eq("role", "admin")
        .eq("is_active", true);
      if (error) throw error;

      const adminUserIds = (data || []).map((m: any) => m.user_id);
      if (adminUserIds.length === 0) return {};

      const { data: profiles, error: pErr } = await supabase
        .from("profiles")
        .select("id, email, full_name")
        .in("id", adminUserIds);
      if (pErr) throw pErr;

      const profMap: Record<string, AdminContact> = {};
      (profiles || []).forEach((p: any) => {
        profMap[p.id] = { name: p.full_name || undefined, email: p.email || undefined };
      });

      const orgAdminMap: Record<string, AdminContact> = {};
      (data || []).forEach((m: any) => {
        if (!orgAdminMap[m.organization_id] && profMap[m.user_id]) {
          orgAdminMap[m.organization_id] = profMap[m.user_id];
        }
      });
      return orgAdminMap;
    },
    staleTime: 5 * 60 * 1000,
  });

  const { data: stripeStats } = useQuery({
    queryKey: ["super-admin-stripe-stats"],
    queryFn: async (): Promise<StripeStatsResponse> => {
      const { data, error } = await supabase.functions.invoke("admin-stripe-stats");
      if (error) throw error;
      return data as StripeStatsResponse;
    },
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  return (
    <AdminShell
      title={t("Visão geral")}
      description={t("Subscrições, receita e clientes do Senvia OS.")}
      back={false}
      maxWidth="wide"
      action={
        <nav className="flex items-center gap-1">
          {SECONDARY.map((s) => (
            <Link
              key={s.to}
              to={s.to}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <s.icon className="h-4 w-4" />
              <span className="hidden sm:inline">{t(s.label)}</span>
            </Link>
          ))}
        </nav>
      }
    >
      {/* From xl the page is two columns, 35/65: the overview (numbers, chart,
          status) on the left, own org + customers on the right — the list gets
          the larger share because it has nine columns to draw. The left column
          is exactly one viewport high and sticks while the list scrolls; the
          chart inside it absorbs the leftover height, so nothing in it ever
          needs scrolling. Below xl a sidebar left the table unusable, so it
          stacks. */}
      <div className="xl:grid xl:grid-cols-[7fr_13fr] xl:items-start xl:gap-8">
        <div className="xl:sticky xl:top-20 xl:flex xl:h-[calc(100dvh-6rem)] xl:flex-col">
          {/* Overview: metrics + chart + subscription status */}
          <AdminOverview
            organizations={organizations}
            stripeStats={stripeStats}
            loading={isLoading}
            sidebar
            onFocus={(f) => {
              setOrgFilter(f);
              document.getElementById("admin-clients")?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
          />
        </div>

        <div className="mt-8 space-y-6 xl:mt-0">
          {/* Own organization, kept out of the customers list */}
          <section className="space-y-3">
            <h2 className="text-sm font-medium text-foreground/70">{t("A tua organização")}</h2>
            <HomeOrgCard
              memberCount={organizations.find((o) => o.id === home?.organization_id)?.member_count}
              loading={isLoading}
            />
          </section>

        {/* Customers */}
        <section id="admin-clients" className="scroll-mt-20 space-y-3">
          <h2 className="text-sm font-medium text-foreground/70">{t("Clientes")}</h2>
        <OrganizationsTable
          organizations={organizations.filter((o) => o.id !== home?.organization_id)}
          loading={isLoading}
          currentOrgId={organization?.id}
          onAccessOrg={(id) => switchOrganization(id)}
          stripeData={stripeStats?.org_stats}
          adminInfo={adminInfo}
          filter={orgFilter}
          onFilterChange={setOrgFilter}
        />
        </section>
        </div>
      </div>
    </AdminShell>
  );
}
