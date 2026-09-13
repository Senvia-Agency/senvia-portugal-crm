// src/lib/plan-config.ts
// ÚNICA fonte de verdade para planos, módulos e restrições.
// Importado por useModules.ts e useSubscription.ts.

// ─── Plan Tier Ranking ───
export const PLAN_RANK: Record<string, number> = {
  basic: 2,
  starter: 2,
  pro: 2,
  elite: 2,
};

// ─── Module Required Rank ───
// Cada módulo gated precisa de um rank mínimo de plano.
// Módulos core (clients, inbox, calendar, energy, proposals, sales) não estão aqui.
export const MODULE_REQUIRED_RANK: Record<string, number> = {
  marketing: 1, // Pro+
  finance: 2,   // Elite+
  ecommerce: 2, // Elite+
  prospects: 2, // Elite+
};

// ─── Module Required Plan Name (para upsell messaging) ───
export const MODULE_REQUIRED_PLAN: Record<string, string> = {
  marketing: 'SENVIA OS',
  finance: 'SENVIA OS',
  ecommerce: 'SENVIA OS',
  prospects: 'SENVIA OS',
};

// ─── Default Plan Features (fallback quando a BD não devolve nada) ───
export const DEFAULT_PLAN_FEATURES = {
  id: 'starter',
  name: 'SENVIA OS',
  modules: { sales: true, finance: true, marketing: true, ecommerce: false },
  integrations: { invoicing: true, meta_pixels: true, stripe: true },
  featureFlags: { conversational_forms: true, multi_org: true, push_notifications: true, fidelization_alerts: true },
  max_users: 5,
  max_forms: null,
  max_inboxes: null,
  price_monthly: 49,
};

// ─── Default Module States (para o merge no useModules) ───
export const DEFAULT_MODULES = {
  proposals: true,
  calendar: true,
  sales: true,
  ecommerce: false,
  clients: true,
  marketing: true,
  finance: true,
  energy: true,
  prospects: true,
  inbox: true,
};

// ─── isOrgOnTrial ───
export function isOrgOnTrial(org: any): boolean {
  if (!org) return false;
  if (org.billing_exempt) return false;
  if (org.first_paid_at) return false;
  const trialEnd = org.trial_ends_at;
  if (!trialEnd) return false;
  return new Date(trialEnd).getTime() > Date.now();
}

// ─── Helper: plan rank for an org ───
export function getPlanRank(org: any): number {
  return isOrgOnTrial(org) ? 2 : (PLAN_RANK[org?.plan || 'starter'] ?? 0);
}

// ─── Helper: is plan sufficient for module ───
export function isPlanSufficient(planRank: number, moduleKey: string): boolean {
  const required = MODULE_REQUIRED_RANK[moduleKey];
  if (required === undefined) return true; // módulo core, sempre disponível
  return planRank >= required;
}
