import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import {
  PLAN_RANK,
  MODULE_REQUIRED_RANK,
  MODULE_REQUIRED_PLAN,
  DEFAULT_PLAN_FEATURES,
  isOrgOnTrial,
  getPlanRank,
} from '@/lib/plan-config';

type ModuleKey = 'sales' | 'finance' | 'marketing' | 'ecommerce';
type IntegrationKey = 'whatsapp' | 'invoicing' | 'meta_pixels' | 'stripe';
type FeatureKey = 'conversational_forms' | 'multi_org' | 'push_notifications' | 'fidelization_alerts';

interface PlanFeatures {
  modules: Record<ModuleKey, boolean>;
  integrations: Record<IntegrationKey, boolean>;
  features: Record<FeatureKey, boolean>;
}

interface SubscriptionPlan {
  id: string;
  name: string;
  max_users: number | null;
  max_forms: number | null;
  max_inboxes: number | null;
  features: PlanFeatures;
  price_monthly: number;
}

// Fallback plan construído a partir da fonte de verdade.
const DEFAULT_PLAN: SubscriptionPlan = {
  id: DEFAULT_PLAN_FEATURES.id,
  name: DEFAULT_PLAN_FEATURES.name,
  max_users: DEFAULT_PLAN_FEATURES.max_users,
  max_forms: DEFAULT_PLAN_FEATURES.max_forms,
  max_inboxes: DEFAULT_PLAN_FEATURES.max_inboxes,
  price_monthly: DEFAULT_PLAN_FEATURES.price_monthly,
  features: {
    modules: DEFAULT_PLAN_FEATURES.modules,
    integrations: { ...DEFAULT_PLAN_FEATURES.integrations, whatsapp: false },
    features: { ...DEFAULT_PLAN_FEATURES.featureFlags, multi_org: DEFAULT_PLAN_FEATURES.featureFlags.multi_org },
  },
};

export function useSubscription() {
  const { organization } = useAuth();

  // Billing-exempt orgs (demos, internal, partners) get full access regardless
  // of what's in subscription_plans. Avoids having to maintain plan rows or
  // toggle modules per org.
  const isBillingExempt = !!(organization as any)?.billing_exempt;

  // If on trial, use 'elite' features; otherwise use the DB plan
  const onTrial = isOrgOnTrial(organization as any);
  const planId = onTrial ? 'elite' : (organization?.plan || 'starter');

  const { data: plan, isLoading } = useQuery({
    queryKey: ['subscription-plan', planId],
    queryFn: async () => {
      const { data, error } = await supabase
        .rpc('get_subscription_plan' as any, { _plan_id: planId });

      // Fallback: direct SQL via rest if rpc not available
      if (error || !data) {
        const res = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/subscription_plans?id=eq.${planId}&select=*`,
          {
            headers: {
              'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
              'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
            },
          }
        );
        const rows = await res.json();
        if (!Array.isArray(rows) || rows.length === 0) return DEFAULT_PLAN;
        const row = rows[0];
        return {
          id: row.id,
          name: row.name,
          max_users: row.max_users,
          max_forms: row.max_forms,
          max_inboxes: row.max_inboxes ?? null,
          price_monthly: Number(row.price_monthly),
          features: row.features as PlanFeatures,
        } as SubscriptionPlan;
      }

      const row = Array.isArray(data) ? data[0] : data;
      if (!row) return DEFAULT_PLAN;

      return {
        id: row.id,
        name: row.name,
        max_users: row.max_users,
        max_forms: row.max_forms,
        max_inboxes: row.max_inboxes ?? null,
        price_monthly: Number(row.price_monthly),
        features: row.features as PlanFeatures,
      } as SubscriptionPlan;
    },
    enabled: !!organization,
    staleTime: 1000 * 60 * 10,
  });

  // billing_exempt means "skip blockers", NOT "grant Elite access". The plan
  // tier (and module visibility) is always controlled by the org's `plan`
  // column. Demo orgs that should get full Elite access must have
  // `plan = 'elite'` set explicitly — not just billing_exempt.
  const currentPlan = plan || DEFAULT_PLAN;

  const canUseModule = (module: ModuleKey): boolean => {
    return module !== 'ecommerce';
  };

  const canUseIntegration = (integration: IntegrationKey): boolean => {
    return integration !== 'whatsapp';
  };

  const canUseFeature = (feature: FeatureKey): boolean => {
    return true;
  };

  // A module is "locked" when the current plan doesn't reach the tier required
  // for it. Two paths to find that out:
  //   1. The plan's features.modules map explicitly says false.
  //   2. The module is in MODULE_REQUIRED_RANK and the plan rank is below it
  //      (this catches modules like "prospects" that aren't in the plan map).
  // The sidebar uses this flag to keep the menu item visible BUT with a padlock
  // icon — so starter customers see what's available with an upgrade.
  const isModuleLocked = (moduleKey: string): boolean => {
    if (moduleKey !== 'ecommerce') return false;
    const modulesMap = currentPlan.features?.modules;
    if (modulesMap && moduleKey in modulesMap) {
      return !modulesMap[moduleKey as ModuleKey];
    }
    const requiredRank = MODULE_REQUIRED_RANK[moduleKey];
    if (requiredRank === undefined) return false;
    const currentRank = PLAN_RANK[currentPlan.id] ?? 0;
    return currentRank < requiredRank;
  };

  const getRequiredPlan = (moduleKey: string): string => {
    return MODULE_REQUIRED_PLAN[moduleKey] || 'Pro';
  };

  return {
    plan: currentPlan.id,
    planName: 'SENVIA OS',
    onTrial,
    limits: {
      maxUsers: currentPlan.max_users,
      maxForms: null,
      maxInboxes: null,
    },
    isLoading,
    canUseModule,
    canUseIntegration,
    canUseFeature,
    isModuleLocked,
    getRequiredPlan,
  };
}
