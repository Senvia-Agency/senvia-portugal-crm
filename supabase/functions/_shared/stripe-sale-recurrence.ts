type PaidStripeSaleInput = {
  saleId: string;
  organizationId: string;
  invoiceId: string;
  customerId: string | null;
  subscriptionId: string | null;
  paymentDate: string;
  periodStart: string | null;
  periodEnd: string | null;
  nextCycleDate: string | null;
  invoiceAmount: number;
  recurringAmount: number;
  promotePendingSale?: boolean;
};

/** Keep the sale, recurrence and invoice cycle in sync on every successful payment,
 * including webhook retries and reconciled invoices that were already recorded. */
export async function syncPaidStripeSale(supabase: any, input: PaidStripeSaleInput) {
  const saleUpdate: Record<string, unknown> = {
    recurring_status: "active",
    next_renewal_date: input.nextCycleDate || input.periodEnd,
    last_renewal_date: input.paymentDate,
  };
  if (input.recurringAmount > 0) saleUpdate.recurring_value = input.recurringAmount;
  const { error: saleError } = await supabase.from("sales").update(saleUpdate).eq("id", input.saleId);
  if (saleError) throw new Error(`sale renewal sync failed: ${saleError.message}`);
  if (input.promotePendingSale) {
    const { error } = await supabase.from("sales").update({ status: "in_progress" })
      .eq("id", input.saleId).eq("status", "pending");
    if (error) throw new Error(`pending sale promotion failed: ${error.message}`);
  }

  const { data: recurrences, error: recurrenceQueryError } = await supabase
    .from("sale_recurrences")
    .select("id, anchor_date")
    .eq("sale_id", input.saleId)
    .eq("organization_id", input.organizationId)
    .in("service_status", ["pending", "active", "paused"])
    .order("created_at", { ascending: false })
    .limit(1);
  if (recurrenceQueryError) throw new Error(`recurrence lookup failed: ${recurrenceQueryError.message}`);

  const now = new Date().toISOString();
  const recurrencePatch = {
    amount: input.recurringAmount > 0 ? input.recurringAmount : input.invoiceAmount,
    service_status: "active",
    billing_status: "current",
    billing_provider: "stripe",
    next_cycle_date: input.nextCycleDate || input.periodEnd,
    last_cycle_date: input.periodStart || input.paymentDate,
    stripe_customer_id: input.customerId,
    stripe_subscription_id: input.subscriptionId,
    updated_at: now,
  };

  let recurrenceId = recurrences?.[0]?.id as string | undefined;
  if (recurrenceId) {
    const { error } = await supabase.from("sale_recurrences").update(recurrencePatch).eq("id", recurrenceId);
    if (error) throw new Error(`recurrence update failed: ${error.message}`);
  } else {
    const { data, error } = await supabase
      .from("sale_recurrences")
      .insert({
        organization_id: input.organizationId,
        sale_id: input.saleId,
        amount: recurrencePatch.amount,
        anchor_date: input.periodStart || input.paymentDate,
        ...recurrencePatch,
      })
      .select("id")
      .maybeSingle();
    if (error) throw new Error(`recurrence insert failed: ${error.message}`);
    recurrenceId = data?.id;
  }

  if (!recurrenceId || !input.periodStart || !input.periodEnd || input.invoiceAmount <= 0) return null;

  const dueDate = input.paymentDate < input.periodStart
    ? input.periodStart
    : input.paymentDate > input.periodEnd ? input.periodEnd : input.paymentDate;
  let cycle: { id: string } | null = null;

  const { data: invoiceCycle, error: invoiceCycleError } = await supabase
    .from("sale_recurring_cycles")
    .select("id")
    .eq("stripe_invoice_id", input.invoiceId)
    .maybeSingle();
  if (invoiceCycleError) throw new Error(`invoice cycle lookup failed: ${invoiceCycleError.message}`);
  cycle = invoiceCycle;

  if (!cycle) {
    const windowStart = new Date(new Date(input.periodStart).getTime() - 15 * 86_400_000).toISOString().slice(0, 10);
    const windowEnd = new Date(new Date(input.periodStart).getTime() + 15 * 86_400_000).toISOString().slice(0, 10);
    const { data: nearCycles, error: nearCycleError } = await supabase
      .from("sale_recurring_cycles")
      .select("id")
      .eq("recurrence_id", recurrenceId)
      .is("stripe_invoice_id", null)
      .in("status", ["pending", "paid"])
      .gte("period_start", windowStart)
      .lte("period_start", windowEnd)
      .order("period_start", { ascending: true })
      .limit(1);
    if (nearCycleError) throw new Error(`near cycle lookup failed: ${nearCycleError.message}`);
    cycle = nearCycles?.[0] ?? null;
  }

  const cyclePatch = {
    status: "paid",
    paid_at: now,
    stripe_invoice_id: input.invoiceId,
    period_start: input.periodStart,
    period_end: input.periodEnd,
    due_date: dueDate,
    amount: input.invoiceAmount,
    updated_at: now,
  };
  if (cycle) {
    const { error } = await supabase.from("sale_recurring_cycles").update(cyclePatch).eq("id", cycle.id);
    if (error) throw new Error(`cycle update failed: ${error.message}`);
    return cycle.id;
  }

  const { data: created, error } = await supabase
    .from("sale_recurring_cycles")
    .insert({
      recurrence_id: recurrenceId,
      sale_id: input.saleId,
      organization_id: input.organizationId,
      currency: "EUR",
      ...cyclePatch,
    })
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`cycle insert failed: ${error.message}`);
  return created?.id ?? null;
}
