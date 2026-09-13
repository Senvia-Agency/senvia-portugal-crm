export interface Referral {
  id: string; name: string; created_at: string; qualified_at: string | null;
  redeemed_at: string | null; revoked_at: string | null; reserved: boolean;
}
export interface ReferralDashboard {
  code: string;
  referrals: Referral[];
  billing: {
    exempt: boolean; status: string | null; interval: string | null; interval_count: number | null;
    next_renewal_at: string | null; cancel_at_period_end: boolean | null; synced_at: string | null;
    collection_paused?: boolean;
  };
}
export function referralTotals(rows: Referral[]) {
  return {
    pending: rows.filter(r => !r.qualified_at && !r.revoked_at).length,
    earned: rows.filter(r => r.qualified_at && !r.revoked_at).length,
    used: rows.filter(r => r.redeemed_at).length,
    reserved: rows.filter(r => r.qualified_at && !r.revoked_at && !r.redeemed_at && r.reserved).length,
    available: rows.filter(r => r.qualified_at && !r.revoked_at && !r.redeemed_at && !r.reserved).length,
  };
}
export function nextReferralBonus(data: ReferralDashboard, now = Date.now()) {
  const totals = referralTotals(data.referrals);
  const b = data.billing;
  if (b?.exempt) return { title: 'A tua organização já está isenta', detail: 'Não existe uma mensalidade a descontar. Os meses ganhos ficam registados, sem conversão em dinheiro.', tone: 'neutral' };
  if (totals.reserved) return { title: 'Um mês está em aplicação', detail: 'O bónus está reservado para uma fatura. Será marcado como utilizado após a confirmação dessa fatura.', tone: 'positive' };
  if (!totals.available) return { title: 'Sem bónus para a próxima mensalidade', detail: 'O primeiro pagamento de uma empresa indicada desbloqueia um mês gratuito.', tone: 'neutral' };
  if (b?.collection_paused) return { title: 'Bónus guardado enquanto a cobrança está suspensa', detail: 'Os meses disponíveis continuam registados. A próxima aplicação depende da retoma da cobrança mensal.', tone: 'neutral' };
  if (b?.interval === 'year') return { title: 'Bónus guardado para faturação mensal', detail: 'A tua subscrição é anual. Os meses acumulados ficam disponíveis quando passares a uma subscrição mensal.', tone: 'neutral' };
  if (b?.cancel_at_period_end || b?.status === 'canceled') return { title: 'Bónus guardado, sem renovação prevista', detail: 'A subscrição está cancelada ou tem cancelamento agendado. Os meses disponíveis continuam registados.', tone: 'neutral' };
  if (b?.status === 'active' && b.interval === 'month' && b.interval_count === 1 && Date.parse(b.next_renewal_at || '') > now) {
    return { title: 'Um mês gratuito na próxima renovação', detail: 'Será utilizado um dos teus meses disponíveis para cobrir o plano e os utilizadores adicionais. A aplicação fica confirmada quando a fatura for emitida.', tone: 'positive' };
  }
  return { title: 'Tens bónus disponível', detail: 'Ainda não está confirmada uma próxima renovação mensal elegível. Os meses ganhos continuam guardados.', tone: 'neutral' };
}
