/**
 * Records Stripe processing costs as an organization expense. The Stripe
 * invoice id is the idempotency key, so webhook retries and the daily
 * reconciler can safely repair the same fee without duplicating it.
 */
export async function recordStripeFeeExpense(
  supabase: any,
  input: {
    organizationId: string;
    invoiceId: string;
    fee: number;
    gross: number;
    net: number;
    expenseDate: string;
  },
): Promise<void> {
  const fee = Math.round(input.fee * 100) / 100;
  if (fee <= 0) return;

  const { data: category, error: categoryError } = await supabase
    .from("expense_categories")
    .select("id")
    .eq("organization_id", input.organizationId)
    .ilike("name", "Taxas")
    .limit(1)
    .maybeSingle();
  if (categoryError) throw new Error(`Stripe fee category lookup failed: ${categoryError.message}`);

  const { error } = await supabase.from("expenses").upsert({
    organization_id: input.organizationId,
    category_id: category?.id ?? null,
    description: "Comissões e taxas Stripe",
    amount: fee,
    expense_date: input.expenseDate,
    is_recurring: false,
    notes: `Taxa Stripe da fatura ${input.invoiceId}. Valor bruto: ${input.gross.toFixed(2)}€; líquido recebido: ${input.net.toFixed(2)}€.`,
    stripe_invoice_id: input.invoiceId,
  }, {
    onConflict: "organization_id,stripe_invoice_id",
    ignoreDuplicates: true,
  });
  if (error) throw new Error(`Stripe fee expense insert failed: ${error.message}`);
}
