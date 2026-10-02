// deno-lint-ignore-file no-explicit-any

import { deterministicUuid } from './agency-automations.ts';

export const SALE_CYCLE_DUE_IN_2_DAYS = 'sale_renewal_due_in_2_days';
export const SALE_CYCLE_DUE_TODAY = 'sale_renewal_due_today';
export const SALE_CYCLE_OVERDUE = 'sale_renewal_overdue';

/**
 * Cycles older than this are history, not an alert. Without the fence the
 * first run after activation would announce every unpaid cycle a tenant ever
 * left behind — 34 of them across two organizations at the time of writing.
 */
const OVERDUE_WINDOW_DAYS = 7;

const isoDay = (offsetDays: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
};
const ptDate = (iso: string) =>
  new Date(iso + 'T00:00:00Z').toLocaleDateString('pt-PT', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' });
const euro = (value: number | string | null | undefined) =>
  new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(Number(value ?? 0));
const daysBetween = (fromIso: string, toIso: string) =>
  Math.round((Date.parse(toIso + 'T00:00:00Z') - Date.parse(fromIso + 'T00:00:00Z')) / 86_400_000);

export function saleBillingTriggerForPaymentDate(
  paymentDate: string,
  today: string,
  inTwoDays: string,
): string | null {
  if (paymentDate === inTwoDays) return SALE_CYCLE_DUE_IN_2_DAYS;
  if (paymentDate === today) return SALE_CYCLE_DUE_TODAY;
  if (paymentDate < today) return SALE_CYCLE_OVERDUE;
  return null;
}

interface EngineTarget { supabaseUrl: string; serviceKey: string }

/**
 * Enrols straight into the engine, skipping process-automation on purpose:
 * that path also walks the legacy per-template automations for the same
 * trigger name, and check-renewal-automations already serves those from the
 * sale's renewal date. Going direct means one source of dates per system.
 */
async function enroll(target: EngineTarget, body: Record<string, unknown>) {
  const res = await fetch(`${target.supabaseUrl}/functions/v1/automation-engine`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${target.serviceKey}` },
    body: JSON.stringify({ action: 'enroll', subject_type: 'sale', ...body }),
  });
  if (!res.ok) throw new Error(`automation-engine ${res.status}`);
}

interface SaleContext {
  sale: { id: string; code: string | null; organization_id: string; client_id: string | null } | null;
  client: { name: string | null; email: string | null; phone: string | null; company: string | null; assigned_to: string | null } | null;
  vendor: { full_name: string | null; email: string | null; phone: string | null } | null;
}

/** Sale, client and salesperson for a batch of sale ids, in three queries total. */
async function loadContexts(db: any, saleIds: string[]): Promise<Map<string, SaleContext>> {
  const out = new Map<string, SaleContext>();
  if (!saleIds.length) return out;
  const { data: sales, error } = await db.from('sales')
    .select('id, code, organization_id, client_id').in('id', saleIds);
  if (error) throw new Error(error.message);
  const clientIds = [...new Set((sales ?? []).map((s: any) => s.client_id).filter(Boolean))];
  const { data: clients } = clientIds.length
    ? await db.from('crm_clients').select('id, name, email, phone, company, assigned_to').in('id', clientIds)
    : { data: [] };
  const vendorIds = [...new Set((clients ?? []).map((c: any) => c.assigned_to).filter(Boolean))];
  const { data: vendors } = vendorIds.length
    ? await db.from('profiles').select('id, full_name, email, phone').in('id', vendorIds)
    : { data: [] };
  const clientById = new Map((clients ?? []).map((c: any) => [c.id, c]));
  const vendorById = new Map((vendors ?? []).map((v: any) => [v.id, v]));
  for (const sale of sales ?? []) {
    const client = sale.client_id ? clientById.get(sale.client_id) ?? null : null;
    out.set(sale.id, { sale, client, vendor: client?.assigned_to ? vendorById.get(client.assigned_to) ?? null : null });
  }
  return out;
}

function buildRecord(id: string, ctx: SaleContext, extra: Record<string, string>): Record<string, string> | null {
  // A client with no email cannot be written to; the engine would fail the
  // run at the send step anyway, so skip it here with a reason in the logs.
  if (!ctx.client?.email) return null;
  return {
    id,
    sale_id: ctx.sale?.id ?? '',
    client_id: ctx.sale?.client_id ?? '',
    nome: ctx.client.name ?? '',
    email: ctx.client.email,
    telefone: ctx.client.phone ?? '',
    empresa: ctx.client.company ?? '',
    codigo_venda: ctx.sale?.code ?? '',
    vendedor_nome: ctx.vendor?.full_name ?? '',
    vendedor_email: ctx.vendor?.email ?? '',
    vendedor_telefone: ctx.vendor?.phone ?? '',
    ...extra,
  };
}

/**
 * Daily: three moments in a manual recurring sale's billing.
 *
 * - due in 2 days: read from the recurrence's `next_cycle_date`, because the
 *   cycle row for that period does not exist yet — the generator creates it on
 *   the day it starts. Subject is a stable id of (recurrence, date).
 * - due today: the cycle exists and is unpaid. Subject is the cycle id.
 * - overdue: unpaid, past due, within the 7-day window. Subject is the cycle
 *   id, so each cycle is announced once and older debt stays silent.
 *
 * Nothing here may break the caller: every failure is logged and counted.
 */
export async function announceSaleCycles(db: any, target: EngineTarget) {
  const today = isoDay(0);
  const inTwoDays = isoDay(2);
  const windowStart = isoDay(-OVERDUE_WINDOW_DAYS);
  const summary = { due_in_2_days: 0, due_today: 0, overdue: 0, skipped_no_email: 0, failed: 0 };

  const [{ data: upcoming, error: e1 }, { data: cycles, error: e2 }, { data: payments, error: e3 }] = await Promise.all([
    db.from('sale_recurrences')
      .select('id, sale_id, organization_id, amount, next_cycle_date')
      .eq('service_status', 'active').eq('billing_provider', 'manual')
      .eq('next_cycle_date', inTwoDays),
    db.from('sale_recurring_cycles')
      .select('id, sale_id, organization_id, amount, due_date, period_start, period_end, recurrence_id, recurrence:sale_recurrences(service_status, billing_provider)')
      .is('paid_at', null).neq('status', 'paid')
      .gte('due_date', windowStart).lte('due_date', today),
    db.from('sale_payments')
      .select('id, sale_id, organization_id, amount, payment_date, status, notes, recurring_cycle_id, sale:sales!inner(status)')
      .eq('status', 'pending')
      .gte('payment_date', windowStart).lte('payment_date', inTwoDays),
  ]);
  if (e1) throw new Error(e1.message);
  if (e2) throw new Error(e2.message);
  if (e3) throw new Error(e3.message);

  const liveCycles = (cycles ?? []).filter((c: any) =>
    c.recurrence?.service_status === 'active' && c.recurrence?.billing_provider === 'manual');
  // One charge, one announcement. A monthly renewal exists twice — the cycle
  // and the pending payment generated for it (recurring_cycle_id) — and each
  // has its own id, so the engine's once-per-subject check let both through:
  // on 2026-10-02 two clients got the same reminder twice on WhatsApp. The
  // cycle (or the 2-day notice of the recurrence) speaks for its payment; a
  // payment is only announced on its own when nothing else covers that sale
  // on that date (instalments, one-off scheduled payments).
  const covered = new Set<string>([
    ...liveCycles.map((c: any) => `${c.sale_id}:${c.due_date}`),
    ...(upcoming ?? []).map((r: any) => `${r.sale_id}:${r.next_cycle_date}`),
  ]);
  const pendingPayments = (payments ?? []).filter((payment: any) =>
    payment.sale?.status !== 'cancelled' &&
    !payment.recurring_cycle_id &&
    typeof payment.payment_date === 'string' &&
    !covered.has(`${payment.sale_id}:${payment.payment_date}`) &&
    saleBillingTriggerForPaymentDate(payment.payment_date, today, inTwoDays) !== null);

  const saleIds = [...new Set([
    ...(upcoming ?? []).map((r: any) => r.sale_id),
    ...liveCycles.map((c: any) => c.sale_id),
    ...pendingPayments.map((payment: any) => payment.sale_id),
  ].filter(Boolean))] as string[];
  const contexts = await loadContexts(db, saleIds);

  const send = async (trigger: string, orgId: string, record: Record<string, string> | null, key: keyof typeof summary) => {
    if (!record) { summary.skipped_no_email++; return; }
    try {
      await enroll(target, { trigger_type: trigger, organization_id: orgId, record });
      summary[key]++;
    } catch (error) {
      summary.failed++;
      console.error('[sale-cycles] despacho falhou', { trigger, id: record.id, error: (error as Error).message });
    }
  };

  for (const r of upcoming ?? []) {
    const ctx = contexts.get(r.sale_id);
    if (!ctx) continue;
    const id = await deterministicUuid(`cycle-due:${r.id}:${r.next_cycle_date}`);
    await send(SALE_CYCLE_DUE_IN_2_DAYS, r.organization_id, buildRecord(id, ctx, {
      valor: euro(r.amount),
      data_vencimento: ptDate(r.next_cycle_date),
      dias_para_vencimento: '2',
    }), 'due_in_2_days');
  }

  for (const payment of pendingPayments) {
    const trigger = saleBillingTriggerForPaymentDate(payment.payment_date, today, inTwoDays);
    if (!trigger) continue;
    const ctx = contexts.get(payment.sale_id);
    if (!ctx) continue;
    const record = buildRecord(payment.id, ctx, {
      valor: euro(payment.amount),
      data_vencimento: ptDate(payment.payment_date),
      periodo: payment.notes || 'Pagamento agendado',
      ...(trigger === SALE_CYCLE_DUE_IN_2_DAYS ? { dias_para_vencimento: '2' } : {}),
      ...(trigger === SALE_CYCLE_DUE_TODAY ? { dias_para_vencimento: '0' } : {}),
      ...(trigger === SALE_CYCLE_OVERDUE ? { dias_em_atraso: String(daysBetween(payment.payment_date, today)) } : {}),
    });
    if (trigger === SALE_CYCLE_DUE_IN_2_DAYS) {
      await send(trigger, payment.organization_id, record, 'due_in_2_days');
    } else if (trigger === SALE_CYCLE_DUE_TODAY) {
      await send(trigger, payment.organization_id, record, 'due_today');
    } else {
      await send(trigger, payment.organization_id, record, 'overdue');
    }
  }

  for (const c of liveCycles) {
    const ctx = contexts.get(c.sale_id);
    if (!ctx) continue;
    const common = {
      valor: euro(c.amount),
      data_vencimento: ptDate(c.due_date),
      periodo: `${ptDate(c.period_start)} a ${ptDate(c.period_end)}`,
    };
    if (c.due_date === today) {
      await send(SALE_CYCLE_DUE_TODAY, c.organization_id, buildRecord(c.id, ctx, { ...common, dias_para_vencimento: '0' }), 'due_today');
    } else {
      const late = daysBetween(c.due_date, today);
      await send(SALE_CYCLE_OVERDUE, c.organization_id, buildRecord(c.id, ctx, { ...common, dias_em_atraso: String(late) }), 'overdue');
    }
  }

  return summary;
}
