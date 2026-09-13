import type { Referral, ReferralDashboard } from './referral-dashboard';

export const REFERRAL_PREVIEW_SCENARIOS = [
  ['empty', 'Sem indicações'],
  ['pending', 'Empresa registada, pagamento pendente'],
  ['earned', 'Primeiro pagamento confirmado'],
  ['accumulated', 'Três meses acumulados'],
  ['reserved', 'Bónus em aplicação na renovação'],
  ['used', 'Mês gratuito utilizado'],
  ['annual', 'Subscrição anual com bónus'],
  ['cancelled', 'Subscrição com cancelamento agendado'],
  ['paused', 'Cobrança suspensa com bónus'],
  ['exempt', 'Organização isenta com bónus'],
] as const;
export type ReferralPreviewScenario = typeof REFERRAL_PREVIEW_SCENARIOS[number][0];

// Pure preview data: never stored in React Query, localStorage or the database.
export function buildReferralPreview(scenario: ReferralPreviewScenario, now = Date.now()): ReferralDashboard {
  const day = 86_400_000;
  const iso = (days: number) => new Date(now + days * day).toISOString();
  const paid: Referral = {
    id: 'preview-1', name: 'Empresa Horizonte (teste)', created_at: iso(-12),
    qualified_at: iso(-7), redeemed_at: null, revoked_at: null, reserved: false,
  };
  let referrals = [paid];
  if (scenario === 'empty') referrals = [];
  if (scenario === 'pending') referrals = [{ ...paid, qualified_at: null }];
  if (scenario === 'accumulated') referrals = [paid,
    { ...paid, id: 'preview-2', name: 'Empresa Atlântico (teste)', qualified_at: iso(-5) },
    { ...paid, id: 'preview-3', name: 'Empresa Oliveira (teste)', qualified_at: iso(-2) },
    { ...paid, id: 'preview-4', name: 'Empresa a Aguardar (teste)', qualified_at: null },
  ];
  if (scenario === 'reserved') referrals = [{ ...paid, reserved: true }];
  if (scenario === 'used') referrals = [{ ...paid, redeemed_at: iso(-1) }];
  return {
    code: 'simulacao-sem-validade', referrals,
    billing: {
      exempt: scenario === 'exempt', status: 'active', interval: scenario === 'annual' ? 'year' : 'month',
      interval_count: 1, next_renewal_at: iso(20), cancel_at_period_end: scenario === 'cancelled', synced_at: iso(0),
      collection_paused: scenario === 'paused',
    },
  };
}
