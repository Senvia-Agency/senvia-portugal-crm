// Automations the AGENCY runs about its own customers: the flow belongs to
// Senvia, the contact is one of the customer organization's admins. This is
// the same shape the Stripe subscription triggers in stripe-webhook use; the
// referral programme and the renewal reminder both go through here so there
// is exactly one answer to "how do we email an organization".

// deno-lint-ignore-file no-explicit-any

export const SENVIA_AGENCY_ORG_ID = '06fe9e1d-9670-45b0-8717-c5a6e90be380';
export const RENEWAL_DUE_TRIGGER = 'subscription_renewal_due_2d';
/**
 * Days a customer keeps access after a failed renewal before the blocker.
 * check-subscription holds the same number as GRACE_DAYS and is the one that
 * actually enforces it; this copy only feeds the wording of the reminder, so
 * if that one moves, move this one.
 */
export const PAYMENT_GRACE_DAYS = 4;

const PLAN_LABELS: Record<string, string> = { basic: 'Basic', starter: 'Starter', pro: 'Pro', elite: 'Elite' };
export const planLabel = (plan: string | null | undefined) =>
  plan ? PLAN_LABELS[plan] ?? plan.charAt(0).toUpperCase() + plan.slice(1) : '';

const ptDate = (iso: string) =>
  new Date(iso).toLocaleDateString('pt-PT', { day: '2-digit', month: 'long', year: 'numeric' });

/**
 * The organization's earliest active admin, as the engine wants a contact:
 * `nome` greets the person, `empresa` names the organization. Null when there
 * is nobody with an email to write to — callers log and skip.
 */
export async function organizationAdminContact(db: any, organizationId: string) {
  const [org, admin] = await Promise.all([
    db.from('organizations').select('name, plan, contact_phone').eq('id', organizationId).maybeSingle(),
    db.from('organization_members').select('user_id')
      .eq('organization_id', organizationId).eq('role', 'admin').eq('is_active', true)
      .order('joined_at', { ascending: true }).limit(1).maybeSingle(),
  ]);
  const profile = admin.data?.user_id
    ? (await db.from('profiles').select('email, full_name, phone').eq('id', admin.data.user_id).maybeSingle()).data
    : null;
  if (!profile?.email) return null;
  return {
    email: profile.email as string,
    nome: (profile.full_name || org.data?.name || '') as string,
    empresa: (org.data?.name ?? '') as string,
    plano: planLabel(org.data?.plan),
    // The organization's contact phone (given at sign-up), else the admin's
    // own. The engine reads `telefone` as the run's phone: without it every
    // WhatsApp step in the agency's flows failed with "sem telefone".
    telefone: ((org.data?.contact_phone || profile.phone || '') as string).trim(),
  };
}

/**
 * Hands an event to process-automation for the agency's flows. `record.id` is
 * what the engine de-duplicates on, so it must identify the *occurrence*
 * (this reward, this renewal), never the organization — or the second one is
 * silently never sent. Failures only log: nothing upstream may break because
 * a reminder could not be queued.
 */
export async function dispatchAgencyAutomation(db: any, trigger: string, record: Record<string, string>) {
  const { error } = await db.functions.invoke('process-automation', {
    body: { trigger_type: trigger, organization_id: SENVIA_AGENCY_ORG_ID, record },
  });
  if (error) console.error('[agency-automations] despacho falhou', { trigger, id: record.id, error: error.message });
}

/**
 * A stable UUID for a name — RFC 4122 layout with the version-5 nibble — so an
 * occurrence with no row of its own (an organization's renewal on a given
 * date) still gets one id every time it is seen. `automation_runs.subject_id`
 * is a uuid column, and the engine's once-per-subject policy is the only thing
 * standing between a daily job and a duplicate reminder.
 */
export async function deterministicUuid(name: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(name)));
  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = [...digest.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Daily: the SENVIA OS subscription renews in two days, so remind the customer
 * to have payment in order. Source of truth is the billing snapshot Stripe
 * keeps current (`organization_billing_accounts`), not the organization row —
 * it knows about cancellations and paused collection, which a reminder must
 * respect. A 24-hour window centred 48h ahead means a once-a-day run sees each
 * renewal exactly once; the deterministic subject id covers a same-day re-run.
 *
 * Two kinds of renewal are deliberately skipped, both handled by the referral
 * programme's own mail: an organization whose *next* invoice will be a free
 * month (there is nothing to pay), and one currently *in* a free month (it is
 * about to get "your free month ends" instead, and two mails on one day about
 * the same invoice is one too many).
 */
export async function announceUpcomingRenewals(db: any) {
  const now = Date.now();
  const windowStart = new Date(now + 36 * 3_600_000).toISOString();
  const windowEnd = new Date(now + 60 * 3_600_000).toISOString();
  const recently = new Date(now - 45 * 86_400_000).toISOString();

  const { data: accounts, error } = await db.from('organization_billing_accounts')
    .select('organization_id, next_renewal_at')
    .eq('status', 'active').eq('cancel_at_period_end', false).eq('collection_paused', false)
    .not('stripe_subscription_id', 'is', null)
    .gte('next_renewal_at', windowStart).lt('next_renewal_at', windowEnd);
  if (error) throw new Error(error.message);
  if (!accounts?.length) return { announced: 0, skipped_referral: 0 };

  const ids = accounts.map((a: any) => a.organization_id as string);
  const [{ data: orgs }, { data: rewards }] = await Promise.all([
    db.from('organizations').select('id, billing_exempt').in('id', ids),
    db.from('organization_referrals').select('organization_id, qualified_at, redeemed_at, revoked_at')
      .in('organization_id', ids).is('revoked_at', null),
  ]);
  const exempt = new Set((orgs ?? []).filter((o: any) => o.billing_exempt).map((o: any) => o.id));

  // Next invoice is free, or the current period already is: not a payment.
  const referralHandled = new Set<string>();
  for (const r of rewards ?? []) {
    const pendingFreeMonth = r.qualified_at && !r.redeemed_at;
    const inFreeMonth = r.redeemed_at && r.redeemed_at >= recently;
    if (pendingFreeMonth || inFreeMonth) referralHandled.add(r.organization_id);
  }

  let announced = 0, skipped_referral = 0;
  for (const account of accounts) {
    const orgId = account.organization_id as string;
    if (exempt.has(orgId)) continue;
    if (referralHandled.has(orgId)) { skipped_referral++; continue; }
    const contact = await organizationAdminContact(db, orgId);
    if (!contact) { console.error('[agency-automations] renovação sem administrador com email', { orgId }); continue; }
    const renewalDay = String(account.next_renewal_at).slice(0, 10);
    await dispatchAgencyAutomation(db, RENEWAL_DUE_TRIGGER, {
      id: await deterministicUuid(`renewal:${orgId}:${renewalDay}`),
      organizacao_id: orgId,
      ...contact,
      data_renovacao: ptDate(account.next_renewal_at),
    });
    announced++;
  }
  return { announced, skipped_referral };
}
